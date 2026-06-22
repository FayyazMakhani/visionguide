// src/modules/spatialMemory.js
//
// Short-term recall of "this heading was a dead end" so explore/navigate
// phases don't repeat a direction already proven blocked (e.g. re-suggesting
// the same wall between two windows). Keyed on gyroscope.js's session-relative
// heading bucket — approximate and drift-prone over a long session, so entries
// expire quickly (SPATIAL_MEMORY_MS) rather than being trusted long-term.

import { SPATIAL_MEMORY_MS } from '../constants.js';
import { getSessionHeadingBucket } from './gyroscope.js';

let blockedHeadings = []; // [{ headingBucket, capturedAt }]

/**
 * Record the current heading as blocked (path_blocked or dead-end reroute).
 */
export function recordBlocked() {
  const headingBucket = getSessionHeadingBucket();
  blockedHeadings.push({ headingBucket, capturedAt: Date.now() });
}

/**
 * Get a prompt hint warning Claude off the current heading if it was recently
 * recorded as blocked, or '' if not facing a known-blocked direction.
 * @returns {string}
 */
export function getSpatialMemoryHint() {
  const now = Date.now();
  blockedHeadings = blockedHeadings.filter(b => now - b.capturedAt <= SPATIAL_MEMORY_MS);

  const currentBucket = getSessionHeadingBucket();
  const matchesCurrent = blockedHeadings.some(b => b.headingBucket === currentBucket);
  if (!matchesCurrent) return '';

  return "You already found this direction blocked a moment ago — don't suggest continuing this way; guide the user to turn instead.";
}

/**
 * Reset spatial memory. Call before starting a new navigation session.
 */
export function resetSpatialMemory() {
  blockedHeadings = [];
}
