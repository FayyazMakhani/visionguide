// src/modules/loop.js

import { getFrame, checkFrozenFrame, reinitCamera } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt, buildGuidedScanLegPrompt, buildExplorePrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles, resetObstacles } from './obstacles.js';
import { trackGoal, resetGoalTracker } from './goalTracker.js';
import { extractLandmarks, resetLandmarks } from './landmarks.js';
import { recordGoalSighting, resetGoalMemory } from './goalMemory.js';
import { recordBlocked, resetSpatialMemory } from './spatialMemory.js';
import {
  initGyroscope,
  isRotatingTooFast,
  shouldWarnRotationSpeed,
  resetTurnAccumulator,
  resetSessionHeading,
  getAccumulatedTurnDegrees,
  hasGyroData,
} from './gyroscope.js';
import * as guidedScan from './guidedScan.js';
import {
  LOOP_INTERVAL_MS,
  API_TIMEOUT_MS,
  STALE_FRAME_MS,
  SILENCE_HOLDOFF_MS,
  STALE_WARNING_STREAK,
  STALE_WARNING_HOLDOFF_MS,
  DROP_NOTICE_HOLDOFF_MS,
  DEV_MODE,
  NAV_TURN_CANCEL_DEG,
  SCAN_INTERVAL_MS,
  SCAN_TIMEOUT_MS,
  SCAN_MIN_CONFIDENCE,
  EXPLORE_INTERVAL_MS,
  EXPLORE_TIMEOUT_MS,
  SCAN_MODEL,
  NAVIGATE_MODEL,
  DEAD_END_STREAK,
} from '../constants.js';

let intervalId = null;
let pending = false;
let abortController = null;
let lastSilenceFiredAt = 0;
let consecutiveStaleDrops = 0;
let lastStaleWarningAt = 0;
let lastDropNoticeAt = 0;
let consecutivePathBlocked = 0;

// 'scan' | 'explore' | 'navigate' — see 05-visionguide-scan-phase-spec.md
let phase = 'scan';
let scanTimerId = null;
let exploreTimerId = null;
let rejectGoalHandler = null;

/**
 * Start the navigation loop. Always begins in scan phase: a guided
 * 4-direction look-around (ahead/right/behind/left — see
 * 09-visionguide-guided-scan-spec.md) where Claude checks each direction in
 * turn for the goal. If the goal isn't found directly, the loop falls
 * through to explore phase (walking guidance, pointed toward whichever
 * direction looked most promising) and finally to navigate phase once the
 * goal is found. SCAN_TIMEOUT_MS is an overall safety net in case a leg's
 * turn-detection never resolves.
 *
 * @param {HTMLVideoElement} videoEl      - Live camera feed element
 * @param {React.MutableRefObject} streamRef - Ref to the active MediaStream (updatable on frozen-frame reinit)
 * @param {React.MutableRefObject} stateRef - Ref containing { goal: string, context: string[] }
 *                                           Use a ref (not state) so the interval always reads
 *                                           fresh values without needing to restart the loop.
 * @param {object} callbacks
 * @param {function} callbacks.onSpeak          - Called with spoken text string (updates StatusDisplay)
 * @param {function} callbacks.onContextUpdate  - Called with (navigation_direction, frame) on a spoken direction
 * @param {function} callbacks.onFrameCaptured  - Called with the captured frame after each scan-phase leg
 *                                           (win or lose), and additionally on every captured frame during
 *                                           explore/navigate phases (regardless of whether that frame's
 *                                           analysis is later accepted, stale, or turned-away) so the
 *                                           on-screen preview never freezes while guidance is withheld.
 * @param {function} callbacks.onArrival        - Called when goal is confirmed reached
 * @param {function} callbacks.onGiveUp         - Called when explore phase times out without finding the goal
 * @param {function} callbacks.onError          - Called with error string on API failure
 */
