# VisionGuide — Demo Detection Overlay Spec

## Purpose

Spec 12's on-device CV layer computes, at ~15fps, a per-object bounding box, label, confidence, and risk level for everything the camera sees — but none of that is visible anywhere in the UI today. It only drives spoken hazard alerts (`hazardEvaluator.js`) and a compact text line fed into Claude's prompt (`cvContextBuilder.js`). For demos and stakeholder walkthroughs, it's valuable to *see* the CV working, not just hear it.

This spec adds a purely cosmetic bounding-box overlay on the Navigating screen: a box + label drawn over the same periodically-refreshed still image the app already shows, for the same medium/high-risk objects the hazard system already flags — not every raw detection, to avoid visual noise from low-confidence or background clutter. It is not needed by VisionGuide's actual users (who are visually impaired and rely on audio) and has zero effect on navigation behavior, hazard alerts, or the Claude prompt — it is an additive, `aria-hidden` UI layer only.

Explicitly not a return to live video: `NavigatingView`'s background remains the same still JPEG (`lastFrame`) established in spec 10, refreshed every 0.5–1s. The boxes are captured at the same instant as that still frame, so they can never drift ahead of or behind the image they're drawn over.

## Scope

### New files
- `src/components/DetectionOverlay.jsx` — presentational component: SVG overlay rendering risk-colored boxes + labels for a list of qualifying detections.

### Changes required
- `src/modules/cvContextBuilder.js` — extract the existing medium/high-risk filter+sort out of `build()` into a new exported `getQualifyingObjects()`; `build()` calls it, behavior unchanged.
- `src/modules/loop.js` — capture `cvContextBuilder.getQualifyingObjects()` in the same tick as `getFrame()`, pass it as an added argument through the existing `onFrameCaptured`/`onContextUpdate` callbacks.
- `src/App.jsx` — new `lastDetections` state, set from both frame callbacks, reset alongside every existing `lastFrame` reset, passed down to `NavigatingView`.
- `src/components/NavigatingView.jsx` — accept a `detections` prop, render `<DetectionOverlay>` between the frame `<img>` and the scrims.

### Explicitly out of scope
- Live video (un-hiding the real `<video>` element) — stays still-image only, consistent with spec 10's decision.
- A visibility toggle/debug flag — always renders when qualifying detections exist; no gating mechanism.
- Any change to hazard-alert logic, thresholds, or the Claude CV context text — `estimateRisk.js`, `hazardEvaluator.js`, and `cvContextBuilder.build()`'s output string are unchanged; this is purely an additional read of already-computed data.
- New detection categories, confidence-threshold tuning, or depth-based sizing — reuses spec 12's `estimateRisk` medium/high classification verbatim.
- Any smoothing/interpolation of box position between updates — a box simply reflects whatever `getQualifyingObjects()` returned at the most recent frame-capture instant.

## Architecture

Reuses spec 12's three-loop system unchanged. Adds one synchronous read at the point the existing frame-capture/callback mechanism already fires — no new loop, timer, or interval.

```
Fast loop (~15fps)         Medium loop (333ms)      Slow loop (Claude tick, ~0.5-1s)
cvDetector → cvTracker        hazardEvaluator              loop.js tick()
        \                          |                 ┌──────────────────────┐
         \                         v                 │ frame = getFrame()   │
          \--> cvWorldModel <------+---------------->│ detections =         │
                (snapshot)                            │  getQualifyingObjects() │
                                                       └──────────────────────┘
                                                                  │
                                                 onFrameCaptured/onContextUpdate(frame, detections)
                                                                  │
                                                                  v
                                                   App.jsx: lastFrame + lastDetections state
                                                                  │
                                                                  v
                                        NavigatingView → <img frame> + <DetectionOverlay detections>
```

**Time-lock invariant:** `detections` is read in the same `tick()` invocation as `frame`, before the async Claude call — so the overlay can never show boxes newer or older than the image underneath it, regardless of how long that tick's API round-trip takes.

**Coordinate mapping:** `getFrame()` (`camera.js`) never crops or stretches — the captured JPEG's aspect ratio always equals the raw camera stream's, matching the normalized 0-1 bbox coordinate space (`cvDetector.normalizeDetections()` divides by `videoWidth`/`videoHeight`). The displayed `<img>` uses CSS `object-fit: cover`, which crops to fill `NavigatingView`'s container whenever its aspect ratio differs from the frame's. `DetectionOverlay`'s `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">` reproduces that exact crop-and-fill behavior, so `rect x={originX*100} y={originY*100} width={width*100} height={height*100}` lands correctly regardless of viewport aspect ratio.

