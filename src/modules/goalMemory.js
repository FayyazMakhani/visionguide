// src/modules/goalMemory.js

const GOAL_MEMORY_MS = 30_000; // how long a sighting stays usable before it's too stale to act on

let lastSighting = null; // { direction, capturedAt }

/**
 * Record the most recent direction toward the goal while it's visible/confirmed.
 * @param {string} direction
 * @param {number} [capturedAt]
 */
export function recordGoalSighting(direction, capturedAt = Date.now()) {
  if (!direction) return;
  lastSighting = { direction, capturedAt };
}

/**
 * Get a prompt hint pointing back toward the last known goal sighting, or ''
 * if there's no sighting or it's too old to act on.
 * @returns {string}
 */
export function getGoalMemoryHint() {
  if (!lastSighting || Date.now() - lastSighting.capturedAt > GOAL_MEMORY_MS) return '';
  return `Destination last seen: ${lastSighting.direction}. If not visible now, guide the user back toward that direction.`;
}

/**
 * Reset goal memory. Call before starting a new navigation session.
 */
export function resetGoalMemory() {
  lastSighting = null;
}
