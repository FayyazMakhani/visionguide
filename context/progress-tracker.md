# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Week 4 (Polish & Demo) of the 4-week MVP build — the code-level portion of `04-visionguide-week4-spec.md` is implemented (tuned prompt §4.8, obstacle false-positive cooldown §5.1, landmark memory §7, onboarding flow + phone-holding instruction §8, DEV_MODE debug gating §11.2).
- `05-visionguide-scan-phase-spec.md` (scan → explore → navigate phase state machine) has also been implemented in full, on top of the Week 4 code state — additive scope layered on the existing Week 1–4 build, not a Week 5 replacement.
- **On-device acceptance testing is now done**: the full backlog (Week 2 AT-01–AT-10, Week 3 AT-W3-01–AT-W3-10, Week 4 AT-W4-01–AT-W4-12, scan-phase AT-SC-01–07, explore-phase AT-EX-01–06) has been run on a physical device and passed — see Completed and resolved OQ-03/04/05. The remaining Week 4 real-world work (route rehearsal, demo video, pitch deck, device hardening, venue testing) has not been done — only blank templates were scaffolded; see Next Up.

## Current Goal

- Walk the real demo building to fill in `prompt-tuning-log.md` and `demo-route.md` with real data, begin prompt-tuning iteration against real observations, and move through the remaining Week 4 Day 1–5 punch list (rehearsal, video, deck, device hardening, deploy).

## Completed

- Scaffolded `visionguide/` with Vite + React, default boilerplate removed to match the spec's repo structure exactly.
- Config files written verbatim from setup spec §3–5: `.gitignore`, `.env.example`, `.env` (placeholder key), `vite.config.js`, `vercel.json`, `index.html`.
- `src/constants.js` — all values from setup spec §12.2 (loop interval, timeouts, goal/obstacle thresholds).
- `src/api/claude.js` — `callClaude` + `buildUserMessage`, verbatim from setup spec §8.
- `src/prompts/system.js` — `buildSystemPrompt(mode)`, verbatim from setup spec §9 (navigation/describe modes).
- `src/main.jsx` — standard entry point.
- **Week 2 spec implemented verbatim:**
  - `src/modules/loop.js` — rewritten to match §4.1 exactly: calls `resetObstacles()`/`resetGoalTracker()` on start, `isLoopRunning()` added, `onError` callback added, `silenceFired` guard prevents double "Still scanning" on timeout-then-catch.
  - `src/modules/obstacles.js` — rewritten to match §5.1 exactly: `formatObstacleAlert()` helper, "Caution — " prefix for step/stair obstacles, 8-word alert cap.
  - `src/modules/goalTracker.js` — rewritten to match §6.1 exactly (added debug logging).
  - `src/modules/speech.js` — verified against §7.1 behavior checklist (interrupt vs queue, 10s dedup, Android `cancel()` rate=10 flush workaround); already conformed, no change needed.
  - `src/App.jsx` — rewritten to match §8.1 exactly: safety prompt now gates loop start via `safetyUtterance.onend` (not spoken-and-forget), callback shape is `{onSpeak, onContextUpdate, onArrival, onError}`, voice-input state ownership moved to `GoalInput`. The `ErrorBoundary` class component from setup spec §13.4 is retained wrapping the spec's JSX — Week 2 spec doesn't mention or supersede it.
  - `src/components/GoalInput.jsx` — rewritten to match §9 exactly: owns `SpeechRecognition` wiring internally via `onStatusChange` prop (previously delegated to `App.jsx` via `onMicClick`).
  - `src/components/StartStopButton.jsx` — rewritten to match §10 exactly (adds "Start Again" label for `arrived` status).
  - `src/components/StatusDisplay.jsx` — rewritten to match §11 exactly (adds colored status dot).
  - `src/modules/camera.js` — added `visibilitychange` listener (§13) to re-acquire WakeLock after the tab is backgrounded and returns to visible; rest of file (from setup spec) unchanged, including `isFrameFrozen` which Week 2 doesn't reference.
