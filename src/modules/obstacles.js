import { speak } from './speech.js';

/**
 * Route obstacles from API response to speech output.
 * High urgency fires immediately on first frame — no confirmation delay.
 * At 1fps + 3s latency, a 2-frame window consumes the entire safety margin.
 * @param {Array<{type: string, direction: string, urgency: string}>} obstacles
 */
export function routeObstacles(obstacles) {
  const highUrgency = obstacles.find(o => o.urgency === 'high');

  if (highUrgency) {
    speak(`${highUrgency.type} on your ${highUrgency.direction}`, true); // interrupt=true, fires immediately
    return;
  }

  const medium = obstacles.find(o => o.urgency === 'medium');
  if (medium) {
    speak(`${medium.type} on your ${medium.direction}`); // queued, no interrupt
  }
  // low urgency: discard
}

export function resetObstacles() {
  // No state to reset — confirmation counter removed
}
