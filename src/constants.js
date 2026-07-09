export const LOOP_INTERVAL_MS  = 1000;   // 1 fps
export const API_TIMEOUT_MS    = 3000;   // Speak "Still scanning" after 3s of no response
export const STALE_FRAME_MS    = 4500;   // Drop API response if frame is older than 4.5s (p95 latency + 500ms buffer)
export const GOAL_CONFIDENCE_THRESHOLD = 0.8; // Lower to 0.7 if demo destination is missed
export const GOAL_CONFIRM_FRAMES = 2;    // Consecutive frames required to confirm arrival
export const SCAN_MODEL     = 'claude-sonnet-4-6';        // scan/explore: signage-reading accuracy matters most
export const NAVIGATE_MODEL = 'claude-haiku-4-5-20251001'; // navigate: high-frequency, lower-stakes polling
// OBSTACLE_CONFIRM_FRAMES intentionally removed — high urgency fires on first frame.
// At 1fps + 3s latency, a 2-frame confirmation window consumes the entire available safety margin.
export const DEDUP_WINDOW_MS   = 10_000; // Don't repeat same direction within 10s
export const SILENCE_HOLDOFF_MS = 10_000; // Max one "Still scanning" per 10s
export const STALE_WARNING_STREAK    = 3;      // 3 consecutive stale drops before telling the user to slow down
export const STALE_WARNING_HOLDOFF_MS = 15_000; // Max one "too fast" warning per 15s — rarer than "Still scanning"
// Max one "Catching up" cue per this many ms, for a response that arrived but was discarded
// (stale/turned-away) — distinct from SILENCE_HOLDOFF_MS (no response yet). Must be >= DEDUP_WINDOW_MS
// (speech.js, 10s) or speak()'s own dedup would silently eat a second cue before this throttle even matters.
export const DROP_NOTICE_HOLDOFF_MS = 10_000;
export const DEV_MODE = false; // Set to true locally for debugging
export const NAV_TURN_CANCEL_DEG = 20; // Drop explore/navigate guidance if the user has rotated this many degrees since the frame was captured — it no longer reflects where they're pointing
export const DEAD_END_CHECK_STREAK = 2; // Consecutive path_blocked frames before suggesting a left/right check
export const DEAD_END_STREAK = 4; // Consecutive path_blocked frames before auto-rerouting instead of repeating — gives a couple ticks after the left/right check prompt for the user to actually pan
export const SMALL_SPACE_HOLDOFF_MS = 30_000; // Max one "small space" callout per 30s

// --- Scan & explore phases (05-visionguide-scan-phase-spec.md) ---
export const SCAN_INTERVAL_MS         = 500;    // 2fps during scan phase
export const SCAN_YAW_THRESHOLD_DEG_S = 30;     // deg/s above which frame is skipped
export const SCAN_YAW_DEBOUNCE_MS     = 2500;   // min ms between "slow down" warnings
export const SCAN_TIMEOUT_MS          = 20_000; // ms before scan gives up and explore begins
export const SCAN_MIN_CONFIDENCE      = 0.5;    // lower bar than GOAL_CONFIDENCE_THRESHOLD;
                                                 // navigation_direction at this confidence
                                                 // is enough to exit scan or explore phase

export const EXPLORE_INTERVAL_MS      = 1000;   // 1fps during explore phase (user is walking)
export const EXPLORE_TIMEOUT_MS       = 90_000; // ms before explore gives up entirely (90s)

// --- Guided 4-direction scan (09-visionguide-guided-scan-spec.md) ---
export const SCAN_LEG_TURN_TARGET_DEG = 90;     // target turn per leg (ahead/right/behind/left)
export const SCAN_LEG_TURN_TOLERANCE_DEG = 10;  // accept the turn as "done" within +/-10 deg of target
export const SCAN_LEG_NO_GYRO_TIMEOUT_MS = 2500; // fallback dwell time per leg when no gyro data is available
export const SCAN_LEG_MAX_TURN_MS = 6000; // hard ceiling per leg regardless of gyro state — a real 90deg body turn always finishes well within this
export const SCAN_LEG_SETTLE_MS       = 600;    // brief pause after "stop" before capturing, to avoid motion blur
export const SCAN_MIN_PATH_OPENNESS   = 0.4;    // minimum path_openness to commit to a direction instead of falling back to explore

// --- Spatial memory (dead-end/blocked-heading recall) ---
export const SPATIAL_HEADING_BUCKET_DEG = 45;    // compass-bucket size for session-relative heading
export const SPATIAL_MEMORY_MS          = 120_000; // how long a blocked-heading memory stays usable before it's too stale (drift) to trust

// --- On-device CV layer (12-visionguide-computer-vision-spec.md) ---
export const CV_CONFIDENCE_THRESHOLD = 0.5;    // MediaPipe detector init threshold
export const CV_RISK_CONFIDENCE_MIN  = 0.7;    // minimum confidence for alert or context inclusion (person)
export const CV_FURNITURE_CONFIDENCE_MIN = 0.55; // lower floor for furniture — the detector scores chairs/tables well below people, so the 0.7 person floor was discarding every chair
export const CV_BOTTOM_PROXIMITY_THRESHOLD = 0.9; // furniture whose box reaches the bottom 10% of the frame is underfoot-close, even if its visible height is small (slipped low / clipped)
export const CV_PROXIMITY_THRESHOLD  = 0.35;   // bounding box height above which object is "close"
export const CV_ALERT_COOLDOWN_MS    = 3000;   // per-class cooldown between hazard audio alerts
export const CV_CONTEXT_STALENESS_MS = 1000;   // max snapshot age for Claude context or hazard eval
export const CV_MEDIUM_LOOP_MS       = 333;    // hazardEvaluator interval (~3fps)
export const CV_EVICTION_FRAMES      = 5;      // frames before an unmatched object is evicted