export function startLoop(videoEl, streamRef, stateRef, callbacks) {
  if (intervalId !== null) return; // Prevent double-start

  resetObstacles();
  resetGoalTracker();
  resetLandmarks();
  resetGoalMemory();
  resetSpatialMemory();
  consecutivePathBlocked = 0;

  initGyroscope();
  resetSessionHeading();
  phase = 'scan';
  guidedScan.resetGuidedScan();

  async function tick() {
    // Guard: skip if prior call is still in flight
    if (pending) return;

    if (phase === 'scan') {
      if (isRotatingTooFast() && shouldWarnRotationSpeed()) {
        speak('A little slower.', false, () => callbacks.onSpeak('A little slower.'));
      }

      // Guided scan: don't capture/analyze a frame until the user has
      // finished turning into this leg and held still for a moment —
      // see 09-visionguide-guided-scan-spec.md.
      if (guidedScan.isAwaitingTurn()) {
        if (guidedScan.checkTurnProgress()) {
          speak('Stop.', false, () => callbacks.onSpeak('Stop.'));
        }
        return;
      }

      if (guidedScan.isSettling()) {
        guidedScan.checkSettleProgress();
        return;
      }
    }

    // Capture frame
    const frame = getFrame(videoEl);
    if (!frame) return; // Video not ready yet

    // Frozen frame detection — camera stream stuck on the same frame
    if (checkFrozenFrame(frame)) {
      console.warn('Frozen frame detected — reinitializing stream');
      try {
        streamRef.current = await reinitCamera(videoEl, streamRef.current);
      } catch {
        speak('Camera stopped. Please reload the page.');
        callbacks.onSpeak('Camera stopped. Please reload the page.');
        stopLoop();
      }
      return;
    }

    const capturedAt = Date.now();
    // Track rotation since capture so a late response can be dropped if the
    // user has since turned to face somewhere else — scan phase manages its
    // own turn accumulator (guidedScan.js's beginNextLegTurn) and is excluded.
    if (phase !== 'scan') resetTurnAccumulator();

    // Keep the on-screen preview live in explore/navigate even when this frame's
    // analysis ends up discarded as stale/turned-away below — otherwise the
    // preview freezes on the last *accepted* frame while the camera (and user)
    // keeps moving. Scan phase keeps its own per-leg call (tied to the analyzed
    // frame), so it's excluded here to avoid a redundant/conflicting update.
    if (phase !== 'scan') callbacks.onFrameCaptured(frame);

    pending = true;
    abortController = new AbortController();

    // Silence fallback: if no response within API_TIMEOUT_MS, speak holding message
    // throttled to once per SILENCE_HOLDOFF_MS so a slow API doesn't trigger it every cycle
    let silenceFired = false;
    const silenceTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
        speak('Still scanning', false, () => callbacks.onSpeak('Still scanning'));
        lastSilenceFiredAt = now;
        silenceFired = true;
      }
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;

      const systemPrompt =
        phase === 'scan' ? buildGuidedScanLegPrompt(goal) :
        phase === 'explore' ? buildExplorePrompt(goal) :
        buildSystemPrompt('navigation');

      const model = phase === 'navigate' ? NAVIGATE_MODEL : SCAN_MODEL;
      const result = await callClaude(systemPrompt, [buildUserMessage(goal, context, frame)], abortController.signal, model);

      clearTimeout(silenceTimer);

      if (phase === 'scan' || phase === 'explore') {
        // Drop navigation/goal data from a stale frame — the frame is old enough
        // that a direction referencing what was visible in it may no longer apply.
        const isStale = Date.now() - capturedAt > STALE_FRAME_MS;
        // Explore phase only — the user is walking/turning freely between capture and
        // response, unlike the held-still guided scan, so rotation since capture can
        // invalidate a direction even when it's not old enough to count as stale.
        const turnedAway = phase === 'explore' && hasGyroData() && getAccumulatedTurnDegrees() >= NAV_TURN_CANCEL_DEG;
        const foundGoal = !isStale && !turnedAway && result.navigation_direction && result.goal_confidence >= SCAN_MIN_CONFIDENCE;

        if (result.obstacles?.length > 0) {
          routeObstacles(result.obstacles);
        }

        if (foundGoal) {
          if (scanTimerId !== null) {
            clearTimeout(scanTimerId);
            scanTimerId = null;
          }
          if (exploreTimerId !== null) {
            clearTimeout(exploreTimerId);
            exploreTimerId = null;
          }

          phase = 'navigate';
          clearInterval(intervalId);
          intervalId = setInterval(tick, LOOP_INTERVAL_MS);

          speak(result.navigation_direction, false, () => callbacks.onSpeak(result.navigation_direction));
          callbacks.onContextUpdate(result.navigation_direction, frame);
          return;
        }

        if (phase === 'scan') {
          guidedScan.recordLegResult(isStale ? { obstacles: result.obstacles } : result);
          callbacks.onFrameCaptured(frame);

          if (guidedScan.hasMoreLegs()) {
            guidedScan.beginNextLegTurn();
            speak('Turn right and stop.', false, () => callbacks.onSpeak('Turn right and stop.'));
            return;
          }

          finishGuidedScan();
          return;
        }

        // Explore phase only: guide toward navigable space even though the
        // goal itself hasn't been confirmed (goal_confidence below threshold).
        // Always say something actionable, even when the model returns no
        // direction (e.g. a fully blocked view) — never leave the user with
        // silence once explore phase has started.
        if (!isStale && !turnedAway) {
          if (result.path_blocked) {
            handlePathBlocked();
            return;
          }
          consecutivePathBlocked = 0;
          const direction = result.navigation_direction || "I don't see a clear path. Try turning left or right.";
          speak(direction, false, () => callbacks.onSpeak(direction));
          callbacks.onContextUpdate(direction, frame);
        } else {
          maybeSpeakDropNotice();
        }
        return;
      }

      // --- Navigate phase ---

      const isStale = Date.now() - capturedAt > STALE_FRAME_MS;
      // The user walks continuously during navigate phase, so a rotation since
      // capture (e.g. turning to face a different hallway) can invalidate guidance
      // well before STALE_FRAME_MS's time-based cutoff would catch it.
      const turnedAway = hasGyroData() && getAccumulatedTurnDegrees() >= NAV_TURN_CANCEL_DEG;

      // Route obstacles first, regardless of staleness — a hazard warning is still
      // actionable even on a late frame; only position-dependent guidance below
      // (navigation_direction, goal arrival) becomes wrong/misleading once stale.
      if (result.obstacles?.length > 0) {
        routeObstacles(result.obstacles);
      }

      // Drop stale or turned-away navigation/goal data — user has moved too far,
      // or turned to face elsewhere, for it to be actionable.
      // A streak of these means the user is consistently outrunning the scan rate.
      if (isStale || turnedAway) {
        if (DEV_MODE) console.debug(isStale ? 'Stale frame' : 'Turned away since capture', '— navigation/goal data dropped', Date.now() - capturedAt, 'ms old');

        consecutiveStaleDrops++;
        if (consecutiveStaleDrops >= STALE_WARNING_STREAK) {
          const now = Date.now();
          if (now - lastStaleWarningAt >= STALE_WARNING_HOLDOFF_MS) {
            const warning = 'Moving too fast for me to keep up. Please slow down.';
            speak(warning, false, () => callbacks.onSpeak(warning));
            lastStaleWarningAt = now;
          }
        }
        maybeSpeakDropNotice();
        return;
      }
      consecutiveStaleDrops = 0;

      if (result.path_blocked) {
        handlePathBlocked();
        return;
      }
      consecutivePathBlocked = 0;

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction, false, () => callbacks.onSpeak(result.navigation_direction));
        callbacks.onContextUpdate(result.navigation_direction, frame);
        extractLandmarks(result.navigation_direction);
      }

      // Remember where the goal was last seen so guidance can point back
      // toward it if it leaves frame before arrival is confirmed.
      if (result.goal_found && result.goal_confidence >= SCAN_MIN_CONFIDENCE) {
        recordGoalSighting(result.navigation_direction);
      }

      // Check goal arrival
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        // Stop the loop immediately (no more capture/API calls), but defer onArrival
        // (which releases the camera/mic and cancels speech) until the announcement
        // has actually been heard — calling it right away raced resetSpeech()'s
        // cancel() against this utterance, cutting "You have arrived" off silently.
        speak(`You have arrived at ${goal}`, true, () => callbacks.onSpeak(`Arrived at ${goal}`), () => callbacks.onArrival());
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);

      // Stop() aborts the in-flight request intentionally — not an error, nothing to speak or report
      if (err.name === 'AbortError') return;

      if (err.message === 'rate_limited') {
        speak('Connection slow. Pausing briefly.', false, () => callbacks.onSpeak('Connection slow. Pausing briefly.'));
        // Back off: pause the loop for 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else if (!silenceFired) {
        const now = Date.now();
        if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
          speak('Still scanning', false, () => callbacks.onSpeak('Still scanning'));
          lastSilenceFiredAt = now;
        }
      }

      callbacks.onError(err.message);
      console.error('Loop error:', err.message);
    } finally {
      pending = false;
    }
  }

  // Explore/navigate only: a response arrived but was discarded as stale/turned-away.
  // Distinct from the silenceTimer's "Still scanning" (which fires when no response has
  // arrived yet) — this tells the user a result existed but no longer matches where
  // they're pointing, so the on-screen instruction isn't just sitting frozen unexplained.
  // Throttled separately from lastSilenceFiredAt since the two report different causes.
  function maybeSpeakDropNotice() {
    const now = Date.now();
    if (now - lastDropNoticeAt < DROP_NOTICE_HOLDOFF_MS) return;
    speak('Catching up.', false, () => callbacks.onSpeak('Catching up.'));
    lastDropNoticeAt = now;
  }

  // Shared hand-off from scan to explore phase, used both when the guided
  // scan completes (with or without a winning direction) and as the overall
  // safety-net timeout (scanTimerId) in case a leg never resolves.
  function transitionToExplore(message) {
    if (scanTimerId !== null) {
      clearTimeout(scanTimerId);
      scanTimerId = null;
    }
    phase = 'explore';
    consecutivePathBlocked = 0;
    exploreTimerId = setTimeout(onExploreTimeout, EXPLORE_TIMEOUT_MS);

    clearInterval(intervalId);
    intervalId = setInterval(tick, EXPLORE_INTERVAL_MS);

    speak(message, false, () => callbacks.onSpeak(message));
  }

  // Called from the explore/navigate branches above when result.path_blocked
  // is true. Rather than repeating "no path"/whatever instruction came back
  // every tick while stuck facing a wall or dead end, speak it once and then
  // — if it persists for DEAD_END_STREAK frames — auto-reroute exactly like
  // the manual "not here" voice command does.
  function handlePathBlocked() {
    consecutivePathBlocked++;
    recordBlocked();
    if (consecutivePathBlocked >= DEAD_END_STREAK) {
      handleRejectGoal("Dead end. Turn around and I'll guide you a different way.");
      return;
    }
    if (consecutivePathBlocked === 1) {
      const msg = 'No path this way.';
      speak(msg, false, () => callbacks.onSpeak(msg));
    }
  }

  function onScanTimeout() {
    const goal = stateRef.current.goal;
    transitionToExplore(`I'll guide you through the building to find ${goal}. Follow my directions.`);
  }

  // Called once all 4 guided-scan legs are recorded without finding the
  // goal directly. Either hands off to explore with a concrete turn
  // instruction toward the most promising direction seen, or — if nothing
  // stood out — falls back to the same generic explore hand-off as a scan
  // timeout.
  function finishGuidedScan() {
    const decision = guidedScan.decide();
    if (decision.type === 'direction') {
      transitionToExplore(decision.instruction);
    } else {
      onScanTimeout();
    }
  }

  function onExploreTimeout() {
    exploreTimerId = null;
    const goal = stateRef.current.goal;
    const msg = `I wasn't able to find ${goal}. Please ask someone nearby for help.`;
    // Same deferred-teardown reasoning as the arrival branch above — onGiveUp
    // releases the mic/camera and resets speech, which would otherwise cut this
    // message off before the user hears it.
    speak(msg, false, () => callbacks.onSpeak(msg), () => callbacks.onGiveUp());
    stopLoop();
  }

  // Dead-end/reject recovery, triggered either by the user saying "not here"
  // (rejectGoalHandler below, default message) or automatically by
  // handlePathBlocked() above (custom message). Nothing to reject yet during
  // the initial scan. Turning around is the one direction guaranteed to show
  // a view the model hasn't already judged against this goal.
  function handleRejectGoal(message = "Okay, this isn't it. Turn around and I'll guide you a different way.") {
    if (phase === 'scan') return;
    resetGoalTracker();
    resetGoalMemory();
    transitionToExplore(message);
  }
  rejectGoalHandler = handleRejectGoal;

  // Overall safety net for the whole guided scan (4 legs), in case a leg's
  // turn never resolves (e.g. no gyro data and a hung fallback) — falls
  // back to explore phase exactly like a free-rotation scan timeout would.
  scanTimerId = setTimeout(onScanTimeout, SCAN_TIMEOUT_MS);

  // Must enqueue after the safety prompt — speak() queues onto SpeechQueue
  // rather than speaking immediately, so it naturally plays after whatever
  // App.jsx already queued before calling startLoop.
  const scanInstruction = 'Hold your phone up, facing forward, and hold still.';
  speak(scanInstruction, false, () => callbacks.onSpeak(scanInstruction));

  intervalId = setInterval(tick, SCAN_INTERVAL_MS);
}

/**
 * Stop the navigation loop. Safe to call if loop is not running.
 * Resets phase to 'scan' so the next Start always begins there.
 */
export function stopLoop() {
  if (abortController !== null) {
    abortController.abort();
    abortController = null;
  }
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (scanTimerId !== null) {
    clearTimeout(scanTimerId);
    scanTimerId = null;
  }
  if (exploreTimerId !== null) {
    clearTimeout(exploreTimerId);
    exploreTimerId = null;
  }
  pending = false;
  lastSilenceFiredAt = 0;
  lastDropNoticeAt = 0;
  consecutiveStaleDrops = 0;
  lastStaleWarningAt = 0;
  phase = 'scan';
  rejectGoalHandler = null;
}

/**
 * Check if loop is currently running.
 * @returns {boolean}
 */
export function isLoopRunning() {
  return intervalId !== null;
}

/**
 * Reject the current direction/room (e.g. user said "not here") and resume
 * searching elsewhere. No-op if the loop isn't running.
 */
export function rejectGoal() {
  rejectGoalHandler?.();
}
