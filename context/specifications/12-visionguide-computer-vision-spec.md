# VisionGuide — On-Device Computer Vision Layer Spec

## Purpose

Claude vision runs at ~1fps — the API round-trip (capture → encode → POST → inference → response)
takes 2–4s at p50. A person walking toward the user can close 1m in under a second. The gap
between Claude's 1s polling cadence and real-world obstacle dynamics is a safety latency problem
that the existing obstacle module, built around Claude's 1fps results, cannot close on its own.

This spec adds MediaPipe Object Detection running at ~15fps on-device as a parallel fast layer. It
does **not** replace Claude vision: Claude continues to handle navigation reasoning, goal
recognition, and spatial understanding. CV fills the gaps between Claude calls with continuous
scene awareness — firing immediate safety alerts when a high-risk object is detected, and enriching
each Claude prompt with a compact snapshot of what the on-device model currently sees.

The architecture is three loops at different rates, sharing state through a single atomic world
model:

- **Fast loop** (~15fps, rAF): Detector → Tracker → WorldModel
- **Medium loop** (~3fps, 333ms): HazardEvaluator → estimateRisk → obstacles.js → audio
- **Slow loop** (~1fps, existing): ContextBuilder → Claude API

---

## Scope

### New files

- `src/modules/cvDetector.js` — MediaPipe wrapper (raw frame detections)
- `src/modules/cvTracker.js` — IoU centroid tracker (stable object IDs across frames)
- `src/modules/cvWorldModel.js` — Atomic JSON world state (replace-not-mutate snapshot)
- `src/modules/cvContextBuilder.js` — World state → compact Claude prompt string
- `src/modules/hazardEvaluator.js` — Risk evaluation and audio routing
- `src/utils/estimateRisk.js` — Risk abstraction function (designed as seam for future depth model)

### Changes required

- `src/constants.js` — CV threshold and loop-timing constants
- `src/api/claude.js` — `buildUserMessage()` accepts optional `cvContext` string
- `src/modules/loop.js` — start/stop CV with the navigation loop; pass CV context to Claude
- `src/App.jsx` — pass video element ref to `startLoop()` so cvDetector can be initialized
- `package.json` — add `@mediapipe/tasks-vision`

### Explicitly out of scope

- Replacing Claude vision — Claude's role (navigation, goal recognition, spatial reasoning)
  is unchanged and the raw image continues to be sent on every Claude call
- OCR / text detection — Claude continues to handle sign reading in frames
- Depth estimation — reserved for a future spec; `estimateRisk()` includes a `depthEstimate`
  parameter seam but ignores it today
- Model alternatives (YOLO, TF.js COCO-SSD) — MediaPipe EfficientDet-Lite0 only for this spec
- UI changes — no visual components change; CV operates entirely in the background

---

## Architecture

### Three-loop event system

```
Fast loop   (~15fps, rAF):    cvDetector → cvTracker → cvWorldModel.update()
Medium loop (~3fps,  333ms):  hazardEvaluator → cvWorldModel.getSnapshot() → estimateRisk → audio
Slow loop   (~1fps,  1000ms): cvContextBuilder → cvWorldModel.getSnapshot() → Claude prompt
```

JavaScript's single-threaded event loop means no true concurrency races exist between synchronous
operations across these loops. No orchestrator or event bus is needed.

**Latency contract:** every consumer calls `cvWorldModel.getSnapshot()` — the most recently
completed tracker output. WorldModel replaces its entire internal snapshot atomically on each
tracker update (replace-not-mutate). No consumer holds a reference across ticks, so the snapshot
each loop reads is always a fully-consistent frame.

### Data flow

```
Camera feed (existing <video> element)
    │
    ▼
cvDetector.js       Raw MediaPipe detections per frame
    │
    ▼
cvTracker.js        Stable-ID tracked objects via IoU centroid matching
    │
    ▼
cvWorldModel.js     Atomic JSON snapshot (replaced each fast-loop tick)
    │
    ├──► cvContextBuilder.js  → compact string → Claude prompt  (slow loop)
    │
    └──► hazardEvaluator.js   → estimateRisk() → obstacles.js  (medium loop)
```

---

## Module Specifications

### `src/modules/cvDetector.js`

Wraps `@mediapipe/tasks-vision` ObjectDetector.

