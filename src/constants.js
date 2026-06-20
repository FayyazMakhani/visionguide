export const LOOP_INTERVAL_MS  = 1000;   // 1 fps
export const API_TIMEOUT_MS    = 3000;   // Speak "Still scanning" after 3s of no response
export const STALE_FRAME_MS    = 4500;   // Drop API response if frame is older than 4.5s (p95 latency + 500ms buffer)
export const GOAL_CONFIDENCE_THRESHOLD = 0.8; // Lower to 0.7 if demo destination is missed
export const GOAL_CONFIRM_FRAMES = 2;    // Consecutive frames required to confirm arrival
export const GOAL_FAST_CONFIRM_CONFIDENCE = 0.95; // Skip the 2nd confirm frame if the 1st is this confident
export const SCAN_MODEL     = 'claude-sonnet-4-6';        // scan/explore: signage-reading accuracy matters most
export const NAVIGATE_MODEL = 'claude-haiku-4-5-20251001'; // navigate: high-frequency, lower-stakes polling
// OBSTACLE_CONFIRM_FRAMES intentionally removed — high urgency fires on first frame.
// At 1fps + 3s latency, a 2-frame confirmation window consumes the entire available safety margin.
export const DEDUP_WINDOW_MS   = 10_000; // Don't repeat same direction within 10s
export const SILENCE_HOLDOFF_MS = 10_000; // Max one "Still scanning" per 10s
export const STALE_WARNING_STREAK    = 3;      // 3 consecutive stale drops before telling the user to slow down
export const STALE_WARNING_HOLDOFF_MS = 15_000; // Max one "too fast" warning per 15s — rarer than "Still scanning"
export const DEV_MODE = false; // Set to true locally for debugging

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