## Module Specifications

### `DetectionOverlay.jsx` (new)
- Props: `detections: Array<{ obj: { id, label, boundingBox, confidence, framesVisible, position }, risk: 'high'|'medium' }>`.
- Renders `null` when `detections` is empty.
- Otherwise renders one absolutely-positioned, full-bleed, `aria-hidden="true"` `<svg>` (`viewBox="0 0 100 100"`, `preserveAspectRatio="xMidYMid slice"`).
- Per detection: one stroke-only `<rect>` (no fill) colored by risk — `colors.stop` (red) for `high`, `colors.warnIcon` (orange) for `medium`, both existing tokens from `src/theme.js` — keyed by `obj.id` (the tracker's stable per-object ID, so React never remounts/flickers a box that persists across frames). A small label chip showing `obj.label` is anchored just inside the box's top-left corner (never above it), so it can never render off-canvas when a box touches the top edge.

### `cvContextBuilder.js` (modified)
- New export `getQualifyingObjects()`: reads `cvWorldModel.getSnapshot()`; returns `[]` if missing or stale (older than `CV_CONTEXT_STALENESS_MS`); otherwise maps objects to `{ obj, risk }` via `estimateRisk`, filters to `risk === 'high' || risk === 'medium'`, sorts high-before-medium then closest-first (`boundingBox.height` descending). This is the existing filter/sort logic from `build()`, moved out verbatim.
- `build()`: unchanged behavior — now calls `getQualifyingObjects().slice(0, MAX_CONTEXT_OBJECTS)` instead of inlining the filter.

### `loop.js` (modified)
- Immediately after each `const frame = getFrame(videoEl);`, add `const detections = cvContextBuilder.getQualifyingObjects();`.
- Every existing `callbacks.onFrameCaptured(frame)` call becomes `callbacks.onFrameCaptured(frame, detections)`; every `callbacks.onContextUpdate(direction, frame)` call becomes `callbacks.onContextUpdate(direction, frame, detections)`. Same call sites, one added argument each — no new callback name.

### `App.jsx` (modified)
- New `const [lastDetections, setLastDetections] = useState([]);`.
- `handleFrameCaptured(frame, detections)` and `handleContextUpdate(direction, frame, detections)` both also call `setLastDetections(detections)`.
- Every existing `setLastFrame(null)` reset (session start, Stop, new destination) gets a matching `setLastDetections([])`.
- `<NavigatingView detections={lastDetections} ... />`.

### `NavigatingView.jsx` (modified)
- Add `detections` to the prop list.
- Inside the existing `{frame ? (...) : null}` block, render `<DetectionOverlay detections={detections} />` immediately after the frame `<img>`, before the scrim divs — so the scrims still darken over boxes near the top/bottom edges exactly as they darken the image.

## Acceptance Tests

- AT-DO-01: While navigating with a person close/centered in frame (the same condition that would trigger a spoken "high" risk alert per spec 12), a red box + "person" label appears on the still image at the same time.
- AT-DO-02: While navigating with centered furniture (chair/couch/dining table) in frame, an amber/orange box + label appears.
- AT-DO-03: A distant or low-confidence object that doesn't qualify as medium/high risk gets no box.
- AT-DO-04: When the still image refreshes with a new instruction, the boxes update together with it — never a frame ahead or behind.
- AT-DO-05: On a browser viewport whose aspect ratio differs from the camera stream's, boxes stay visually aligned with the cropped/visible portion of the image, not the full uncropped frame.
- AT-DO-06: No boxes render before the first frame arrives, immediately after Stop, or when CV init failed — no crash, no stale boxes leaking from a prior session.
- AT-DO-07: Screen-reader/accessibility tree is unaffected — the overlay is never announced, and the existing `aria-live` instruction banner still fires exactly as before.

## Definition of Done

- `npm run build` and `npm run lint` pass clean.
- AT-DO-01 through AT-DO-07 verified manually in-browser.
- No change in behavior for spec 12's existing AT-CV-01 through AT-CV-07 — spoken hazard alerts and the Claude CV context string are unaffected.
- `context/progress-tracker.md` updated recording this spec as written and implemented.
