# VisionGuide — Clarity UI Redesign Spec

## Purpose

The current UI is a single dark page that stacks every control (title, destination input, start/stop
button, status card) on one screen. The "Clarity" design direction (see the design mockup) replaces
this with a **four-screen flow** — Onboarding → Set destination → Navigating → Arrived — in a calm,
high-contrast light theme using accessibility-oriented type (Public Sans for display, Atkinson
Hyperlegible for body). The Navigating screen adopts a Google-Maps-style layout: the analyzed camera
frame fills the background, a single large instruction banner sits on top, and a Stop action docks at
the bottom.

This is a **presentation-layer redesign only**. None of the navigation logic changes: the capture
loop, Claude API calls, obstacle/goal detection, scan/explore phase machine, speech, and the
auto-listen voice flow are all untouched. The app already holds the state these screens need
(`showOnboarding`, `status` ∈ idle | listening | navigating | arrived, `goal`, `lastSpoken`,
`lastFrame`) — this spec re-renders that existing state as four distinct screens.

---

## Scope

### Changes required
- `index.html` — load the two webfonts (Public Sans, Atkinson Hyperlegible); body reset to the light
  theme background; update `theme-color`.
- `src/theme.js` — **new**, a small shared tokens module (`colors`, `fonts`) so the screens share one
  palette instead of duplicating hex values. Not a CSS framework — just constants, consistent with the
  repo's inline-styles convention.
- `src/App.jsx` — render a **screen switch** keyed off existing state (no logic/state changes beyond a
  small `handleNewDestination` reset handler): Onboarding → SetDestination → Navigating → Arrived. The
  hidden capture `<video>` (`CameraPreview`) stays mounted in all post-onboarding screens so the loop
  keeps capturing.
- `src/components/Onboarding.jsx` — restyle to the light Clarity card (copy unchanged).
- `src/components/GoalInput.jsx` — restyle light; the voice control becomes a full-width "Speak
  instead" button below the input (same recognition behavior).
- `src/components/StartStopButton.jsx` — restyle to the emerald "Start navigation" pill (Stop and
  "New destination" actions live in their own screens; see below).
- `src/components/StatusDisplay.jsx` — simplify to a small `aria-live` announcement strip used on the
  Set-destination screen (status + `lastSpoken`, e.g. the "Camera access denied" message). The frame
  image moves out of here (see Navigating).
- `src/components/NavigatingView.jsx` — **new**. Full-bleed analyzed-frame background + readability
  scrim + top instruction banner (the `aria-live` region carrying `lastSpoken`) + "LIVE" badge +
  docked Stop button.
- `src/components/ArrivedView.jsx` — **new**. Success check, "You've arrived", destination name, a
  generic arrival message, and a "New destination" button.

### Explicitly out of scope
- `src/modules/*` — loop, camera, speech, obstacles, goalTracker, landmarks, gyroscope, destination,
  recognition, spatialMemory, guidedScan, claude API: **all unchanged**. No new data is produced.
- The auto-listen voice flow and the safety/holding prompts in `App.jsx` — unchanged.
- **Distance ("12 m" in the mockup)** — dropped. The app does not compute distance; the banner
  subtitle shows only the destination ("→ Elevator"), no distance. (Decision b.)
- **Live video on the Navigating screen** — not used. Per decision (a), the Navigating background is
  the **spec-10 still frame** (`lastFrame`), i.e. the exact frame analyzed for the current
  instruction — not the live feed. `CameraPreview.jsx` stays hidden (capture only), exactly as
  `10-visionguide-frame-preview-spec.md` requires.
- The mockup's separate obstacle chip ("Chair on your left — keep right") as a distinct banner — not
  added, because obstacle alerts and navigation directions both flow through the same `onSpeak →
  lastSpoken` channel; separating them would require loop plumbing changes, which are out of scope.
  Whatever was last spoken (direction or obstacle) shows in the single instruction banner.

---

## Design tokens (`src/theme.js`)

```js
export const colors = {
  ink: '#0E1A17',          // primary text
  inkMuted: '#516660',     // secondary text
  inkFaint: '#8a958f',     // labels / eyebrows
  emerald: '#06857A',      // primary brand / actions
  emeraldTint: '#E2F4F0',  // light fills
  accent: '#11A892',
  surface: '#FFFFFF',      // light screen background
  page: '#FFFFFF',         // app/body background
  dark: '#0d1426',         // navigating background (behind frame)
  stop: '#D63B3B',         // stop action
  warnBg: '#FFF1E2',
  warnBorder: '#FFD9AE',
  warnIcon: '#C25A00',
  warnText: '#9A4A00',
  white: '#FFFFFF',
};

export const fonts = {
  display: "'Public Sans', system-ui, sans-serif",     // headings, buttons, numbers
  body: "'Atkinson Hyperlegible', system-ui, sans-serif", // body, input, instruction text
};
```

