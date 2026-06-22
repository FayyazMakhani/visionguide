// src/modules/goalTracker.js

import { GOAL_CONFIDENCE_THRESHOLD, GOAL_CONFIRM_FRAMES, DEV_MODE } from '../constants.js';

let consecutiveFoundCount = 0;

/**
 * Track goal arrival across consecutive frames.
 * Requires GOAL_CONFIRM_FRAMES consecutive frames with goal_found=true
 * and goal_confidence >= GOAL_CONFIDENCE_THRESHOLD before confirming arrival.
 * Two-frame confirmation retained for goal (unlike obstacles) because a false
 * arrival announcement stops the entire loop — more costly than a false obstacle alert.
 *
 * @param {boolean} goalFound
 * @param {number}  goalConfidence  - 0.0 to 1.0
 * @returns {boolean} true when arrival is confirmed, false otherwise
 */
export function trackGoal(goalFound, goalConfidence) {
  if (goalFound === true && goalConfidence >= GOAL_CONFIDENCE_THRESHOLD) {
    consecutiveFoundCount++;
    if (DEV_MODE) console.debug(`Goal confidence: ${goalConfidence}, consecutive: ${consecutiveFoundCount}`);
    return consecutiveFoundCount >= GOAL_CONFIRM_FRAMES;
  }

  // Reset on any frame that doesn't meet threshold
  if (DEV_MODE && consecutiveFoundCount > 0) {
    console.debug('Goal confidence dropped, resetting counter');
  }
  consecutiveFoundCount = 0;
  return false;
}

/**
 * Reset tracker. Call before starting a new navigation session.
 */
export function resetGoalTracker() {
  consecutiveFoundCount = 0;
}
