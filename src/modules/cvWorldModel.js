// src/modules/cvWorldModel.js

// Single atomic snapshot of the CV layer's current scene understanding.
// Replace-not-mutate: the whole snapshot object is swapped on each fast-loop
// tick, never partially updated, so consumers (hazardEvaluator on the medium
// loop, cvContextBuilder on the slow loop) always read a fully-consistent
// frame — see the latency contract in 12-visionguide-computer-vision-spec.md.

let latestSnapshot = null;

/**
 * Replace the snapshot with a new one built from the tracker's output.
 * @param {Array} trackedObjects - cvTracker.update() output
 * @param {number} timestamp     - Date.now() at the fast-loop tick
 */
export function update(trackedObjects, timestamp) {
  latestSnapshot = { objects: trackedObjects, frameTimestamp: timestamp };
}

/**
 * @returns {{objects: Array, frameTimestamp: number} | null} null before first update
 */
export function getSnapshot() {
  return latestSnapshot;
}

/**
 * Clear the snapshot. Call at the start of each CV session.
 */
export function reset() {
  latestSnapshot = null;
}
