# VisionGuide — Scan Phase Spec

## Purpose

When the user starts navigation, the phone may not be pointed toward the destination. Claude Vision can only see what is in front of the camera and has no map or GPS data. The app must guide the user through a slow scan until Claude spots something relevant to the goal, then hand off to the normal navigation loop.

If the destination is not visible from the starting position (e.g. the bathroom is around a corner), the app must not give up. Instead it enters an explore phase: it guides the user toward open navigable space and directional signage until the destination or a relevant sign comes into view.

---

## Scope

### Changes required
- `constants.js` — new scan and explore phase constants
- `gyroscope.js` — new module (does not exist yet)
- `NavigationLoop.js` — phase state machine, scan loop, explore loop, transition logic
- `prompts.js` — new scan prompt and explore prompt alongside existing navigation prompt
- `speech.js` — no structural changes; new strings added

### Explicitly out of scope
- The normal navigation loop behavior is unchanged
- Safety prompt behavior is unchanged
- GoalTracker, ObstacleRouter, SpeechQueue internals are unchanged
- No backend changes

---

## New Constants (`constants.js`)

Add the following alongside existing constants. Do not modify existing values.

```js
SCAN_INTERVAL_MS         = 500     // 2fps during scan phase
SCAN_YAW_THRESHOLD_DEG_S = 30      // deg/s above which frame is skipped
SCAN_YAW_DEBOUNCE_MS     = 2500    // min ms between "slow down" warnings
SCAN_TIMEOUT_MS          = 20000   // ms before scan gives up and explore begins
SCAN_MIN_CONFIDENCE      = 0.5     // lower bar than GOAL_CONFIDENCE_THRESHOLD;
                                   // navigation_direction at this confidence
                                   // is enough to exit scan or explore phase

EXPLORE_INTERVAL_MS      = 1000    // 1fps during explore phase (user is walking)
EXPLORE_TIMEOUT_MS       = 90000   // ms before explore gives up entirely (90s)
```

---

## New Module: `gyroscope.js`

Create this file. It is a singleton that listens to `DeviceMotionEvent` and exposes two functions.

### Responsibilities
- Track current yaw rate from `event.rotationRate.alpha`
- Expose whether current yaw rate exceeds threshold
- Expose a debounced check for whether a "slow down" warning should be spoken

### API

```js
// Call once on app init (or on first Start tap)
export function initGyroscope() { ... }

// Returns true if phone is rotating faster than SCAN_YAW_THRESHOLD_DEG_S
export function isRotatingTooFast() { ... }

// Returns true if enough time has passed since last warning to warn again
export function shouldWarnRotationSpeed() { ... }
```

### Implementation notes

- `rotationRate.alpha` is yaw (rotation around vertical axis). Use `Math.abs()`.
- `DeviceMotionEvent` requires user gesture on some Android versions. Initialize inside the Start tap handler, not on page load.
- If `DeviceMotionEvent` is not available (desktop, some devices), `isRotatingTooFast()` must return `false` so the scan phase proceeds without blocking.
- `shouldWarnRotationSpeed()` returns true at most once per `SCAN_YAW_DEBOUNCE_MS`. Update the last-warned timestamp inside this function on each true return.
- Gyroscope gating applies only in scan phase. Do not apply it in explore or navigate phases.

---

## Phase State Machine

Add a `phase` variable to NavigationLoop with three values: `'scan'`, `'explore'`, and `'navigate'`.

```
Initial state (on every Start tap): 'scan'

scan → explore:
  Condition: SCAN_TIMEOUT_MS elapsed with no transition to navigate
  Action: cancel scan timer, start explore timer, speak explore announcement,
          set interval to EXPLORE_INTERVAL_MS, switch to EXPLORE_PROMPT

scan → navigate:
  Condition: Claude response contains navigation_direction != null
             AND goal_confidence >= SCAN_MIN_CONFIDENCE
  Action: cancel scan timer, speak transition announcement,
          set interval to LOOP_INTERVAL_MS, switch to NAVIGATION_PROMPT

explore → navigate:
  Condition: Claude response contains navigation_direction != null
             AND goal_confidence >= SCAN_MIN_CONFIDENCE
  Action: cancel explore timer, speak transition announcement,
          set interval to LOOP_INTERVAL_MS, switch to NAVIGATION_PROMPT

explore → stopped:
  Condition: EXPLORE_TIMEOUT_MS elapsed with no transition to navigate
  Action: speak failure message, call Stop

navigate → (any):
  Not implemented. Once in navigate, stay in navigate until Stop.
```

