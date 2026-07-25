# VisionGuide

**A mobile-first, voice-first indoor navigation assistant for blind and low-vision users.**

VisionGuide turns a standard phone into an indoor wayfinding aid using only its camera, microphone, and Claude's vision understanding. State where you want to go, point the phone forward, and follow short spoken directions - no beacons, floor plans, or building infrastructure required.

> **Safety:** VisionGuide is a supplemental aid, not a replacement for a white cane, guide dog, or other primary mobility aid. It makes probabilistic assessments from a camera feed and will sometimes be wrong. Keep using your primary mobility aid at all times.

## What it does

- **Voice destination entry** - auto-listens on launch, plus a mic button and text fallback. Claude resolves plain-language phrasing ("I need to wash my hands" becomes "the bathroom").
- **Guided scan, explore, navigate** - a gyroscope-gated 4-direction scan locates the goal or the most open path, an explore phase moves you toward hallways and signage, and a navigate phase gives turn-by-turn directions.
- **Spoken guidance** - short, grounded, forward-only instructions (never "behind"), with dead-end and closed-door handling and memory of where the goal was last seen.
- **Obstacle and hazard awareness** - Claude reports obstacle urgency tiers, and a parallel on-device CV layer fires fast hazard alerts between Claude calls.
- **Accessibility-first** - screen-reader operable, WCAG AA contrast, large tap targets, and an analyzed-frame preview so a sighted observer can see what the AI sees.

## How it works

VisionGuide runs two vision layers in parallel, entirely in the browser:

| Layer | Rate | Role |
|-------|------|------|
| Claude Vision (Anthropic API) | ~1 fps | Navigation reasoning, goal recognition, sign reading. Haiku in the navigate phase, Sonnet in scan/explore. |
| On-device CV (MediaPipe EfficientDet-Lite0) | ~15 fps | Low-latency hazard detection between Claude calls. |

Each frame is drawn to a canvas and sent to Claude; the JSON response drives spoken directions, obstacle alerts, and arrival detection. The browser calls the Anthropic API directly - there is no backend or server.

## Tech stack

- **React 19 + Vite** (JavaScript / JSX, no TypeScript)
- **Anthropic Claude API** for destination extraction and navigation reasoning, called directly from the browser
- **MediaPipe Tasks Vision** for on-device object detection
- **Web APIs**: camera (`getUserMedia`), speech recognition, speech synthesis, device motion, and wake lock
- **ESLint** for linting

Client-only: no backend, database, or authentication.

## Supported platforms

- iOS Safari 16+ / Chrome on iOS 16+ (WebKit)
- Chrome 120+ on Android 10+

Requires a device with a rear camera and microphone, served over HTTPS (the camera and speech APIs need a secure context).

## Getting started

**Prerequisites:** a recent Node.js LTS and an [Anthropic API key](https://console.anthropic.com/).

```bash
# 1. Install dependencies
npm install

# 2. Add your API key
cp .env.example .env        # then edit .env and set VITE_ANTHROPIC_API_KEY

# 3. Start the dev server
npm run dev
```

Open the printed local URL and allow camera and microphone access when prompted. To test on a phone, serve over HTTPS (or the Vite network URL through a secure tunnel) - the camera will not start otherwise.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |

## Project structure

```
src/
  App.jsx            Main app state and scan/explore/navigate flow
  components/        UI views (onboarding, destination entry, status, navigating, arrival)
  modules/           Core logic: camera, speech, loop, gyroscope, guided scan,
                     on-device CV, memory, obstacle handling
  api/claude.js      Direct Anthropic API calls and message construction
  prompts/system.js  Phase-specific Claude prompts
  constants.js       Tunable thresholds, intervals, and timeouts
  theme.js           Shared design tokens
public/models/       MediaPipe EfficientDet-Lite0 model
context/             Product spec (PRD), workflow docs, and progress tracker
```

## Documentation

- **Product spec (source of truth):** [`context/specifications/visionguide-prd.html`](context/specifications/visionguide-prd.html)
- **Project overview:** [`context/project-overview.md`](context/project-overview.md)
- **Conventions and workflow:** [`context/code-standards.md`](context/code-standards.md), [`context/ai-workflow-rules.md`](context/ai-workflow-rules.md)
- **Progress:** [`context/progress-tracker.md`](context/progress-tracker.md)

## Security note

The Anthropic API key is bundled into the client via `VITE_ANTHROPIC_API_KEY` and is therefore exposed in the deployed build. This is acceptable for a controlled demo or prototype, but a public deployment would need a backend proxy to keep the key server-side. Set a spend limit in the Anthropic console, and keep `.env` out of version control (it is gitignored).
