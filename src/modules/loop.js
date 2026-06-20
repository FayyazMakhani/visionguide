// src/modules/loop.js

import { getFrame, checkFrozenFrame, reinitCamera } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt, buildScanPrompt, buildExplorePrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles, resetObstacles } from './obstacles.js';
import { trackGoal, resetGoalTracker } from './goalTracker.js';
import { extractLandmarks, resetLandmarks } from './landmarks.js';
import { initGyroscope, isRotatingTooFast, shouldWarnRotationSpeed } from './gyroscope.js';
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
 * Start the navigation loop. Always begins in scan phase: the user holds the
 * phone up and rotates slowly while Claude looks for the goal. If the goal
 * isn't found within SCAN_TIMEOUT_MS, the loop falls through to explore phase
 * (walking guidance) and finally to navigate phase once the goal is found.
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

  initGyroscope();
  phase = 'scan';

  async function tick() {
    // Guard: skip if prior call is still in flight
    if (pending) return;

    if (phase === 'scan' && isRotatingTooFast()) {
      if (shouldWarnRotationSpeed()) {
        speak('A little slower.');
        callbacks.onSpeak('A little slower.');
      }
      return;
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
        speak('Still scanning');
        callbacks.onSpeak('Still scanning');
        lastSilenceFiredAt = now;
        silenceFired = true;
      }
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;

      const systemPrompt =
        phase === 'scan' ? buildScanPrompt(goal) :
        phase === 'explore' ? buildExplorePrompt(goal) :
        buildSystemPrompt('navigation');

      const result = await callClaude(systemPrompt, [buildUserMessage(goal, context, frame)], abortController.signal);

      clearTimeout(silenceTimer);

      if (phase === 'scan' || phase === 'explore') {
        const foundGoal = result.navigation_direction && result.goal_confidence >= SCAN_MIN_CONFIDENCE;

        if (foundGoal) {
          if (phase === 'scan' && scanTimerId !== null) {
            clearTimeout(scanTimerId);
            scanTimerId = null;
          } else if (phase === 'explore' && exploreTimerId !== null) {
            clearTimeout(exploreTimerId);
            exploreTimerId = null;
          }

          phase = 'navigate';
          clearInterval(intervalId);
          intervalId = setInterval(tick, LOOP_INTERVAL_MS);

          speak(result.navigation_direction);
          callbacks.onSpeak(result.navigation_direction);
          callbacks.onContextUpdate(result.navigation_direction);
          return;
        }

        if (result.obstacles?.length > 0) {
          routeObstacles(result.obstacles);
        }

        // Explore phase only: guide toward navigable space even though the
        // goal itself hasn't been confirmed (goal_confidence below threshold).
        if (phase === 'explore' && result.navigation_direction) {
          speak(result.navigation_direction);
          callbacks.onSpeak(result.navigation_direction);
          callbacks.onContextUpdate(result.navigation_direction);
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
            speak(warning);
            callbacks.onSpeak(warning);
            lastStaleWarningAt = now;
          }
        }
        return;
      }
      consecutiveStaleDrops = 0;

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction);
        callbacks.onSpeak(result.navigation_direction);
        callbacks.onContextUpdate(result.navigation_direction);
        extractLandmarks(result.navigation_direction);
      }

      // Check goal arrival
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        speak(`You have arrived at ${goal}`, true);
        callbacks.onSpeak(`Arrived at ${goal}`);
        callbacks.onArrival();
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);

      // Stop() aborts the in-flight request intentionally — not an error, nothing to speak or report
      if (err.name === 'AbortError') return;

      if (err.message === 'rate_limited') {
        speak('Connection slow. Pausing briefly.');
        callbacks.onSpeak('Connection slow. Pausing briefly.');
        // Back off: pause the loop for 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else if (!silenceFired) {
        const now = Date.now();
        if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
          speak('Still scanning');
          callbacks.onSpeak('Still scanning');
          lastSilenceFiredAt = now;
        }
      }

      callbacks.onError(err.message);
      console.error('Loop error:', err.message);
    } finally {
      pending = false;
    }
  }

  function onScanTimeout() {
    scanTimerId = null;
    phase = 'explore';
    exploreTimerId = setTimeout(onExploreTimeout, EXPLORE_TIMEOUT_MS);

    clearInterval(intervalId);
    intervalId = setInterval(tick, EXPLORE_INTERVAL_MS);

    const goal = stateRef.current.goal;
    const msg = `I'll guide you through the building to find ${goal}. Follow my directions.`;
    speak(msg);
    callbacks.onSpeak(msg);
  }

  function onExploreTimeout() {
    exploreTimerId = null;
    const goal = stateRef.current.goal;
    const msg = `I wasn't able to find ${goal}. Please ask someone nearby for help.`;
    speak(msg);
    callbacks.onSpeak(msg);
    stopLoop();
  }

  scanTimerId = setTimeout(onScanTimeout, SCAN_TIMEOUT_MS);

  // Must enqueue after the safety prompt — speak() queues onto SpeechQueue
  // rather than speaking immediately, so it naturally plays after whatever
  // App.jsx already queued before calling startLoop.
  const scanInstruction = "Hold your phone up and slowly scan the area. I'll guide you when I see something.";
  speak(scanInstruction);
  callbacks.onSpeak(scanInstruction);

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