- Model: EfficientDet-Lite0 (~4MB, ~15–20fps on iPhone A-series, ~10–15fps on mid-range Android)
- Running mode: `"VIDEO"` (continuous), max 5 results, detection confidence threshold:
  `CV_CONFIDENCE_THRESHOLD` (0.5)
- Shares the existing `<video>` element already used by `camera.js` — no second camera stream
- Exposes: `init(videoEl)`, `start()`, `stop()`
- Drives the fast loop via `requestAnimationFrame`; on each frame, calls `cvTracker.update()` with
  raw detections and then `cvWorldModel.update()` with the tracker's output
- `stop()` cancels the rAF loop and closes the MediaPipe ObjectDetector

### `src/modules/cvTracker.js`

IoU (Intersection over Union) centroid matching across frames.

- On each frame, matches new raw detections to the previous frame's tracked objects by IoU score;
  any detection whose best IoU match is below 0.3 is treated as a new object
- Assigns stable ascending integer IDs to newly seen objects
- Tracks `framesVisible` (incremented each matched frame) and smooths `confidence` as a running
  average over matched frames
- Evicts objects not matched for `CV_EVICTION_FRAMES` (5) consecutive frames — prevents ghost
  objects from lingering in the world model
- Derives `position` from bounding box centroid: `x < 0.33` → `"left"`,
  `x > 0.67` → `"right"`, else `"center"`
- Exposes: `update(rawDetections) → trackedObjects[]`

### `src/modules/cvWorldModel.js`

Single atomic snapshot store.

- Stores `_latestSnapshot`, a plain object replaced in full on each fast-loop tick
  (replace-not-mutate — no field-level mutation)
- `update(trackedObjects, timestamp)` replaces `_latestSnapshot` synchronously
- `getSnapshot()` returns `_latestSnapshot` (or `null` before first update)

Snapshot shape:
```json
{
  "objects": [
    {
      "id": 3,
      "label": "person",
      "boundingBox": { "originX": 0.2, "originY": 0.3, "width": 0.3, "height": 0.4 },
      "confidence": 0.91,
      "framesVisible": 8,
      "position": "center"
    }
  ],
  "frameTimestamp": 1234567890
}
```

### `src/utils/estimateRisk.js`

Pure function. Signature includes a `depthEstimate` seam for a future depth model (ignored today):

```js
estimateRisk({ label, boundingBox, confidence, framesVisible, depthEstimate = null })
  → "high" | "medium" | "low" | "none"
```

Risk logic (depth ignored until a depth model is integrated):

| Level | Conditions |
|---|---|
| `"none"` | `confidence < CV_RISK_CONFIDENCE_MIN` (0.7), or `framesVisible <= 1` (not yet confirmed) |
| `"low"` | Any object above confidence minimum not meeting medium/high criteria |
| `"medium"` | Large furniture (`chair`, `couch`, `dining table`) in `"center"` position above confidence minimum; or `"person"` above confidence minimum but `boundingBox.height <= CV_PROXIMITY_THRESHOLD` |
| `"high"` | `label === "person"` AND `boundingBox.height > CV_PROXIMITY_THRESHOLD` (0.35) AND `confidence > CV_RISK_CONFIDENCE_MIN` AND `framesVisible > 3` |

Label weighting is explicit: a person is higher risk than equivalently-sized furniture, independent
of bounding box size (a distant person with a small box still outranks a close potted plant).

### `src/modules/hazardEvaluator.js`

Runs on the medium loop (every `CV_MEDIUM_LOOP_MS`, 333ms).

- Reads `cvWorldModel.getSnapshot()`; returns immediately if snapshot is null or older than
  `CV_CONTEXT_STALENESS_MS` (1000ms)
- Calls `estimateRisk()` on each object in the snapshot
- Fires audio alert via existing `obstacles.js` `routeObstacles()` at HIGH priority when ALL:
  - `estimateRisk()` returns `"high"`
  - Object's label class has not been alerted in the last `CV_ALERT_COOLDOWN_MS` (3000ms)
  - The speech module's last utterance finished more than 2000ms ago (deference to active Claude
    navigation guidance — CV doesn't interrupt mid-sentence)
- Alert text is brief and standardized (not generated by Claude):
  `"person ahead"`, `"obstacle ahead"` — derived from `label` and `position`
- Exposes: `start()`, `stop()` — start/stop the medium-loop `setInterval`

### `src/modules/cvContextBuilder.js`

Called once per slow-loop Claude tick from `loop.js`.