On Stop, reset phase to `'scan'` so next Start begins in scan phase.

---

## Modified: `NavigationLoop.js`

### On Start tap (before loop begins)

1. Call `initGyroscope()`
2. Set `phase = 'scan'`
3. Start scan timeout timer (`SCAN_TIMEOUT_MS`) → calls `onScanTimeout()` if it fires
4. Set interval to `SCAN_INTERVAL_MS`
5. Speak scan instruction (see Speech Strings below) — must enqueue after safety prompt
6. Begin loop

### Each tick in scan phase

```
1. If isRotatingTooFast():
     If shouldWarnRotationSpeed(): speak "A little slower."
     Return (skip this frame)

2. Capture frame from canvas (existing behavior)

3. Send frame to Claude with SCAN_PROMPT (see Prompts below)

4. On response:
     a. If navigation_direction != null AND goal_confidence >= SCAN_MIN_CONFIDENCE:
          Cancel scan timer
          Speak navigation_direction directly (no prefix)
          Set phase = 'navigate'
          Set interval to LOOP_INTERVAL_MS
          Switch to NAVIGATION_PROMPT
          Return

     b. If obstacles array is non-empty:
          Speak obstacle alert via ObstacleRouter (existing behavior)

     c. Otherwise: silence. No speech during scan unless a or b fires.
```

### `onScanTimeout()`

Called when scan timer fires without a transition.

```
1. Cancel scan timer
2. Set phase = 'explore'
3. Start explore timeout timer (EXPLORE_TIMEOUT_MS) → calls onExploreTimeout() if it fires
4. Set interval to EXPLORE_INTERVAL_MS
5. Switch to EXPLORE_PROMPT
6. Speak explore announcement (see Speech Strings)
```

### Each tick in explore phase

```
1. Capture frame from canvas (existing behavior)
   Note: no gyroscope gating — user is walking, not scanning

2. Send frame to Claude with EXPLORE_PROMPT (see Prompts below)

3. On response:
     a. If navigation_direction != null AND goal_confidence >= SCAN_MIN_CONFIDENCE:
          Cancel explore timer
          Speak navigation_direction directly (no prefix)
          Set phase = 'navigate'
          Set interval to LOOP_INTERVAL_MS
          Switch to NAVIGATION_PROMPT
          Return

     b. If obstacles array is non-empty:
          Speak obstacle alert via ObstacleRouter (existing behavior)

     c. If navigation_direction != null (explore direction, not goal direction):
          Speak it. This is how Claude guides the user through the building.

     d. If navigation_direction is null and no obstacles:
          Silence.
```

Note on 3c: in explore mode, Claude returns a navigation_direction that points toward navigable space, not necessarily the goal. The transition check in 3a must come first — if Claude can see the goal, skip explore guidance and transition immediately.

The distinction between 3a and 3c is `goal_confidence`. If `goal_confidence >= SCAN_MIN_CONFIDENCE`, treat as 3a. Otherwise treat as 3c even if `navigation_direction` is non-null.

### `onExploreTimeout()`

Called when explore timer fires without a transition.

```
1. Cancel explore timer
2. Speak failure message (see Speech Strings)
3. Call Stop (full stop — resets phase to scan, clears interval)
```

### Each tick in navigate phase

Identical to current NavigationLoop behavior. No changes.

---

## Prompts (`prompts.js`)

Three prompt functions are needed. The existing navigation prompt is unchanged.

### `buildScanPrompt(goal)`

```
You are helping a visually impaired person find: "[goal]".
They are standing still and slowly rotating their phone to scan the room.

Analyze this camera frame:
- If you can see [goal] or a clear, direct path toward it, provide a navigation direction
  and set goal_confidence to reflect how certain you are.
- If you cannot see anything relevant to [goal], return null for navigation_direction
  and 0.0 for goal_confidence.
- If there is an obstacle close to the user, include it in obstacles.
- Do not guess. Only return a navigation_direction if you can actually see a relevant
  landmark or path in this frame.

Return JSON only, no other text:
{
  "obstacles": [],
  "navigation_direction": "string or null",
  "goal_found": false,
  "goal_confidence": 0.0
}
```