- Verified `npm run build` and `npm run lint` both pass clean after all Week 2 changes.
- **Week 3 spec implemented verbatim:**
  - `src/modules/loop.js` — rewritten to match §14 exactly: `startLoop` now takes `streamRef` as its second param; frozen-frame check runs each cycle before the API call and triggers `reinitCamera`/`stopLoop` on failure; silence fallback and the catch-block fallback now share a module-level `lastSilenceFiredAt` throttle (`SILENCE_HOLDOFF_MS`, reset in `stopLoop`); `rate_limited` errors trigger a 5s back-off instead of "Still scanning".
  - `src/api/claude.js` — `callClaude` rewritten to match §8.2 exactly: `fetch` wrapped in try/catch (`network_failure`), `429` mapped to `rate_limited`, other non-200 mapped to `api_error_<status>`, all with `console.warn` per error path. Added `{ cause }` to the network-failure `Error` to satisfy the repo's `preserve-caught-error` eslint rule (not in the spec snippet, but required for `npm run lint` to pass clean — behavior/message are unchanged).
  - `src/modules/camera.js` — rewritten to match §15 exactly: `isFrameFrozen` replaced with `checkFrozenFrame`/`resetFrozenFrameDetector` (3-consecutive-identical-frame threshold) and a new `reinitCamera`; the `visibilitychange` WakeLock-reacquire listener moved from module-load-time into `initCamera`/`stopCamera` (registered/removed per session instead of once globally).
  - `src/modules/speech.js` — added `resetSpeech()` per §16 (cancels speech and clears dedup state); no other change, dedup logic already conformed.
  - `src/App.jsx` — `startLoop` call updated to pass `streamRef`; `handleStop` now calls `resetSpeech()` instead of `cancel()` per §16; unmount cleanup `useEffect` now also calls `cancel()` and nulls `streamRef.current` per §13.2.
  - `src/components/CameraPreview.jsx` — added `aria-hidden="true"` to the `<video>` element per §11.5 checklist (was missing).
  - `src/components/GoalInput.jsx` — hint text color changed from `#777777` to `#999999` per §12.3 (borderline 4.5:1 contrast fix).
  - Verified already-conforming, no change needed: context window (App.jsx state + `buildUserMessage` format, §4), dedup logic (`speech.js`, §5), `STALE_FRAME_MS = 4500` (`constants.js`, §7), `SILENCE_HOLDOFF_MS` constant already present, all other §12.2 contrast pairs, all other §11.5 ARIA checklist items, `StartStopButton.jsx`/`StatusDisplay.jsx` (no spec changes for these).
  - Intentionally omitted: the temporary `console.debug`/`console.log` verification snippets in §4.4, §6.3, §7.3 (already present pre-Week3), §8.4 — these are described in the spec as manual on-device debugging aids to be added and then removed, not permanent deliverables.
- Verified `npm run build` and `npm run lint` both pass clean after all Week 3 changes.
- **Week 4 spec — code-level portion implemented:**
  - `src/prompts/system.js` — `buildSystemPrompt()` replaced verbatim with the fully tuned prompt from §4.8 (landmark/specificity rule, full-width obstacle scan, camera-holder-perspective rule, high-urgency-only-if-stationary-and-blocking rule, signage-based goal detection rule). This is the prompt as written in the spec, not yet validated against a real building — see Open Questions.
  - `src/modules/obstacles.js` — added §5.1's direction filter: `lastHighAlert`/`HIGH_ALERT_COOLDOWN_MS` (4000ms) suppresses a repeat high-urgency alert for the same type+direction within the cooldown window; `resetObstacles()` now clears it.
  - `src/modules/landmarks.js` — new module, verbatim from §7.2 (`extractLandmarks`/`getLandmarkContext`/`resetLandmarks`, keyword list, max 5 landmarks).
  - `src/api/claude.js` — `buildUserMessage()` now appends `getLandmarkContext()` to the prompt text per §7.3.
  - `src/modules/loop.js` — calls `resetLandmarks()` on `startLoop()` and `extractLandmarks(result.navigation_direction)` after each spoken direction, per §7.4.
  - `src/components/Onboarding.jsx` — new component, verbatim from §8.3.
  - `src/App.jsx` — `showOnboarding` state gated on `sessionStorage.vg_visited` (§8.2/§8.4), rendered before the main container; `handleStart`'s `safetyUtterance.onend` now speaks the phone-holding instruction and delays `startLoop` by 2500ms per §8.5.
  - `src/constants.js` — added `DEV_MODE = false` (§11.2) and a comment on `GOAL_CONFIDENCE_THRESHOLD` noting it can be lowered to 0.7 if testing shows the demo destination is missed (no value change — no real testing has happened yet to justify one).
  - Gated the pre-existing `console.debug` calls in `goalTracker.js` and `loop.js` behind `DEV_MODE` per §11.2 (no `console.debug` calls existed in `camera.js`).
  - Verified `npm run build` and `npm run lint` both pass clean after all Week 4 code changes.
