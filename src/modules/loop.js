// src/modules/loop.js

import { getFrame, checkFrozenFrame, reinitCamera } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt, buildGuidedScanLegPrompt, buildExplorePrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles, resetObstacles } from './obstacles.js';
import { trackGoal, resetGoalTracker } from './goalTracker.js';
import { extractLandmarks, resetLandmarks } from './landmarks.js';
import { recordGoalSighting, resetGoalMemory } from './goalMemory.js';
import { initGyroscope, isRotatingTooFast, shouldWarnRotationSpeed } from './gyroscope.js';
import * as guidedScan from './guidedScan.js';
import {
  LOOP_INTERVAL_MS,
  API_TIMEOUT_MS,
  STALE_FRAME_MS,
  SILENCE_HOLDOFF_MS,
  STALE_WARNING_STREAK,
  STALE_WARNING_HOLDOFF_MS,
  DEV_MODE,
  SCAN_INTERVAL_MS,
  SCAN_TIMEOUT_MS,
  SCAN_MIN_CONFIDENCE,
  EXPLORE_INTERVAL_MS,
  EXPLORE_TIMEOUT_MS,
  SCAN_MODEL,
  NAVIGATE_MODEL,
} from '../constants.js';

let intervalId = null;
let pending = false;
let abortController = null;
let lastSilenceFiredAt = 0;
let consecutiveStaleDrops = 0;
let lastStaleWarningAt = 0;

// 'scan' | 'explore' | 'navigate' — see 05-visionguide-scan-phase-spec.md
let phase = 'scan';
let scanTimerId = null;
let exploreTimerId = null;

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
 * @param {function} callbacks.onContextUpdate  - Called with navigation_direction string (updates context array)
 * @param {function} callbacks.onArrival        - Called when goal is confirmed reached
 * @param {function} callbacks.onError          - Called with error string on API failure
 */
export function startLoop(videoEl, streamRef, stateRef, callbacks) {
  if (intervalId !== null) return; // Prevent double-start

  resetObstacles();
  resetGoalTracker();
  resetLandmarks();
  resetGoalMemory();

  initGyroscope();
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
        const foundGoal = !isStale && result.navigation_direction && result.goal_confidence >= SCAN_MIN_CONFIDENCE;

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
          callbacks.onContextUpdate(result.navigation_direction);
          return;
        }

        if (phase === 'scan') {
          guidedScan.recordLegResult(isStale ? { obstacles: result.obstacles } : result);

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
        if (!isStale) {
          const direction = result.navigation_direction || "I don't see a clear path. Try turning left or right.";
          speak(direction, false, () => callbacks.onSpeak(direction));
          callbacks.onContextUpdate(direction);
        }
        return;
      }

      // --- Navigate phase — unchanged from prior loop behavior ---

      const isStale = Date.now() - capturedAt > STALE_FRAME_MS;

      // Route obstacles first, regardless of staleness — a hazard warning is still
      // actionable even on a late frame; only position-dependent guidance below
      // (navigation_direction, goal arrival) becomes wrong/misleading once stale.
      if (result.obstacles?.length > 0) {
        routeObstacles(result.obstacles);
      }

      // Drop stale navigation/goal data — user has moved too far for it to be actionable.
      // A streak of these means the user is consistently outrunning the scan rate.
      if (isStale) {
        if (DEV_MODE) console.debug('Stale frame — navigation/goal data dropped', Date.now() - capturedAt, 'ms old');

        consecutiveStaleDrops++;
        if (consecutiveStaleDrops >= STALE_WARNING_STREAK) {
          const now = Date.now();
          if (now - lastStaleWarningAt >= STALE_WARNING_HOLDOFF_MS) {
            const warning = 'Moving too fast for me to keep up. Please slow down.';
            speak(warning, false, () => callbacks.onSpeak(warning));
            lastStaleWarningAt = now;
          }
        }
        return;
      }
      consecutiveStaleDrops = 0;

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction, false, () => callbacks.onSpeak(result.navigation_direction));
        callbacks.onContextUpdate(result.navigation_direction);
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
        speak(`You have arrived at ${goal}`, true, () => callbacks.onSpeak(`Arrived at ${goal}`));
        callbacks.onArrival();
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

  // Shared hand-off from scan to explore phase, used both when the guided
  // scan completes (with or without a winning direction) and as the overall
  // safety-net timeout (scanTimerId) in case a leg never resolves.
  function transitionToExplore(message) {
    if (scanTimerId !== null) {
      clearTimeout(scanTimerId);
      scanTimerId = null;
    }
    phase = 'explore';
    exploreTimerId = setTimeout(onExploreTimeout, EXPLORE_TIMEOUT_MS);

    clearInterval(intervalId);
    intervalId = setInterval(tick, EXPLORE_INTERVAL_MS);

    speak(message, false, () => callbacks.onSpeak(message));
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
    speak(msg, false, () => callbacks.onSpeak(msg));
    stopLoop();
  }

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
  consecutiveStaleDrops = 0;
  lastStaleWarningAt = 0;
  phase = 'scan';
}

/**
 * Check if loop is currently running.
 * @returns {boolean}
 */
export function isLoopRunning() {
  return intervalId !== null;
}
