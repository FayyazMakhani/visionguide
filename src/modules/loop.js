import { getFrame } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles } from './obstacles.js';
import { trackGoal } from './goalTracker.js';
import { LOOP_INTERVAL_MS, API_TIMEOUT_MS, STALE_FRAME_MS } from '../constants.js';

let intervalId = null;
let pending = false;

/**
 * @param {HTMLVideoElement} videoEl
 * @param {object} stateRef - { goal, context }  — use a ref so loop always reads fresh state
 * @param {object} callbacks - { onSpeak, onContextUpdate, onArrival, onStatusChange }
 */
export function startLoop(videoEl, stateRef, callbacks) {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    if (pending) return;

    const frame = getFrame(videoEl);
    if (!frame) return;

    const capturedAt = Date.now();
    pending = true;

    // Silence fallback timer
    const silenceTimer = setTimeout(() => {
      speak('Still scanning');
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;
      const result = await callClaude(
        buildSystemPrompt('navigation'),
        [buildUserMessage(goal, context, frame)]
      );

      clearTimeout(silenceTimer);

      // Drop stale responses
      if (Date.now() - capturedAt > STALE_FRAME_MS) return;

      // Route obstacles (may interrupt speech)
      routeObstacles(result.obstacles ?? []);

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction);
        callbacks.onSpeak(result.navigation_direction);
        callbacks.onContextUpdate(result.navigation_direction);
      }

      // Check goal
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        speak(`You have arrived at ${goal}`);
        callbacks.onArrival();
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);
      speak('Still scanning');
      console.error('Navigation loop error:', err);
    } finally {
      pending = false;
    }
  }, LOOP_INTERVAL_MS);
}

export function stopLoop() {
  clearInterval(intervalId);
  intervalId = null;
  pending = false;
}
