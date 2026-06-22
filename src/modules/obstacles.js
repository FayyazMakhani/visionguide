// src/modules/obstacles.js

import { speak } from './speech.js';

// Suppresses a repeat high-urgency alert for the same obstacle type+direction
// within the cooldown window — prevents a static misclassification from
// alerting twice in a row (Week 4 false-positive reduction, spec §5.1).
let lastHighAlert = { type: '', direction: '', firedAt: 0 };
const HIGH_ALERT_COOLDOWN_MS = 4000;

// Same idea for medium urgency — without this, a stationary obstacle (e.g. a
// clothing rack the user is ducking under) gets re-spoken every single tick
// for as long as it's in frame, well past when the user has already passed it.
// Longer cooldown than high since medium isn't safety-critical.
let lastMediumAlert = { type: '', direction: '', firedAt: 0 };
const MEDIUM_ALERT_COOLDOWN_MS = 6000;

/**
 * Route obstacles to speech output.
 *
 * High urgency: interrupt current speech immediately, fire on first frame.
 * No 2-frame confirmation — at 1fps + 3s latency, confirmation delay
 * consumes the entire available safety window. Repeats of the same
 * type+direction within HIGH_ALERT_COOLDOWN_MS are suppressed.
 *
 * Medium urgency: queue after current speech.
 * Low urgency: discard silently.
 *
 * @param {Array<{type: string, direction: string, urgency: 'high'|'medium'|'low'}>} obstacles
 */
export function routeObstacles(obstacles) {
  if (!obstacles || obstacles.length === 0) return;

  // Process high urgency first — only the first one fires to avoid speech pile-up
  const highUrgency = obstacles.find(o => o.urgency === 'high');
  if (highUrgency) {
    const now = Date.now();
    const isSameAlert =
      highUrgency.type === lastHighAlert.type &&
      highUrgency.direction === lastHighAlert.direction &&
      now - lastHighAlert.firedAt < HIGH_ALERT_COOLDOWN_MS;

    if (!isSameAlert) {
      speak(formatObstacleAlert(highUrgency), true); // interrupt=true
      lastHighAlert = { type: highUrgency.type, direction: highUrgency.direction, firedAt: now };
    }
    return; // Don't queue medium after a high interrupt
  }

  // Medium urgency — queue, don't interrupt
  const medium = obstacles.find(o => o.urgency === 'medium');
  if (medium) {
    const now = Date.now();
    const isSameAlert =
      medium.type === lastMediumAlert.type &&
      medium.direction === lastMediumAlert.direction &&
      now - lastMediumAlert.firedAt < MEDIUM_ALERT_COOLDOWN_MS;

    if (!isSameAlert) {
      speak(formatObstacleAlert(medium), false); // interrupt=false, queues after current speech
      lastMediumAlert = { type: medium.type, direction: medium.direction, firedAt: now };
    }
  }

  // Low urgency: discard
}

/**
 * Format obstacle into a short spoken alert.
 * Max 8 words. No "I see" or "it looks like".
 *
 * @param {{type: string, direction: string}} obstacle
 * @returns {string}
 */
function formatObstacleAlert(obstacle) {
  const type = obstacle.type?.toLowerCase() ?? 'obstacle';
  const dir = obstacle.direction?.toLowerCase() ?? 'ahead';

  // Special case: steps and stairs are higher risk — prepend "Caution"
  if (type.includes('step') || type.includes('stair')) {
    return `Caution — ${type} ${dir}`;
  }

  return `${capitalize(type)} on your ${dir}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Reset obstacle state. Call before starting a new navigation session.
 */
export function resetObstacles() {
  lastHighAlert = { type: '', direction: '', firedAt: 0 };
  lastMediumAlert = { type: '', direction: '', firedAt: 0 };
}