Contrast: every text/background pair must meet WCAG AA (≥4.5:1 for body, ≥3:1 for large text). The
chosen tokens satisfy this (`ink`/`white`, `white`/`emerald`, `warnText`/`warnBg`).

---

## Screens

### 1. Onboarding (`showOnboarding === true`)
Light card on a dimmed backdrop. "Welcome to VisionGuide", short description, the existing 4 numbered
steps in emerald-tinted number chips, the white-cane warning chip (warn tokens), and a full-width
emerald "Got it" button. `role="dialog"`, `aria-modal`, `autoFocus` on the button — unchanged a11y.

### 2. Set destination (`status` idle or listening, not navigating/arrived)
- "VisionGuide" wordmark, plus a small "● READY" pill (emerald on `emeraldTint`) top-right.
- "Where to?" display heading.
- "DESTINATION" label, the text input (`GoalInput`), then a full-width outlined "Speak instead"
  button that triggers the existing recognition flow.
- A bottom full-width emerald "Start navigation" pill (`StartStopButton`).
- The `StatusDisplay` `aria-live` strip renders here to announce `lastSpoken` (e.g. camera-denied error).

### 3. Navigating (`status === 'navigating'`)
- Background: `lastFrame` as a full-bleed `<img>` (`objectFit: cover`); when `lastFrame` is null (the
  ~2.5s holding-instruction window before the first analyzed frame), fall back to the `dark` color.
- Top/bottom dark scrims for legibility.
- Top **instruction banner** (emerald): a decorative forward-arrow icon (`aria-hidden`), the spoken
  instruction (`lastSpoken`) as the **`aria-live="assertive"` `aria-atomic` region**, and a subtitle
  "→ {goal}" (no distance).
- A small "● LIVE" badge.
- A docked full-width red Stop button (`aria-label="Stop navigation"`, ≥56px) calling `onStop`.

### 4. Arrived (`status === 'arrived'`)
- Centered emerald check-circle, "YOU'VE ARRIVED" eyebrow, the destination name (`goal`) large, a
  generic message ("You've reached your destination."), and a full-width emerald "New destination"
  button that calls `handleNewDestination` (resets to the Set-destination screen: `status` → idle,
  clears `goal` and `lastSpoken`).

---

## Accessibility requirements (must not regress)
- The instruction `aria-live="assertive"`/`aria-atomic` region is preserved (now in `NavigatingView`).
- All actionable controls keep a min 56px touch target and an `aria-label`.
- Decorative SVGs/badges are `aria-hidden`.
- The analyzed-frame `<img>` keeps a meaningful `alt` and is **not** inside an `aria-live` region
  (per spec 10 — it conveys nothing to a screen-reader user).
- Contrast pairs meet WCAG AA (see tokens).

---

## Acceptance Tests
- AT-CR-01: Fresh load shows the Onboarding card (light theme, Public Sans/Atkinson fonts). "Got it"
  dismisses it and the existing auto-listen flow begins (unchanged).
- AT-CR-02: Set-destination screen shows the wordmark, READY pill, "Where to?", input, "Speak
  instead", and "Start navigation". Typing + Start begins navigation exactly as before.
- AT-CR-03: While navigating, the analyzed still frame fills the background, the spoken instruction
  shows in the top banner, the destination shows as "→ {goal}" with no distance, and Stop ends the
  session (camera/mic released) exactly as before.
- AT-CR-04: On arrival, the Arrived screen shows the check, destination, and "New destination", which
  returns to a cleared Set-destination screen.
- AT-CR-05: Screen-reader behavior is preserved — instruction changes are announced via the aria-live
  banner; the frame image is not announced; all buttons have labels.
- AT-CR-06: `npm run build` and `npm run lint` pass clean.

---

## Definition of Done
- All screens implemented per the mockup, logic untouched, decisions (a) still-frame and (b)
  no-distance honored.
- `npm run build` and `npm run lint` pass clean.
- `context/progress-tracker.md` updated; `visionguide-prd.html` updated if the redesign changes any
  documented UI/contrast/flow assertions (per repo process).