- **Week 4 spec — non-code scaffolding (templates only, no fabricated data):** created `prompt-tuning-log.md` (§4.1 format), `demo-route.md` (§9.1–§9.4 requirements/rehearsal-log structure), `demo-day-runbook.md` (§14, mostly literal/generic so largely complete, with venue-specific fields bracketed), `pitch-deck-outline.md` (§13.1 slide structure, team slide blank) — all at the `visionguide/` repo root, all with `[fill in]` placeholders. None of these contain real session data, route details, or team info.
- **`05-visionguide-scan-phase-spec.md` implemented verbatim**, scoped exactly to the 5 files the spec lists:
  - `src/constants.js` — added `SCAN_INTERVAL_MS`, `SCAN_YAW_THRESHOLD_DEG_S`, `SCAN_YAW_DEBOUNCE_MS`, `SCAN_TIMEOUT_MS`, `SCAN_MIN_CONFIDENCE`, `EXPLORE_INTERVAL_MS`, `EXPLORE_TIMEOUT_MS`, verbatim from the spec.
  - `src/modules/gyroscope.js` — new module, verbatim API (`initGyroscope`, `isRotatingTooFast`, `shouldWarnRotationSpeed`). Listens to `DeviceMotionEvent.rotationRate.alpha`; returns `false` from `isRotatingTooFast()` when `DeviceMotionEvent` is unavailable so scan phase is never blocked on unsupported devices.
  - `src/prompts/system.js` — added `buildScanPrompt(goal)` and `buildExplorePrompt(goal)` alongside the existing `buildSystemPrompt(mode)`; both verbatim from the spec, used as the `system` prompt for `callClaude` during scan/explore phases respectively.
  - `src/modules/loop.js` — added the `scan → explore → navigate` phase state machine: module-level `phase`/`scanTimerId`/`exploreTimerId`, scan-phase gyroscope gating before frame capture, phase-based system-prompt selection, scan/explore response handling (goal-confidence transition check, obstacle routing, explore-direction guidance), `onScanTimeout`/`onExploreTimeout` handlers that swap the interval and prompt, and `stopLoop()` resetting `phase` back to `'scan'`. The pre-existing navigate-phase tick body (staleness guard, landmarks, arrival) is untouched, just gated behind `phase === 'navigate'`.
  - `src/modules/speech.js` — no structural change needed (per spec); new spoken strings live inline in `loop.js` as literals, matching how existing strings like `'Still scanning'` are handled in this codebase (there's no central string-constants module).
  - `src/App.jsx` — intentionally left unchanged. The spec's Scope section doesn't list it; the pre-existing 2500ms `setTimeout` before `startLoop` (Week 4 §8.5, waiting for the chest-height instruction to finish) still works correctly with the new scan phase — `startLoop`'s scan instruction enqueues via `speak()` onto the same `SpeechQueue` regardless of when `startLoop` is called, satisfying "must enqueue after safety prompt" either way.
  - Verified `npm run build` and `npm run lint` both pass clean after all changes.
- **On-device acceptance testing — full backlog run and passed**, on a physical device, Chrome on both Android and iOS:
  - Week 2 AT-01–AT-10, Week 3 AT-W3-01–AT-W3-10, Week 4 AT-W4-01–AT-W4-12 all passed.
  - Scan-phase spec's own AT-SC-01–07 and AT-EX-01–06 all passed.
  - Resolves OQ-03 (demo device), OQ-04, OQ-05 (Week 2/3 on-device sign-off that Week 3/4 code was implemented ahead of) — see Open Questions.
  - Caveat not yet resolved: "Chrome on iOS" runs on Apple's WebKit engine (Apple requires all iOS browsers to use it), not Chrome's actual Blink engine — so this isn't independent confirmation of the PRD's Android-Chrome-specific APIs (`webkitSpeechRecognition`, `getUserMedia` constraints) working the same way the PRD assumes. The PRD (NFR-08, §7 Out of Scope) explicitly scopes iOS/Safari out for this reason. Flagged as a new open question rather than silently broadening NFR-08 — see OQ-08.

## In Progress

- None — all Week 1–4 + scan-phase code changes are implemented and on-device acceptance testing is complete. Remaining work is the real-world Week 4 polish/demo-prep punch list below, not yet started.

## Next Up

- Day 1 (spec §2): first real-building test session, log failures to `prompt-tuning-log.md`, identify top 3 prompt failures, begin tuning iteration 1 against real observations (the current §4.8 prompt in `system.js` is the spec's starting point, not yet iterated against real-building data).
- Day 2–3: further tuning iterations, fill in `demo-route.md` with the real route and run the 3x rehearsal protocol (§9.3), record the demo video (§12).
- Day 4: demo device hardening (§10 checklist), `vercel --prod` deploy, fill in `pitch-deck-outline.md` into an actual deck.
- Day 5: fill in and print `demo-day-runbook.md`.
- Before final deploy: complete the §11.1 pre-deploy checklist (bump `package.json` version to 1.0.0, confirm no temporary test code remains) — not done yet since it asserts a readiness state not yet reached.
- Set the $5.00/day hard spend limit in the Anthropic console (NFR-07) before any further device testing, if not already done.
- Resolve OQ-08 (Chrome-on-iOS WebKit caveat) — decide whether to broaden NFR-08/§7 Out of Scope to officially cover iOS, or treat the iOS pass as anecdotal and keep Android Chrome as the only committed target.

## Open Questions

- OQ-08: On-device testing passed on "Chrome on iOS" as well as Chrome on Android. iOS Chrome runs on Apple's WebKit engine, not Blink — Apple requires this for all iOS browsers — so a pass there doesn't confirm the PRD's Android-Chrome-specific assumptions (`webkitSpeechRecognition` behavior, `getUserMedia` constraints) the way an Android Chrome pass does. PRD NFR-08 and §7 Out of Scope explicitly exclude iOS/Safari for this exact reason ("Web Speech API and camera constraints on iOS Safari are unreliable"). Not resolved here — needs a decision on whether to update NFR-08/§7 to officially support iOS now that it's been observed working, or treat it as informal/anecdotal and keep the PRD's Android-only commitment as-is.
- OQ-07 (resolved): `App.jsx`'s safety prompt only speaks once per calendar day (`localStorage.vg_safety_date` gate, predates the scan-phase spec), which previously contradicted PRD FR-UI-03 and the scan-phase spec's AT-SC-01/AT-SC-05. Decision: the once-per-day behavior is correct as implemented; PRD FR-UI-03/AC-SCAN-01 and `05-visionguide-scan-phase-spec.md` AT-SC-01/AT-SC-05/Definition-of-Done have been updated to document once-per-day instead. No code change needed — `App.jsx`'s existing behavior was already right.
- OQ-03 (resolved): demo device confirmed — physical device testing completed on Chrome on Android (and iOS, see OQ-08) — full acceptance backlog passed.
- OQ-04 (resolved): Week 3's dependency on Week 2's on-device sign-off was satisfied retroactively — both Week 2 (AT-01–AT-10) and Week 3 (AT-W3-01–AT-W3-10) on-device suites have now passed.
- OQ-05 (resolved): Week 4's dependency on Week 3's on-device sign-off was likewise satisfied retroactively — Week 4 (AT-W4-01–AT-W4-12) on-device suite has now passed, alongside Week 2/3.
- OQ-06: Week 4 spec §1 states "Do not add new features this week. The only code changes allowed are prompt tuning, bug fixes discovered during demo rehearsal, and the onboarding flow. Everything else is out of scope." Landmark memory (§7) is a new feature (new module, new state, new prompt content) — not a bug fix, not onboarding, not prompt tuning. This directly contradicts §1. Implemented per explicit user instruction to proceed anyway; flagging here in case it should be reverted or deferred to a later week during review. Now confirmed working on-device as part of the Week 4 acceptance pass, but the scope question itself is still unresolved.

## Architecture Decisions

- High-urgency obstacles fire on the first frame (no 2-frame confirmation) — confirmed correct per PRD R-04/loop latency math; only goal arrival uses 2-frame confirmation.
- `max_tokens` set to 500, not 300, per PRD R-01 — avoids truncated JSON on multi-obstacle frames.
- No CSS files/design system introduced beyond inline styles needed to satisfy explicit component contract requirements (56px tap targets, 24px/18px font sizes) — spec is silent on visual design beyond accessibility numbers, so nothing speculative was added.
- `stateRef` (goal/context) synced via `useEffect` rather than during render, to satisfy the `react-hooks/refs` lint rule while preserving the "loop always reads fresh state" behavior the spec calls for.
- The WakeLock `visibilitychange` re-acquire listener (Week 2 spec §13) is attached once at module load in `camera.js`, exactly as the spec's snippet shows. Side effect: it will also attempt to silently re-acquire a WakeLock on any tab-visibility change even outside an active navigation session (guarded by `wakeLock === null`, fails silently if no permission context). Not a problem for MVP single-session use; flagged here in case it surprises someone reading the module in isolation.

## Session Notes

- Repo lives at `/workspace/visionguide`, separate from `/workspace/specifications` (PRD + setup spec) and `/workspace/context` (this tracker).
- `.env` is gitignored and now holds a real `VITE_ANTHROPIC_API_KEY` — verified working via a direct `curl` call to `https://api.anthropic.com/v1/messages` (HTTP 200, valid completion from `claude-sonnet-4-6`). `npm run dev` should now produce live navigation output.
- `eslint.config.js`, `README.md`, `package-lock.json` are leftover Vite scaffold artifacts, not specified by the setup spec but left in place as harmless tooling.
