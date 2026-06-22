# VisionGuide — Analyzed-Frame Preview Spec

## Purpose

The camera feed (`CameraPreview.jsx`) is rendered fully transparent (`opacity: 0`) — nothing
visual is ever shown on screen. `StatusDisplay.jsx` shows only the spoken instruction text. For a
sighted person looking at the screen alongside the primary (blind/low-vision) user — a companion,
a demo audience, a developer debugging a bad direction — there's no way to see *what the AI
actually saw* when it produced a given instruction.

This spec adds a visible still-image preview of the exact camera frame that was analyzed to
produce the current spoken instruction, displayed next to that instruction in the UI.

---

## Scope

### Changes required
- `src/modules/loop.js` — the three call sites that already call `callbacks.onContextUpdate(direction)`
  immediately after a `callClaude` result pass the analyzed frame through as a second argument.
- `src/App.jsx` — new `lastFrame` state, updated `handleContextUpdate` signature, cleared on
  Stop and on starting a new navigation session, passed down to `StatusDisplay`.
- `src/components/StatusDisplay.jsx` — new `frame` prop, rendered as an `<img>` paired with
  `lastSpoken`.

### Explicitly out of scope
- `src/modules/camera.js` — unchanged. `getFrame()` already returns the base64 JPEG this spec
  needs; no new capture logic.
- `src/components/CameraPreview.jsx` — unchanged. It stays hidden; it's the live `<video>` element
  used for capture, not a display surface. The new preview is a separate, deliberately-displayed
  `<img>` of a single still frame.
- Frames that don't lead to a spoken `navigation_direction` (e.g. "Still scanning", "Turn right
  and stop.", a guided-scan leg that doesn't find the goal) are not shown — only the frame tied to
  the instruction currently on screen.

---

## Behavior

Of the three places in `loop.js` where a frame analysis result becomes a spoken
`navigation_direction` passed to `callbacks.onContextUpdate`:

- scan phase, goal found early
- explore phase
- navigate phase

...each already has the analyzed frame (`getFrame(videoEl)`'s return value, captured at the top
of that tick) in scope at the point it calls `onContextUpdate`. `onContextUpdate` is extended to
take that frame as a second argument: `callbacks.onContextUpdate(direction, frame)`.

`App.jsx`'s `handleContextUpdate(direction, frame)` stores `frame` in new state (`lastFrame`), in
addition to its existing `context` array update. `lastFrame` is reset to `null`:
- when `handleStop` runs (so Stop returns the UI to no-preview, matching its existing "pristine
  state" behavior for camera/speech/loop)
- when a new navigation session starts (`startNavigating`, alongside the existing `setContext([])`
  reset), so a frame from a previous destination never lingers into a new one

`StatusDisplay` receives `lastFrame` as a new `frame` prop. When non-null, it renders:

```jsx
<img
  src={`data:image/jpeg;base64,${frame}`}
  alt="Camera frame analyzed for this instruction"
  style={styles.frame}
/>
```

placed above the existing `lastSpoken` paragraph, inside the same wrapper, so the image and the
instruction it produced are visually grouped. It is **not** inside the `aria-live` region — that
region exists for the primary blind/low-vision user's screen reader, and an image conveys nothing
to that audience; wrapping it would just add redundant DOM to an already-announced live region.

---

## Acceptance Tests

- AT-FP-01: After Start, once the first spoken navigation instruction occurs (scan goal-found,
  explore, or navigate phase), the UI displays a still image. The image is the camera frame that
  produced that instruction, not the live feed.
- AT-FP-02: Ticks that don't produce a spoken `navigation_direction` (e.g. "Still scanning", "Turn
  right and stop.", a guided-scan leg that records but doesn't find the goal) do not change the
  displayed image — it remains the last instruction-producing frame.
- AT-FP-03: Tapping Stop removes the displayed image. Starting a new session (new destination)
  shows no stale image from the previous session until the first new instruction-producing frame
  arrives.
- AT-FP-04: No change to the live camera feed's visibility — `CameraPreview.jsx`'s `<video>`
  remains hidden (`opacity: 0`).

---

## Definition of Done

- `npm run build` and `npm run lint` pass clean.
- Manual on-device/browser test: start navigation, confirm the image updates in step with each new
  spoken instruction and is visibly a real frame from the camera (not blank, not stale across
  Stop/Start).
- `context/progress-tracker.md` and `context/specifications/visionguide-prd.html` updated to
  reflect this spec, per this repo's existing process.
