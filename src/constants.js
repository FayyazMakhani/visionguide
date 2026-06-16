export const LOOP_INTERVAL_MS  = 1000;   // 1 fps
export const API_TIMEOUT_MS    = 3000;   // Speak "Still scanning" after 3s of no response
export const STALE_FRAME_MS    = 4500;   // Drop API response if frame is older than 4.5s (p95 latency + 500ms buffer)
export const GOAL_CONFIDENCE_THRESHOLD = 0.8;
export const GOAL_CONFIRM_FRAMES = 2;    // Consecutive frames required to confirm arrival
// OBSTACLE_CONFIRM_FRAMES intentionally removed — high urgency fires on first frame.
// At 1fps + 3s latency, a 2-frame confirmation window consumes the entire available safety margin.
export const DEDUP_WINDOW_MS   = 10_000; // Don't repeat same direction within 10s
export const SILENCE_HOLDOFF_MS = 10_000; // Max one "Still scanning" per 10s