- Reads `cvWorldModel.getSnapshot()`; returns `null` if snapshot is null or stale
  (> `CV_CONTEXT_STALENESS_MS` old)
- Filters to objects with `estimateRisk()` result of `"medium"` or `"high"` only, max 3 objects
- Returns a compact English string:
  `"CV: person center (high risk), chair right (medium risk)"`
- Returns `null` when no qualifying objects — Claude prompt is sent without any CV prefix
- Exposes: `build() → string | null`

---

## Integration Changes

### `src/constants.js`

```js
export const CV_CONFIDENCE_THRESHOLD = 0.5;    // MediaPipe detector init threshold
export const CV_RISK_CONFIDENCE_MIN  = 0.7;    // minimum confidence for alert or context inclusion
export const CV_PROXIMITY_THRESHOLD  = 0.35;   // bounding box height above which object is "close"
export const CV_ALERT_COOLDOWN_MS    = 3000;   // per-class cooldown between hazard audio alerts
export const CV_CONTEXT_STALENESS_MS = 1000;   // max snapshot age for Claude context inclusion
export const CV_MEDIUM_LOOP_MS       = 333;    // hazardEvaluator interval (~3fps)
export const CV_EVICTION_FRAMES      = 5;      // frames before an unmatched object is evicted
```

### `src/api/claude.js` — `buildUserMessage()`

Add optional `cvContext` parameter (fifth argument, after existing `scanSummary`). When non-null,
prepend as the first line of the text block:

```js
export function buildUserMessage(goal, context, base64Frame, scanSummary, cvContext) {
  // ...
  const textParts = [
    cvContext,           // null when no qualifying CV objects — filtered out below
    `Goal: ${goal}`,
    contextText,
    scanSummary,
    landmarkText,
    goalMemoryHint,
    spatialMemoryHint,
    'Analyze this frame.',
  ].filter(Boolean).join('\n');
```

### `src/modules/loop.js`

- Import `cvDetector`, `hazardEvaluator`, `cvContextBuilder`
- `startLoop()`: call `cvDetector.init(videoEl)`, `cvDetector.start()`, `hazardEvaluator.start()`
- `stopLoop()`: call `cvDetector.stop()`, `hazardEvaluator.stop()`
- Each `callClaude(...)` call site: pass `cvContextBuilder.build()` as `cvContext` to
  `buildUserMessage(goal, context, frame, scanSummary, cvContextBuilder.build())`

### `src/App.jsx`

`startLoop` already receives `videoEl` as its first argument. No signature change. The CV
initialization happens inside `loop.js`'s `startLoop()` using the existing video element.

---

## Acceptance Tests

- **AT-CV-01**: After Start, browser DevTools → Console shows a "CV detector ready" log within 5s.
- **AT-CV-02**: Hold the phone toward a person. Within ~1s, a brief spoken alert fires ("person
  ahead") without waiting for the next Claude response. Confirms medium loop fires independently of
  the slow Claude loop.
- **AT-CV-03**: Walk toward a chair in an otherwise clear corridor. The Claude API request visible
  in DevTools → Network includes a `"CV: chair..."` prefix line in the request body. Confirms
  context builder enriches Claude prompts when qualifying objects are present.
- **AT-CV-04**: Point phone at an empty hallway. No CV audio alert fires. Confirms alert suppression
  when no high-risk objects are present.
- **AT-CV-05**: Press Stop. No further CV audio fires. DevTools confirms no further rAF callbacks
  from cvDetector. Confirms clean teardown.
- **AT-CV-06**: While Claude is speaking a navigation direction, a CV alert for an object that
  appeared mid-sentence does not interrupt until speech ends. Confirms speech-deference logic.
- **AT-CV-07**: The same CV alert class does not fire more than once per `CV_ALERT_COOLDOWN_MS`
  (3s). Confirm by pointing at a person and counting alert frequency over 10s (≤ 3 alerts).

---

## Definition of Done

- `npm install`, `npm run build`, and `npm run lint` all pass clean.
- AT-CV-01 through AT-CV-07 pass on a physical device (iPhone iOS Safari or Chrome).
- Existing acceptance tests AT-01–AT-W4-12, AT-SC-01–07, AT-EX-01–06 still pass — navigation,
  obstacle detection, and arrival behavior are unchanged.
- `context/progress-tracker.md` and `context/specifications/visionguide-prd.html` updated to
  reflect this spec, per this repo's existing process.
