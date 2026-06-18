# VisionGuide — Demo Camera Preview Spec

## Purpose

For sighted audiences during a live demo (hackathon judging, pitch), it is
useful to show the rear-camera feed that Claude Vision is actually analysing.
This makes the AI's input visible on screen instead of being an invisible
process.

This is a **presentation aid only**. Visually impaired end users do not need
and will not see this feature. Two layers keep the shipped product unchanged for
them:

1. A build-time `DEMO_MODE` flag (off by default, mirroring `DEV_MODE`) gates
   whether the feature exists in the UI at all. With `DEMO_MODE = false`, there
   is no toggle button and no camera background — the app is byte-for-byte the
   original product.
2. When `DEMO_MODE = true` (a demo build), a small **in-app toggle button**
   appears so the presenter can switch the camera background on and off **at
   runtime** — no code edit, rebuild, or redeploy needed mid-demo. The toggle
   defaults to **off**, so even a demo build opens on the clean UI until the
   presenter taps it.

The camera capture itself (`camera.js`, `getUserMedia`, the navigation loop) is
already implemented and is **not changed** by this spec. The `<video>` element
that holds the live stream already exists in `CameraPreview.jsx` — it is simply
hidden with `opacity: 0`. This spec only makes that element visible when the
runtime toggle is on.

---

## Scope

### Changes required
- `constants.js` — add `DEMO_MODE` flag (off by default)
- `components/CameraPreview.jsx` — takes a `visible` prop; when `visible` is
  true, render the existing `<video>` as a full-screen background, otherwise
  render it hidden exactly as it does today
- `App.jsx` — hold a runtime `showCameraPreview` state (default `false`); when
  `DEMO_MODE` is on, render a small toggle button that flips it; when
  `showCameraPreview` is true, layer the content above the video (relative
  positioning + z-index) and add a readability scrim so the UI text stays legible
  over the feed
- `index.html` — add a minimal body reset (`margin: 0; background: #0f0f0f`) so
  the dark theme reaches the viewport edges. Fixes a pre-existing white border
  (default body margin + white page background) that the camera-on state happened
  to cover; matches the existing `theme-color: #0f0f0f`. Affects the shipped
  product too (it's strictly the intended dark look, edge to edge)

### Explicitly out of scope
- `camera.js` capture, frame grabbing, WakeLock, and frozen-frame logic — unchanged
- The navigation / scan / explore loop behavior — unchanged
- Default (shipped) behavior for end users — unchanged; with `DEMO_MODE = false`
  the rendered output is byte-for-byte the current hidden-video behavior
- Drawing AI detections (obstacles, landmarks) as overlays on the feed — not in
  this spec; possible future enhancement
- Phone-to-laptop screen mirroring / projection — out of band, handled by OS
  tools (QuickTime / scrcpy), not application code
- Accessibility of the preview: the `<video>` keeps `aria-hidden="true"` in both
  modes — screen-reader users must not be affected by a demo-only visual. The
  toggle button itself only renders when `DEMO_MODE` is on, so a shipped
  (`DEMO_MODE = false`) build exposes no extra control to screen-reader users
- Persisting the toggle state across reloads — not required; it resets to off on
  reload, which is acceptable for a presenter-operated control

---

## Flag (`constants.js`)

Add alongside `DEV_MODE`. Do not modify existing values.

```js
export const DEMO_MODE = false; // Set to true in a demo build to expose the camera-preview toggle (presentation only)
```

`DEMO_MODE` only controls whether the toggle button is rendered. The actual
camera background is driven by the runtime toggle state, not by this flag.

---

## CameraPreview behavior (`components/CameraPreview.jsx`)

The component still renders a single `<video ref={videoRef} autoPlay playsInline
muted aria-hidden="true">` element bound to the same stream. It takes a `visible`
prop; only its style changes:

- **`visible === false` (default):** hidden, non-interactive, off-screen
  (`position: absolute; opacity: 0; pointerEvents: none`), clamped to a `1px`
  box so the intrinsic-resolution video can't overflow the viewport and
  mis-anchor the fixed toggle button. Frame capture is unaffected (`getFrame`
  draws from the video's intrinsic size, not its CSS size).
- **`visible === true`:** full-screen background — `position: fixed; inset: 0;
  width/height 100%; objectFit: cover; zIndex: 0`, plus `backgroundColor:
  #0f0f0f` so the element matches the dark theme before the camera stream
  starts.

`aria-hidden="true"` is kept in both cases.

---

## Toggle + App layout behavior (`App.jsx`)

- `App` holds a runtime state `showCameraPreview`, default `false`.
- When `DEMO_MODE === true`, render a small fixed-position toggle button (e.g.
  top-right corner) that flips `showCameraPreview`. It has an accessible label
  (`aria-label`) and reflects state via `aria-pressed`. When `DEMO_MODE ===
  false`, the button is not rendered. The button has a **fixed width** so it does
  not resize between its "Show camera" / "Hide camera" labels, and is
  **color-coded** — green text + border when the preview is shown, red when
  hidden (background stays dark; only text/border color changes).
- `CameraPreview` receives `visible={showCameraPreview}`.
- When `showCameraPreview === true`:
  - The `content` block sits above the video (`position: relative; zIndex: 1`).
  - A semi-transparent dark scrim sits between the video and the content so the
    white title, input, and status text remain legible over an arbitrary camera
    image (`background: rgba(15,15,15,0.55)`, a fixed overlay at `zIndex: 0`),
    and the container background goes transparent so the feed shows through.
- When `showCameraPreview === false`, `App.jsx` renders exactly as it does today
  (the toggle button aside, if `DEMO_MODE` is on).

---

## Acceptance tests

- AT-DM-01: With `DEMO_MODE = false`, the app looks and behaves identically to
  before this change — no toggle button, no visible camera feed; build/lint pass.
- AT-DM-02: With `DEMO_MODE = true`, the app still opens on the clean UI (toggle
  off by default); tapping the toggle and starting navigation shows the live rear
  camera feed full-screen, with the title / input / button / status readable on
  top of it; tapping the toggle again hides it.
- AT-DM-03: In all states the `<video>` element keeps `aria-hidden="true"` and a
  screen reader does not announce it; the toggle button is absent when
  `DEMO_MODE = false`.
- AT-DM-04: `npm run build` and `npm run lint` pass clean.

---

## Definition of done

- `DEMO_MODE` flag added (off by default), gating the toggle button.
- Runtime toggle (default off) shows/hides the full-screen camera background with
  a readability scrim; UI is unchanged when the toggle is off.
- `npm run build` and `npm run lint` pass.
- `progress-tracker.md` updated to record this additive demo-only feature and
  the Week 4 §1 scope note (see OQ-06 precedent).
