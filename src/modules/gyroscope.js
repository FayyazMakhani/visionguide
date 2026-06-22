// src/modules/gyroscope.js
//
// Singleton tracking device yaw rate during scan phase. Gating applies only
// in scan phase — explore and navigate phases never call into this module.
// Also tracks cumulative turn angle during the guided 4-direction scan
// (09-visionguide-guided-scan-spec.md), used to detect when a ~90 deg leg
// turn is complete.

import { SCAN_YAW_THRESHOLD_DEG_S, SCAN_YAW_DEBOUNCE_MS, SPATIAL_HEADING_BUCKET_DEG } from '../constants.js';

let currentYawRate = 0;
let lastWarnedAt = 0;
let listening = false;
let gotGyroData = false;
let lastEventTime = null;
let accumulatedTurnDeg = 0;
// Signed cumulative rotation since session start (resetSessionHeading), unlike
// accumulatedTurnDeg above which resets every tick for staleness checks. Drifts
// over a long session since it's gyro-integration, not a real compass — only
// good for short-term "have I turned back toward where I just was" recall.
let sessionHeadingDeg = 0;

/**
 * Start listening to DeviceMotionEvent. Call inside the Start tap handler
 * (not on page load) — DeviceMotionEvent requires a user gesture on some
 * Android versions. Safe to call multiple times; only attaches once.
 *
 * On iOS 13+, DeviceMotionEvent requires an explicit permission prompt
 * (must also be triggered by a user gesture) before any events fire —
 * requested here, fire-and-forget, since this is already called from the
 * Start tap handler's gesture context.
 */
export function initGyroscope() {
  if (listening) return;
  if (typeof DeviceMotionEvent === 'undefined') return;

  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().catch(() => { /* denied or unsupported — events just won't fire */ });
  }

  window.addEventListener('devicemotion', (event) => {
    const rawAlpha = event.rotationRate?.alpha;
    // Many devices/browsers fire devicemotion with acceleration data only,
    // leaving rotationRate null — treat those as "no gyro data" rather than
    // letting them falsely satisfy hasGyroData() and disable the timer fallback.
    if (rawAlpha == null) return;

    const alpha = rawAlpha;
    currentYawRate = Math.abs(alpha);
    gotGyroData = true;

    const now = event.timeStamp ?? Date.now();
    if (lastEventTime !== null) {
      const dtSeconds = (now - lastEventTime) / 1000;
      // Ignore implausible gaps (e.g. tab backgrounded) so a stale dt can't
      // inflate the accumulator with a single huge jump.
      if (dtSeconds > 0 && dtSeconds < 1) {
        accumulatedTurnDeg += alpha * dtSeconds;
        sessionHeadingDeg += alpha * dtSeconds;
      }
    }
    lastEventTime = now;
  });
  listening = true;
}

/**
 * Zero the cumulative turn accumulator. Call at the start of each guided-scan leg.
 */
export function resetTurnAccumulator() {
  accumulatedTurnDeg = 0;
}

/**
 * Zero the session-relative heading. Call once per navigation session (loop.js's
 * startLoop), not per-tick/per-leg — this is meant to persist across the whole session.
 */
export function resetSessionHeading() {
  sessionHeadingDeg = 0;
}

/**
 * @returns {number} current session-relative heading bucketed into
 * SPATIAL_HEADING_BUCKET_DEG-wide compass slices (0..7 for 45deg buckets), so two
 * headings a few degrees apart from gyro noise still match as "the same direction".
 */
export function getSessionHeadingBucket() {
  const normalized = ((sessionHeadingDeg % 360) + 360) % 360;
  return Math.round(normalized / SPATIAL_HEADING_BUCKET_DEG) % (360 / SPATIAL_HEADING_BUCKET_DEG);
}

/**
 * @returns {number} absolute degrees turned since the last resetTurnAccumulator() call.
 */
export function getAccumulatedTurnDegrees() {
  return Math.abs(accumulatedTurnDeg);
}

/**
 * @returns {boolean} true once at least one real devicemotion event has been observed.
 * False means the device/browser doesn't supply rotation data (e.g. iOS permission
 * denied, or no DeviceMotionEvent support) — callers should fall back to a timer.
 */
export function hasGyroData() {
  return gotGyroData;
}

/**
 * @returns {boolean} true if yaw rate exceeds SCAN_YAW_THRESHOLD_DEG_S.
 * Always false if DeviceMotionEvent is unavailable, so scan phase is never
 * blocked on devices without gyroscope support.
 */
export function isRotatingTooFast() {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  return currentYawRate > SCAN_YAW_THRESHOLD_DEG_S;
}

/**
 * @returns {boolean} true at most once per SCAN_YAW_DEBOUNCE_MS.
 * Updates the last-warned timestamp on each true return.
 */
export function shouldWarnRotationSpeed() {
  const now = Date.now();
  if (now - lastWarnedAt < SCAN_YAW_DEBOUNCE_MS) return false;
  lastWarnedAt = now;
  return true;
}
