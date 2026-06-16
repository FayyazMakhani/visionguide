import { GOAL_CONFIDENCE_THRESHOLD, GOAL_CONFIRM_FRAMES } from '../constants.js';

let consecutiveFoundCount = 0;

/**
 * @param {boolean} goalFound
 * @param {number} goalConfidence
 * @returns {boolean} true when arrival is confirmed
 */
export function trackGoal(goalFound, goalConfidence) {
  if (goalFound && goalConfidence >= GOAL_CONFIDENCE_THRESHOLD) {
    consecutiveFoundCount++;
    return consecutiveFoundCount >= GOAL_CONFIRM_FRAMES;
  }
  consecutiveFoundCount = 0;
  return false;
}

export function resetGoalTracker() {
  consecutiveFoundCount = 0;
}
