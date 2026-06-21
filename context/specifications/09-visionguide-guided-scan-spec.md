# VisionGuide — Guided Scan & Direction-Accuracy Spec

## Purpose

Three related navigation-guidance problems were reported from real use:

1. During active navigation, Claude sometimes told the user to "turn around" toward a wall.
   `buildSystemPrompt`'s spatial-word rule explicitly allowed `behind` as a direction word, but
   the camera only ever sees forward — there is no visual evidence of what's behind the user, so
   "turn around" was always a guess, and just as likely to face a second wall as an opening.

2. The old free-rotation scan phase (`05-visionguide-scan-phase-spec.md`) told the user to "hold
   your phone up and slowly scan the area" for up to `SCAN_TIMEOUT_MS` (20s), with no sense of
   which direction was which. When the scan timed out, the hand-off message ("I'll guide you
   through the building... follow my directions") gave no actual direction. If the camera
   happened to be facing a wall at that moment, the very next explore-phase frame could come back
   with `navigation_direction: null` — which was silently dropped, leaving the user standing with
   no indication of which way to go.

3. Direction reports were sometimes mirrored — e.g. two doors visibly on the user's left
   described as being on the right. Confirmed not a code/mirroring bug: `camera.js` captures the
   raw rear-camera (`facingMode: 'environment'`) frame with no flip/transform anywhere in the
   pipeline, and `CameraPreview.jsx`'s `<video>` element is hidden, not displayed, so there's
   nothing to mis-render. This is a known vision-model spatial-reasoning weakness (see
   `prompt-tuning-log.md`'s "Wrong direction" failure category), mitigated here with an explicit
   self-check rule rather than "fixed" outright.

This spec replaces the free-rotation scan with an **actively guided 4-direction scan**: the app
instructs the user to turn ~90° right and stop, four times in a row (covering ahead, right,
behind, left relative to where they started), looks at one still frame per stop, and remembers
what each direction looked like. If the goal isn't found directly, it tells the user the single
most promising direction to turn and go, instead of leaving them standing with no direction. It
also tightens the navigate/explore prompts so the model never recommends a direction it has no
visual evidence for, and adds a left/right self-check to reduce mirrored-direction reports.

---

## Scope

### Changes required
- `src/constants.js` — new guided-scan-leg constants.
- `src/prompts/system.js` — `buildSystemPrompt` and `buildExplorePrompt` tightened (no
  `behind`/"turn around", explicit blocked-path handling, left/right self-check);
  `buildScanPrompt` replaced by `buildGuidedScanLegPrompt`.
- `src/modules/gyroscope.js` — gains signed turn-angle accumulation and an iOS motion-permission
  request, on top of the existing rotation-speed gate.
- `src/modules/guidedScan.js` — new module, owns the 4-leg state machine.
- `src/modules/loop.js` — scan-phase tick body rewritten to drive `guidedScan` instead of
  continuous free-rotation polling; explore-phase branch gains a non-silent fallback line.

### Explicitly out of scope
- The `navigate` phase's tick body (staleness guard, landmarks, arrival, obstacle routing) is
  unchanged — only its system prompt's wording changed, not its control flow.
- `obstacles.js`, `goalTracker.js`, `landmarks.js`, `goalMemory.js`, `speech.js`, `camera.js`,
  `App.jsx` — unchanged. The existing scan-instruction speech hand-off (enqueue after the safety
  prompt) still works the same way; only the instruction text changed.
- `EXPLORE_TIMEOUT_MS`/`onExploreTimeout` behavior — unchanged. Explore phase still gives up after
  90s with the existing "ask someone nearby" message.
- No compass/magnetometer use. Turn detection uses only relative gyroscope rotation (or a timer
  fallback) — never an absolute heading, and never spoken to the user as a compass direction.

---

## New Constants (`constants.js`)

```js
export const SCAN_LEG_TURN_TARGET_DEG = 90;     // target turn per leg (ahead/right/behind/left)
export const SCAN_LEG_TURN_TOLERANCE_DEG = 10;  // accept the turn as "done" within +/-10 deg of target
export const SCAN_LEG_NO_GYRO_TIMEOUT_MS = 2500; // fallback dwell time per leg when no gyro data is available
export const SCAN_LEG_SETTLE_MS       = 600;    // brief pause after "stop" before capturing, to avoid motion blur
export const SCAN_MIN_PATH_OPENNESS   = 0.4;    // minimum path_openness to commit to a direction instead of falling back to explore
```

`SCAN_TIMEOUT_MS` is retained, repurposed as an overall safety-net timeout for the whole 4-leg
scan (in case a leg's turn-detection never resolves) rather than a single free-rotation timer.

---

## Modified Module: `gyroscope.js`

Existing rotation-speed gate (`isRotatingTooFast`/`shouldWarnRotationSpeed`) is unchanged. Added:

- **iOS motion permission**: `initGyroscope()` now calls `DeviceMotionEvent.requestPermission()`
  when present (fire-and-forget — it's already invoked from the Start tap's gesture context via
  `loop.js`'s `startLoop`). Without this, iOS 13+ Safari/Chrome would never fire `devicemotion`
  events at all, silently breaking guided-scan turn detection.
- **Signed turn accumulation**: each `devicemotion` event integrates `rotationRate.alpha * dt`
  (seconds since the previous event) into a running accumulator, ignoring implausible gaps
  (`dt >= 1s`, e.g. a backgrounded tab) so a stale timestamp can't inject one huge jump.
- `resetTurnAccumulator()` — zero the accumulator; called at the start of each leg's turn.
- `getAccumulatedTurnDegrees()` — absolute degrees turned since the last reset.
- `hasGyroData()` — true once at least one real `devicemotion` event has been observed. False
  means no usable sensor (denied permission, or no `DeviceMotionEvent` support) — callers fall
  back to a timer.

---

## New Module: `guidedScan.js`

Owns the 4-leg state machine; `loop.js` drives it tick-by-tick since it owns frame capture and
the Claude call.

**Legs**, in order, each reached by turning ~90° right from the previous stop:
`['ahead', 'right', 'behind', 'left']`.

**Per-leg flow** (driven by `loop.js`'s tick, at `SCAN_INTERVAL_MS` cadence):
1. `awaiting_turn` — only for legs 1–3 (leg 0 needs no turn). Each tick calls
   `checkTurnProgress()`, which moves to `settling` once `getAccumulatedTurnDegrees()` is within
   `SCAN_LEG_TURN_TOLERANCE_DEG` of `SCAN_LEG_TURN_TARGET_DEG`, OR (no gyro data at all) once
   `SCAN_LEG_NO_GYRO_TIMEOUT_MS` has elapsed since the turn began.
2. `settling` — a `SCAN_LEG_SETTLE_MS` dwell (avoids capturing a motion-blurred frame right as
   the user stops).
3. `ready` — `loop.js` captures a frame and calls Claude with `buildGuidedScanLegPrompt`.

**Decision logic** (`decide()`, called once all 4 legs are recorded without an early goal find):
- Score each leg: 0 if any of its obstacles has `urgency: "high"`, otherwise its `path_openness`.
- Pick the highest-scoring leg. If the best score is below `SCAN_MIN_PATH_OPENNESS`, return
  `{ type: 'none' }` (no direction stands out).
- Otherwise compute the turn needed from the user's current facing (after leg 3, that's `left`,
  270° clockwise from the start) to the winning leg's heading, normalized to the shorter rotation
  (`normalizeTurnDelta`), and return `{ type: 'direction', instruction }` — e.g. "Turn right, I
  saw an open hallway that way," "Turn around, there's a clearer path behind you," or "Stay
  facing this way" if the winning leg is the one currently faced.

**Early exit**: if any leg's frame finds the goal (`goal_confidence >= SCAN_MIN_CONFIDENCE`),
`loop.js` skips the remaining legs entirely and transitions straight to `navigate` phase, exactly
like the old scan phase's early exit.

---

## Modified Prompt: `system.js`

### `buildGuidedScanLegPrompt(goal)` (replaces `buildScanPrompt`)

Same single-still-frame analysis as the old scan prompt, plus a `path_openness` field used to
rank directions when the goal isn't directly visible:

```js
{
  "obstacles": [...],
  "navigation_direction": "string or null",
  "goal_found": boolean,
  "goal_confidence": number,
  "path_openness": number   // 0.0–1.0: how open/navigable this direction looks
                             // (clear corridor/doorway/signage vs. wall/dead end/clutter)
}
```

### `buildSystemPrompt` (navigate phase)

- Spatial words narrowed to `left, right, ahead` — `behind`/"turn around" removed; the rule now
  states plainly that the camera only sees forward, so the model has no evidence for what's
  behind the user.
- New rule: if the path ahead is blocked, choose left/right based on which side of *the current
  frame* shows an opening; if neither side does, say so explicitly instead of guessing.
- New rule: before stating left or right, locate the object in the frame first (left half of the
  image = user's left, right half = user's right; the image is not mirrored) and state the
  matching side — a direct mitigation for the left/right swap symptom.

### `buildExplorePrompt`

Same three additions as above, applied to the explore-phase instructions: never returns a silent
null direction when blocked (always left/right or an explicit "no clear path" statement), never
says "behind"/"turn around", and applies the same left/right self-check.

---

## Modified: `loop.js`

### `startLoop()`
- Calls `guidedScan.resetGuidedScan()` alongside the existing `resetObstacles`/`resetGoalTracker`/
  etc. resets.
- Initial scan instruction changed from "Hold your phone up and slowly scan the area..." to
  "Hold your phone up, facing forward, and hold still." (leg 0 needs no turn).
- `scanTimerId` (`SCAN_TIMEOUT_MS`) now documented as the overall safety net for the whole 4-leg
  sequence, not a single free-rotation timer.

### Each tick in scan phase
- If `guidedScan.isAwaitingTurn()`: check turn progress; on completion, speak "Stop." and return
  (no capture this tick).
- If `guidedScan.isSettling()`: check settle progress and return (no capture this tick).
- Otherwise (`ready`): fall through to the existing capture/call-Claude path, using
  `buildGuidedScanLegPrompt`.
- On a non-stale, non-goal result: record the leg result. If more legs remain, advance
  (`beginNextLegTurn()`) and speak "Turn right and stop." If that was the last leg, call
  `finishGuidedScan()`.
- Goal-found short-circuit (any phase, any leg) is unchanged in spirit: clears both phase timers,
  switches straight to `navigate`, speaks the model's `navigation_direction`.

### `finishGuidedScan()` (new)
Calls `guidedScan.decide()`. If it returns a direction, hands off to explore phase speaking that
specific instruction. If it returns `none`, falls back to the existing generic hand-off
(`onScanTimeout`'s message) — no regression for the "nothing stood out" case.

### `transitionToExplore(message)` (new, factored out of the old `onScanTimeout`)
Shared by `onScanTimeout` (safety-net timer) and `finishGuidedScan` (normal completion): clears
the scan safety timer, switches phase to `explore`, arms `onExploreTimeout`, swaps the tick
interval to `EXPLORE_INTERVAL_MS`, and speaks the given message.

### Each tick in explore phase
Unchanged except: when `result.navigation_direction` is falsy on a non-stale frame, speaks a
fallback line ("I don't see a clear path. Try turning left or right.") instead of staying silent.

---

## Speech Strings

| Event | String |
|---|---|
| Scan start (leg 0) | "Hold your phone up, facing forward, and hold still." |
| Turn between legs | "Turn right and stop." |
| Turn detected complete | "Stop." |
| Guided scan finds a direction | the computed instruction, e.g. "Turn right, I saw an open hallway that way." / "Turn around, there's a clearer path behind you." / "Stay facing this way." |
| Guided scan finds nothing | "I'll guide you through the building to find {goal}. Follow my directions." (unchanged from old scan-timeout message) |
| Explore frame with no direction | "I don't see a clear path. Try turning left or right." (new) |

---

## Acceptance Tests

### Guided scan
- AT-GS-01: On Start, the app speaks the "hold still, facing forward" instruction, then "Turn
  right and stop" three more times, with "Stop." spoken each time a ~90° turn is detected.
- AT-GS-02: If the goal is visible during any leg with sufficient confidence, the loop
  short-circuits straight to `navigate` phase and speaks that leg's `navigation_direction` —
  remaining legs are skipped.
- AT-GS-03: If no leg finds the goal but one leg has clearly higher `path_openness` than the
  others, the app speaks a concrete turn instruction toward that leg's direction before entering
  explore phase.
- AT-GS-04: If all 4 legs score below `SCAN_MIN_PATH_OPENNESS` (or are blocked by a high-urgency
  obstacle), the app falls back to the existing generic explore hand-off message — same as a
  pre-guided-scan timeout.
- AT-GS-05: On a device/browser with no `DeviceMotionEvent` support (or denied iOS permission),
  each leg still completes via the `SCAN_LEG_NO_GYRO_TIMEOUT_MS` timer fallback instead of hanging
  indefinitely.
- AT-GS-06: If a leg's turn never resolves at all, `SCAN_TIMEOUT_MS` still fires and falls back to
  explore phase exactly as the old scan timeout did.

### Direction accuracy
- AT-DA-01: Navigate-phase guidance never contains "behind" or "turn around" — at a dead end, it
  either picks left/right toward a visible opening or states there's no clear path.
- AT-DA-02: Explore-phase guidance never goes silent on a non-stale frame, even if Claude returns
  a null `navigation_direction`.
- AT-DA-03 (spot-check, mitigation not a hard guarantee): an object clearly on one side of the
  frame is reported on the matching side.

---

## Definition of Done

- `npm run build` and `npm run lint` pass clean.
- Manual on-device test of the full guided-scan sequence (with gyroscope available) reaches a
  decision and hands off to explore/navigate correctly.
- Manual test with gyroscope unavailable confirms the timer fallback still completes all 4 legs.
- `context/progress-tracker.md` and `context/specifications/visionguide-prd.html` updated to
  reflect this spec, per this repo's existing process.
