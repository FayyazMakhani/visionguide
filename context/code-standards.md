# Code Standards

## General

- Keep modules small and single-purpose.
- Fix root causes - do not layer workarounds.
- Do not mix unrelated concerns in one module or component.
- Name files after the responsibility they contain, not the technology.
- No magic numbers: every tunable threshold, interval, or limit lives in `src/constants.js` as a named export with a comment explaining why it has that value.

## Architecture

- VisionGuide is client-only: a React 19 + Vite single-page app. There is no backend, database, authentication, API route layer, or background task runner.
- The browser calls the Anthropic API directly through `src/api/claude.js`, using the key from `import.meta.env.VITE_ANTHROPIC_API_KEY`. Never commit `.env`.
- ES modules only (`"type": "module"`), plain JavaScript and JSX - no TypeScript.

## File Organization

- `src/modules/` - single-purpose logic units: camera, speech, navigation loop, gyroscope, guided scan, on-device CV, memory, and similar. No JSX here.
- `src/components/` - React view components: UI composition and presentation only, no business logic.
- `src/api/claude.js` - the sole browser-to-Anthropic fetch wrapper (request shape, error mapping, JSON parsing).
- `src/prompts/system.js` - all Claude prompt builders (navigation, explore, guided-scan, destination-extraction). Prompt text lives here, not inline at the call site.
- `src/constants.js` - all tunable constants (loop intervals, confidence thresholds, timeouts, CV tuning).
- `src/theme.js` - shared design tokens (colors, fonts). Consumed via each component's inline `styles` object. This is a token module, not a CSS framework.

## Claude and API Calls

- All model calls go through `callClaude` in `src/api/claude.js`. Do not fetch the Anthropic endpoint from anywhere else.
- Map failures to typed errors (`network_failure`, `rate_limited`, `api_error_<status>`) and return a safe default so the navigation loop keeps running rather than throwing mid-session.
- Cancel in-flight calls with an `AbortSignal` on Stop; treat `AbortError` as an intentional cancellation, not a failure.
- The system prompt in `src/prompts/system.js` is the source of truth for the JSON response schema. Parse defensively - Claude may wrap JSON in a code fence.

## Accessibility (non-negotiable)

- The app is voice-first and screen-reader-first. Every interactive element has an appropriate `aria-label`; status changes are announced via `aria-live`.
- Tap targets are at least 56px; text meets WCAG AA contrast (4.5:1); body text is at least 18px.
- No interaction may require the user to look at the screen during navigation.

## Prompts and Behavior

- A prompt change is a product-behavior change. When prompts change, update the API contract in `context/specifications/visionguide-prd.html` (Section 9) and log the change in `context/planning/prompt-tuning-log.md`.
- Guidance must stay grounded in the current frame: forward-only spatial language, and never guess a path the camera cannot see.
