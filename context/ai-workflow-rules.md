# Development Workflow

## Approach

Build VisionGuide incrementally using a spec-driven workflow. The context files define what to build, how to build it, and the current state of progress. Always implement against these specs - do not infer or invent behavior from scratch.

The authoritative product and architecture definition is `context/specifications/visionguide-prd.html`. Per-feature specs live under `context/specifications/`, and `context/progress-tracker.md` is the live record of what is actually built.

## Scoping Rules

- Work on one feature unit or subsystem at a time (for example: one navigation phase, the CV layer, or the speech queue).
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated subsystems in a single implementation step.

## When To Split Work

Split an implementation step if it combines:

- Component/UI changes and navigation-loop or module logic changes
- A prompt or behavior change and a control-flow change in the same step
- Multiple unrelated modules (for example the speech queue and the gyroscope) with no shared reason
- Behavior that is not clearly defined in the context files

If a change cannot be verified end to end quickly - in the running app or a test - the scope is too broad. Split it.

## Handling Missing Requirements

- Do not invent product behavior that is not defined in the context files or the PRD.
- If a requirement is ambiguous, resolve it in the PRD (or the relevant spec under `context/specifications/`) before implementing.
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing.

## Foundation Conventions

Keep the foundation stable and reusable. Unless a task explicitly requires otherwise:

- Do not introduce a CSS framework or component library. Styling stays in per-component inline `styles` objects that read tokens from `src/theme.js`.
- Do not add a backend, database, or server layer. The app is, and stays, client-only (see `code-standards.md`).
- Treat `public/models/*.tflite` and the vendored MediaPipe assets as fixed inputs; do not modify them.

## Keeping Docs In Sync

Update the relevant context file whenever implementation changes:

- System architecture or module boundaries -> PRD (Sections 8-11)
- Claude prompts, API contract, or response schema -> PRD Section 9 and `context/planning/prompt-tuning-log.md`
- Tunable thresholds or timings -> `src/constants.js` (and the PRD if it is a documented number)
- Code conventions or standards -> `code-standards.md`
- Feature scope -> PRD (Sections 5-7)

Progress state must reflect the actual state of the implementation, not the intended state.

## Before Moving To The Next Unit

1. The current unit works end to end within its defined scope (verified in the app or a test).
2. `progress-tracker.md` reflects the completed work.