### `buildExplorePrompt(goal)`

```
You are helping a visually impaired person find: "[goal]".
They have scanned the area and could not see [goal] from their starting position.
They are now walking through the building to find it.

Analyze this camera frame and do the following:

1. If you can see [goal] or a sign pointing toward it, provide a navigation direction
   toward it and set goal_confidence accordingly. This takes priority over everything else.

2. If you cannot see [goal] but you can see a hallway, corridor, open path, or directional
   signage, guide the user toward it. Set goal_confidence to 0.0 since you have not found
   the goal yet.

3. If you see an obstacle close to the user, include it in obstacles regardless of the above.

The goal is to get the user moving through the building until [goal] or relevant signage
comes into view. Do not tell the user you cannot find [goal]. Always provide a
navigation_direction unless the path is completely blocked.

Return JSON only, no other text:
{
  "obstacles": [],
  "navigation_direction": "string or null",
  "goal_found": false,
  "goal_confidence": 0.0
}
```

### `buildNavigationPrompt(goal)`

Existing prompt. No changes.

---

## Speech Strings

Add these to whatever string constants or inline locations the codebase uses.

| Trigger | String |
|---|---|
| Scan phase start | "Hold your phone up and slowly scan the area. I'll guide you when I see something." |
| Rotating too fast (scan only) | "A little slower." |
| Transition scan → navigate | Speak `navigation_direction` from Claude directly. No prefix. |
| Scan timeout / explore start | "I'll guide you through the building to find [goal]. Follow my directions." |
| Transition explore → navigate | Speak `navigation_direction` from Claude directly. No prefix. |
| Explore timeout / failure | "I wasn't able to find [goal]. Please ask someone nearby for help." |

Substitute `[goal]` with the actual goal string the user entered.

The scan phase instruction must enqueue in SpeechQueue after the safety prompt. Do not interrupt the safety prompt.

---

## Acceptance Tests

Run on the physical Android device in order.

### Scan phase

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-SC-01 | App loaded, destination typed, first Start of the day | Tap Start | Safety prompt plays, then scan instruction plays. No navigation direction yet. |
| AT-SC-02 | Scan phase active | Rotate phone rapidly | "A little slower." spoken. Repeats no more than once per 2.5 seconds. |
| AT-SC-03 | Scan phase active | Rotate slowly toward a visible destination or sign | Within 2-3 frames of it entering FOV, navigation direction spoken and navigation phase begins. |
| AT-SC-04 | Scan phase active | Tap Stop | Loop stops cleanly. No further speech. |
| AT-SC-05 | After Stop, same calendar day | Tap Start again | Scan phase restarts. Scan instruction plays. Safety prompt does not replay (already spoken once today per FR-UI-03). |
| AT-SC-06 | Scan phase active, close obstacle in frame | Hold phone toward obstacle | Obstacle alert fires. Scan phase continues — does not transition to navigate. |

### Explore phase

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-EX-01 | Destination not visible from starting position | Allow scan to time out (20s) | Explore announcement plays. App does not stop. |
| AT-EX-02 | Explore phase active | Walk slowly holding phone forward | App gives walking directions toward open space or hallways at ~1fps. |
| AT-EX-03 | Explore phase active | Walk until destination sign comes into view | App transitions to navigation phase and speaks direction toward goal. |
| AT-EX-04 | Explore phase active | Tap Stop | Loop stops cleanly. No further speech. |
| AT-EX-05 | Explore phase active | Walk for 90 seconds without finding destination | Failure message plays. Loop stops. |
| AT-EX-06 | Explore phase active, obstacle appears | Walk toward obstacle | Obstacle alert fires. Explore continues. |

### Navigate phase

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-SC-07 | Scan or explore transitions to navigate | Phone pointed at goal path | Navigation directions at 1fps. All existing AT-01 through AT-10 pass. |

---

## Definition of Done

- All scan phase acceptance tests pass on device
- All explore phase acceptance tests pass on device
- AT-SC-07 passes (existing navigation loop unaffected)
- All 10 existing Week 2 acceptance tests (AT-01 through AT-10) still pass
- Safety prompt plays once per calendar day, on the first Start of that day, without exception
- `isRotatingTooFast()` returns false gracefully on any device without `DeviceMotionEvent`
- No console errors during a full scan → explore → navigate session
