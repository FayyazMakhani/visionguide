// src/modules/guidedScan.js
//
// Guided 4-direction scan state machine — see 09-visionguide-guided-scan-spec.md.
// Replaces the old free-rotation scan: the app instructs the user to turn
// ~90 deg right and stop, four times in a row (ahead -> right -> behind ->
// left relative to where they started), looks at one still frame per stop,
// and remembers what each direction looked like. loop.js drives this module
// tick-by-tick since it owns frame capture and the Claude call; this module
// only owns the leg sequencing, turn-completion detection, and the final
// "which way is most promising" decision.

import {
  SCAN_LEG_TURN_TARGET_DEG,
  SCAN_LEG_TURN_TOLERANCE_DEG,
  SCAN_LEG_NO_GYRO_TIMEOUT_MS,
  SCAN_LEG_MAX_TURN_MS,
  SCAN_LEG_SETTLE_MS,
  SCAN_MIN_PATH_OPENNESS,
} from '../constants.js';
import { resetTurnAccumulator, getAccumulatedTurnDegrees, hasGyroData } from './gyroscope.js';

export const LEGS = ['ahead', 'right', 'behind', 'left'];

let currentLegIndex = 0;
let stage = 'ready'; // 'awaiting_turn' | 'settling' | 'ready'
let legStartTime = 0;
let settleUntil = 0;
let legResults = [];

/**
 * Call once when entering scan phase. Leg 0 ('ahead') needs no turn — just a
 * brief settle so the very first frame isn't motion-blurred from the user
 * raising the phone.
 */
export function resetGuidedScan() {
  currentLegIndex = 0;
  legResults = [];
  stage = 'settling';
  settleUntil = Date.now() + SCAN_LEG_SETTLE_MS;
}

export function getCurrentLegLabel() {
  return LEGS[currentLegIndex];
}

export function isAwaitingTurn() {
  return stage === 'awaiting_turn';
}

export function isSettling() {
  return stage === 'settling';
}

export function isReadyToCapture() {
  return stage === 'ready';
}

/**
 * Call every scan-phase tick while isAwaitingTurn(). Transitions to
 * 'settling' once the leg's turn looks done — either the gyroscope reports
 * roughly SCAN_LEG_TURN_TARGET_DEG of rotation, or (no gyro data at all)
 * a fallback dwell time has elapsed. A hard ceiling (SCAN_LEG_MAX_TURN_MS)
 * also applies regardless of gyro state, so a leg can never stall
 * indefinitely if hasGyroData() is true but the angle never accumulates as
 * expected (e.g. an axis/orientation mismatch for how the phone is held).
 * @returns {boolean} true if the turn just completed this call (so the
 *   caller can speak "Stop.")
 */
export function checkTurnProgress() {
  const turned = getAccumulatedTurnDegrees();
  const elapsed = Date.now() - legStartTime;
  const noGyroFallback = !hasGyroData() && elapsed >= SCAN_LEG_NO_GYRO_TIMEOUT_MS;
  const hardCeiling = elapsed >= SCAN_LEG_MAX_TURN_MS;

  if (turned >= SCAN_LEG_TURN_TARGET_DEG - SCAN_LEG_TURN_TOLERANCE_DEG || noGyroFallback || hardCeiling) {
    stage = 'settling';
    settleUntil = Date.now() + SCAN_LEG_SETTLE_MS;
    return true;
  }
  return false;
}

/**
 * Call every scan-phase tick while isSettling(). Transitions to 'ready'
 * once the settle dwell has elapsed.
 */
export function checkSettleProgress() {
  if (Date.now() >= settleUntil) {
    stage = 'ready';
  }
}

/**
 * Advance to the next leg and begin tracking its turn. Call after capturing
 * the current leg's frame, when hasMoreLegs() is true.
 */
export function beginNextLegTurn() {
  currentLegIndex += 1;
  stage = 'awaiting_turn';
  legStartTime = Date.now();
  resetTurnAccumulator();
}

/**
 * Store the analysis result for the current leg.
 * @param {object} result - Claude's parsed response for this leg's frame
 */
export function recordLegResult(result) {
  legResults[currentLegIndex] = result;
}

export function hasMoreLegs() {
  return currentLegIndex < LEGS.length - 1;
}

/**
 * After all 4 legs are recorded (and none short-circuited on goal_found),
 * decide which direction — if any — is most worth heading toward.
 * @returns {{ type: 'direction', instruction: string } | { type: 'none' }}
 */
export function decide() {
  let bestIdx = -1;
  let bestScore = -1;

  legResults.forEach((result, idx) => {
    if (!result) return;
    const blockedByHighUrgency = (result.obstacles || []).some(o => o.urgency === 'high');
    const score = blockedByHighUrgency ? 0 : (result.path_openness ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  if (bestIdx === -1 || bestScore < SCAN_MIN_PATH_OPENNESS) {
    return { type: 'none' };
  }

  const delta = normalizeTurnDelta((bestIdx - (LEGS.length - 1)) * SCAN_LEG_TURN_TARGET_DEG);
  return { type: 'direction', instruction: buildTurnInstruction(delta, legResults[bestIdx]) };
}

/**
 * Normalize a clockwise-degrees delta to (-180, 180]: positive = turn right,
 * negative = turn left, exactly 180 = either way (turn around).
 */
function normalizeTurnDelta(deltaDeg) {
  let delta = ((deltaDeg % 360) + 360) % 360;
  if (delta > 180) delta -= 360;
  return delta;
}

/**
 * One-line text summary of all 4 scan-leg results, for injection into
 * explore/navigate prompts. Self-describing (carries its own usage
 * instruction inline, like getGoalMemoryHint/getSpatialMemoryHint) so no
 * system-prompt rule is needed. Returns '' if no legs were recorded.
 * @returns {string}
 */
export function getScanSummary() {
  const parts = [];
  LEGS.forEach((label, idx) => {
    const r = legResults[idx];
    if (!r) return;
    const hint = r.navigation_direction || 'no detail';
    const openness = (r.path_openness ?? 0).toFixed(1);
    parts.push(`${label} — ${hint} (openness ${openness})`);
  });
  if (parts.length === 0) return '';
  return `Scan summary from the initial look-around (background context for what's nearby; trust THIS frame over it if they conflict): ${parts.join('; ')}.`;
}

function buildTurnInstruction(delta, legResult) {
  const hint = legResult.navigation_direction ? ` — ${legResult.navigation_direction}` : ', I saw an open path that way';
  if (delta === 0) return `Stay facing this way${hint}.`;
  if (delta === 180) return `Turn around${hint}.`;
  if (delta > 0) return `Turn right${hint}.`;
  return `Turn left${hint}.`;
}
