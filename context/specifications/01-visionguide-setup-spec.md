# VisionGuide — Architecture & Project Setup Spec

**Version:** 1.0  
**Stack:** Vite + React, Chrome on Android, Anthropic Claude Vision API  
**Deployment:** Vercel (static site, no serverless functions)

---

## Table of Contents

1. [Repo Structure](#1-repo-structure)
2. [Prerequisites](#2-prerequisites)
3. [Initial Setup](#3-initial-setup)
4. [Environment Config](#4-environment-config)
5. [Vite + React Config](#5-vite--react-config)
6. [State Architecture](#6-state-architecture)
7. [Component Contracts](#7-component-contracts)
8. [Claude API Integration](#8-claude-api-integration)
9. [Prompt Spec](#9-prompt-spec)
10. [Speech Module Spec](#10-speech-module-spec)
11. [Camera Module Spec](#11-camera-module-spec)
12. [Navigation Loop Spec](#12-navigation-loop-spec)
13. [Error Handling Spec](#13-error-handling-spec)
14. [Deployment](#14-deployment)
15. [Day 1 Checklist](#15-day-1-checklist)

---

## 1. Repo Structure

```
visionguide/
├── .env                        # API key — never commit
├── .env.example                # Committed template
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── src/
│   ├── main.jsx                # React entry point
│   ├── App.jsx                 # Root component, global state
│   ├── constants.js            # All magic numbers and config values
│   ├── api/
│   │   └── claude.js           # Anthropic fetch wrapper
│   ├── modules/
│   │   ├── camera.js           # getUserMedia, canvas, WakeLock
│   │   ├── speech.js           # SpeechQueue, TTS_CONFIG
│   │   ├── recognition.js      # Web Speech Recognition wrapper
│   │   ├── loop.js             # NavigationLoop (setInterval logic)
│   │   ├── obstacles.js        # ObstacleRouter
│   │   └── goalTracker.js      # GoalTracker
│   ├── prompts/
│   │   └── system.js           # buildSystemPrompt(mode)
│   └── components/
│       ├── GoalInput.jsx       # Text field + mic button
│       ├── StatusDisplay.jsx   # Status indicator + last-spoken text
│       ├── StartStopButton.jsx # Single large button
│       └── CameraPreview.jsx   # Hidden video element
├── public/
│   └── favicon.ico
```

---

## 2. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | `nvm install 20` |
| npm | 10+ | Bundled with Node 20 |
| Vercel CLI | Latest | `npm i -g vercel` |
| Git | Any | System package manager |

Browser target: **Chrome 120+ on Android 10+**. All development and testing must use Chrome. Do not test on Safari or Firefox — Web Speech API behavior differs.

---

## 3. Initial Setup

### 3.1 Scaffold project

```bash
npm create vite@latest visionguide -- --template react
cd visionguide
npm install
```

### 3.2 Install dependencies

No external UI or state management libraries. Keep the dependency tree minimal.

```bash
# No additional runtime dependencies required
# The entire stack is: React + Vite + native browser APIs + Anthropic REST API
```

### 3.3 .gitignore

```
node_modules/
dist/
.env
.env.local
.DS_Store
```

### 3.4 .env.example

```
VITE_ANTHROPIC_API_KEY=your_key_here
```

Commit `.env.example`. Never commit `.env`.

---

## 4. Environment Config

### 4.1 .env

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Vite exposes any variable prefixed with `VITE_` to client-side code via `import.meta.env`.

### 4.2 Accessing the key in code

```js
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

if (!API_KEY) {
  throw new Error('VITE_ANTHROPIC_API_KEY is not set. Add it to .env');
}
```

Add this check to `src/api/claude.js` on module load. It will surface immediately during dev if the key is missing.

---

## 5. Vite + React Config

### 5.1 vite.config.js

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    https: false,  // HTTP is fine for localhost
    port: 5173,
  },
});
```

> **Note:** Chrome allows `getUserMedia` on `localhost` over HTTP. HTTPS is only required on non-localhost origins — Vercel handles this in production automatically.

### 5.2 vercel.json

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

No functions, no rewrites. Pure static deploy.

### 5.3 package.json scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### 5.4 index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0f0f0f" />
  <title>VisionGuide</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

---

## 6. State Architecture

All global state lives in `App.jsx` via `useState`. No state management library. Pass state and setters as props to child components.

### 6.1 State shape

```js
// App.jsx
const [goal, setGoal] = useState('');               // User's navigation destination
const [status, setStatus] = useState('idle');        // 'idle' | 'listening' | 'navigating' | 'arrived'
const [lastSpoken, setLastSpoken] = useState('');    // Last TTS string, shown on screen
const [context, setContext] = useState([]);          // Last 2 navigation_direction strings
```

### 6.2 Status transitions

```
idle ──► listening (mic button tapped)
      ──► navigating (Start tapped with goal set)

listening ──► idle (recognition result received or error)

navigating ──► arrived (GoalTracker fires)
           ──► idle (Stop tapped)

arrived ──► idle (user taps Start again / page reload)
```

### 6.3 Context window management

`context` holds the last 2 `navigation_direction` strings returned by Claude. Updated in the NavigationLoop after each successful API response. Passed to `buildUserMessage()` on every call.

```js
// After successful API response in loop.js
setContext(prev => [...prev.slice(-1), result.navigation_direction]);
```

---

## 7. Component Contracts

### 7.1 App.jsx

Root component. Owns all state. Renders the four child components. Initializes `CameraModule` and `NavigationLoop` via `useRef` so they persist across renders.

```jsx
// Refs for imperative modules
const cameraRef = useRef(null);   // CameraModule instance
const loopRef = useRef(null);     // NavigationLoop instance
```

**No business logic in App.jsx.** It wires state to modules and components only.

---

### 7.2 GoalInput.jsx

**Props:**
```ts
{
  goal: string,
  onGoalChange: (goal: string) => void,
  disabled: boolean,          // true during navigation
  onMicClick: () => void,     // triggers recognition.js
  isListening: boolean,       // shows listening indicator
}
```

**Behaviour:**
- Text input with `aria-label="Navigation destination"`
- Focused on mount via `autoFocus`
- Mic button with `aria-label="Speak your destination"`
- Mic button hidden (not disabled) if `SpeechRecognition` is unavailable
- Input and mic button disabled when `disabled=true` (during navigation)

---

### 7.3 StartStopButton.jsx

**Props:**
```ts
{
  status: 'idle' | 'listening' | 'navigating' | 'arrived',
  onStart: () => void,
  onStop: () => void,
  disabled: boolean,    // true if goal is empty string
}
```

**Behaviour:**
- When `status === 'idle'` or `status === 'arrived'`: renders "Start Navigation", calls `onStart`
- When `status === 'navigating'`: renders "Stop", calls `onStop`
- When `status === 'listening'`: renders "Listening...", disabled
- Minimum height 56px, minimum font size 24px
- `aria-label` updates to match current label text

---

### 7.4 StatusDisplay.jsx

**Props:**
```ts
{
  status: string,
  lastSpoken: string,
}
```

**Behaviour:**
- Status line: plain text showing current status
- Last spoken line: shows `lastSpoken` string
- Both wrapped in `aria-live="assertive"` region so TalkBack announces changes
- No interaction, display only

---

### 7.5 CameraPreview.jsx

**Props:**
```ts
{
  videoRef: React.RefObject<HTMLVideoElement>,
}
```

**Behaviour:**
- Renders a `<video>` element with `ref={videoRef}`, `autoPlay`, `playsInline`, `muted`
- Visually hidden (`position: absolute; opacity: 0; pointer-events: none`) — it must exist in DOM to keep the stream alive, but the user does not see it
- The `videoRef` is passed in from App.jsx and also used by `CameraModule.getFrame()`

---

## 8. Claude API Integration

### 8.1 src/api/claude.js

Single exported async function. All Anthropic calls go through here.

```js
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

if (!API_KEY) {
  throw new Error('VITE_ANTHROPIC_API_KEY is not set.');
}

/**
 * @param {string} systemPrompt
 * @param {Array} messages       - Anthropic messages array
 * @returns {Promise<object>}    - Parsed JSON from Claude
 * @throws {Error}               - On network failure or non-200 response
 */
export async function callClaude(systemPrompt, messages) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,  // 300 risks truncating multi-obstacle JSON mid-stream; 500 provides headroom
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  try {
    return JSON.parse(text);
  } catch {
    // Truncated or malformed JSON — log for debugging, return safe default so loop continues
    console.warn('JSON parse failed. Raw response:', text);
    return {
      obstacles: [],
      navigation_direction: '',
      goal_found: false,
      goal_confidence: 0,
    };
  }
}
```

### 8.2 Building the user message

```js
// src/api/claude.js (exported helper)

/**
 * @param {string} goal          - User's destination string
 * @param {string[]} context     - Last 2 navigation_direction strings
 * @param {string} base64Frame   - JPEG base64 string (no data: prefix)
 * @returns {object}             - Anthropic user message object
 */
export function buildUserMessage(goal, context, base64Frame) {
  const contextText = context.length > 0
    ? `Prior directions: ${context.join(' → ')}`
    : 'No prior context.';

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Goal: ${goal}\n${contextText}\nAnalyze this frame.`,
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Frame,
        },
      },
    ],
  };
}
```

---

## 9. Prompt Spec

### 9.1 src/prompts/system.js

```js
/**
 * @param {'navigation' | 'describe'} mode
 * @returns {string}
 */
export function buildSystemPrompt(mode = 'navigation') {
  const baseSchema = `{
  "obstacles": [
    {
      "type": string,       // e.g. "chair", "step", "door", "person"
      "direction": string,  // "left" | "center" | "right"
      "urgency": "high" | "medium" | "low"
    }
  ],
  "navigation_direction": string,
  "goal_found": boolean,
  "goal_confidence": number
}`;

  const describeField = mode === 'describe'
    ? `  "scene_description": string,  // one sentence, max 20 words — inserted before navigation_direction\n`
    : '';

  const schema = baseSchema.replace(
    '"navigation_direction"',
    `${describeField}  "navigation_direction"`
  );

  return `You are an indoor navigation assistant for visually impaired users.
Analyze the image and return ONLY valid JSON. No preamble, no markdown, no explanation.

JSON structure:
${schema}

Rules:
- navigation_direction: max 15 words, action-oriented. Examples: "Move forward through the open door", "Turn left past the desk".
- Use spatial words only: left, right, ahead, behind. Never compass directions.
- obstacle urgency=high: object is within ~1 metre and directly on the user's path.
- obstacle urgency=medium: object is nearby but not immediately blocking.
- obstacle urgency=low: object is far away or to the side. Do not report these unless notable.
- goal_found=true only when the goal is clearly visible and reachable in this frame.
- goal_confidence: 0.0 (not visible) to 1.0 (directly in front, clearly identifiable).
- If nothing is blocking and the path is clear, say so: "Path is clear, continue ahead."
- Return valid JSON only. No other text.`;
}
```

### 9.2 Mode usage

MVP always calls `buildSystemPrompt('navigation')`. The `'describe'` mode is wired but not exposed in the UI. See S16 in the PRD for the full deferred architecture.

---

## 10. Speech Module Spec

### 10.1 src/modules/speech.js

```js
// TTS_CONFIG — all utterance parameters defined here.
// To add configurable TTS, write to this object. No other code changes needed.
export const TTS_CONFIG = {
  rate: 1.05,
  pitch: 1.0,
  volume: 1.0,
  voiceLang: 'en-US',
  preferLocalVoice: true,
};

let selectedVoice = null;

function selectVoice() {
  if (selectedVoice) return selectedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (TTS_CONFIG.preferLocalVoice) {
    selectedVoice = voices.find(v => v.lang === TTS_CONFIG.voiceLang && v.localService)
      || voices.find(v => v.lang === TTS_CONFIG.voiceLang)
      || voices[0];
  } else {
    selectedVoice = voices.find(v => v.lang === TTS_CONFIG.voiceLang) || voices[0];
  }
  return selectedVoice;
}

// Voices load async on some browsers — re-select on voiceschanged
window.speechSynthesis.onvoiceschanged = () => { selectedVoice = null; };

function createUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate   = TTS_CONFIG.rate;
  u.pitch  = TTS_CONFIG.pitch;
  u.volume = TTS_CONFIG.volume;
  u.voice  = selectVoice();
  return u;
}

// Deduplication state
let lastSpokenText = '';
let lastSpokenAt = 0;
const DEDUP_WINDOW_MS = 10_000;

/**
 * Speak text via TTS.
 * @param {string} text
 * @param {boolean} interrupt - If true, cancel current speech first
 */
export function speak(text, interrupt = false) {
  if (!text || !text.trim()) return;

  // Deduplication: don't repeat the same direction within 10 seconds
  const now = Date.now();
  if (
    !interrupt &&
    text === lastSpokenText &&
    now - lastSpokenAt < DEDUP_WINDOW_MS
  ) return;

  if (interrupt) {
    cancel();
  }

  const utterance = createUtterance(text);
  window.speechSynthesis.speak(utterance);

  lastSpokenText = text;
  lastSpokenAt = now;
}

/**
 * Cancel current speech.
 * Includes workaround for documented Android speechSynthesis.cancel() bug
 * where cancel() completes silently but speech continues playing.
 * Fix: queue a zero-volume utterance at rate=10 to flush the speech queue.
 */
export function cancel() {
  window.speechSynthesis.cancel();
  // Android workaround: if speech is still active after cancel(), force-flush with a silent fast utterance
  if (window.speechSynthesis.speaking) {
    const flush = new SpeechSynthesisUtterance(' ');
    flush.volume = 0;
    flush.rate = 10;
    window.speechSynthesis.speak(flush);
  }
}
```

---

## 11. Camera Module Spec

### 11.1 src/modules/camera.js

```js
const FRAME_WIDTH  = 640;
const FRAME_HEIGHT = 480;
const JPEG_QUALITY = 0.7;

let wakeLock = null;
const canvas = document.createElement('canvas');
canvas.width  = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;
const ctx = canvas.getContext('2d');

/**
 * Initialize camera stream and attach to video element.
 * Requests WakeLock. Speaks error if camera denied.
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<MediaStream>}
 * @throws {Error} if camera permission denied
 */
export async function initCamera(videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: FRAME_WIDTH },
        height: { ideal: FRAME_HEIGHT },
      },
    });
  } catch (err) {
    speak('Camera access is required. Please allow camera in browser settings.');
    throw err;
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  // Request WakeLock
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    speak('Please keep the screen on manually during navigation.');
  }

  return stream;
}

/**
 * Stop camera stream and release WakeLock.
 * @param {MediaStream} stream
 */
export async function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

/**
 * Capture current video frame as base64 JPEG.
 * Returns null if video is not ready.
 * @param {HTMLVideoElement} videoEl
 * @returns {string | null} base64 JPEG without data: prefix
 */
export function getFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  ctx.drawImage(videoEl, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1];  // Strip 'data:image/jpeg;base64,' prefix
}

/**
 * Detect frozen frame by comparing base64 strings.
 * Call every few seconds in the loop if needed.
 */
let lastFrameHash = null;
export function isFrameFrozen(frame) {
  if (frame === lastFrameHash) return true;
  lastFrameHash = frame;
  return false;
}
```

---

## 12. Navigation Loop Spec

### 12.1 src/modules/loop.js

The NavigationLoop owns the `setInterval`. It is started and stopped imperatively from `App.jsx` via `startLoop()` / `stopLoop()`.

```js
import { getFrame } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles } from './obstacles.js';
import { trackGoal } from './goalTracker.js';
import { LOOP_INTERVAL_MS, API_TIMEOUT_MS, STALE_FRAME_MS } from '../constants.js';

let intervalId = null;
let pending = false;

/**
 * @param {HTMLVideoElement} videoEl
 * @param {object} stateRef - { goal, context }  — use a ref so loop always reads fresh state
 * @param {object} callbacks - { onSpeak, onContextUpdate, onArrival, onStatusChange }
 */
export function startLoop(videoEl, stateRef, callbacks) {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    if (pending) return;

    const frame = getFrame(videoEl);
    if (!frame) return;

    const capturedAt = Date.now();
    pending = true;

    // Silence fallback timer
    const silenceTimer = setTimeout(() => {
      speak('Still scanning');
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;
      const result = await callClaude(
        buildSystemPrompt('navigation'),
        [buildUserMessage(goal, context, frame)]
      );

      clearTimeout(silenceTimer);

      // Drop stale responses
      if (Date.now() - capturedAt > STALE_FRAME_MS) return;

      // Route obstacles (may interrupt speech)
      routeObstacles(result.obstacles ?? []);

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction);
        callbacks.onSpeak(result.navigation_direction);
        callbacks.onContextUpdate(result.navigation_direction);
      }

      // Check goal
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        speak(`You have arrived at ${goal}`);
        callbacks.onArrival();
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);
      speak('Still scanning');
      console.error('Navigation loop error:', err);
    } finally {
      pending = false;
    }
  }, LOOP_INTERVAL_MS);
}

export function stopLoop() {
  clearInterval(intervalId);
  intervalId = null;
  pending = false;
}
```

### 12.2 src/constants.js

```js
export const LOOP_INTERVAL_MS  = 1000;   // 1 fps
export const API_TIMEOUT_MS    = 3000;   // Speak "Still scanning" after 3s of no response
export const STALE_FRAME_MS    = 4500;   // Drop API response if frame is older than 4.5s (p95 latency + 500ms buffer)
export const GOAL_CONFIDENCE_THRESHOLD = 0.8;
export const GOAL_CONFIRM_FRAMES = 2;    // Consecutive frames required to confirm arrival
// OBSTACLE_CONFIRM_FRAMES intentionally removed — high urgency fires on first frame.
// At 1fps + 3s latency, a 2-frame confirmation window consumes the entire available safety margin.
export const DEDUP_WINDOW_MS   = 10_000; // Don't repeat same direction within 10s
export const SILENCE_HOLDOFF_MS = 10_000; // Max one "Still scanning" per 10s
```

---

## 13. Error Handling Spec

### 13.1 ObstacleRouter — src/modules/obstacles.js

```js
import { speak } from './speech.js';

/**
 * Route obstacles from API response to speech output.
 * High urgency fires immediately on first frame — no confirmation delay.
 * At 1fps + 3s latency, a 2-frame window consumes the entire safety margin.
 * @param {Array<{type: string, direction: string, urgency: string}>} obstacles
 */
export function routeObstacles(obstacles) {
  const highUrgency = obstacles.find(o => o.urgency === 'high');

  if (highUrgency) {
    speak(`${highUrgency.type} on your ${highUrgency.direction}`, true); // interrupt=true, fires immediately
    return;
  }

  const medium = obstacles.find(o => o.urgency === 'medium');
  if (medium) {
    speak(`${medium.type} on your ${medium.direction}`); // queued, no interrupt
  }
  // low urgency: discard
}

export function resetObstacles() {
  // No state to reset — confirmation counter removed
}
```

### 13.2 GoalTracker — src/modules/goalTracker.js

```js
import { GOAL_CONFIDENCE_THRESHOLD, GOAL_CONFIRM_FRAMES } from '../constants.js';

let consecutiveFoundCount = 0;

/**
 * @param {boolean} goalFound
 * @param {number} goalConfidence
 * @returns {boolean} true when arrival is confirmed
 */
export function trackGoal(goalFound, goalConfidence) {
  if (goalFound && goalConfidence >= GOAL_CONFIDENCE_THRESHOLD) {
    consecutiveFoundCount++;
    return consecutiveFoundCount >= GOAL_CONFIRM_FRAMES;
  }
  consecutiveFoundCount = 0;
  return false;
}

export function resetGoalTracker() {
  consecutiveFoundCount = 0;
}
```

### 13.3 SpeechRecognition wrapper — src/modules/recognition.js

```js
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const isRecognitionAvailable = () => SpeechRecognition !== null;

/**
 * @param {function} onResult  - Called with recognized string
 * @param {function} onError   - Called with error message string
 * @returns {function} stop() function
 */
export function startRecognition(onResult, onError) {
  if (!SpeechRecognition) {
    onError('Speech recognition not available');
    return () => {};
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const result = event.results[0][0].transcript.trim();
    onResult(result);
  };

  recognition.onerror = (event) => {
    onError(event.error);
  };

  recognition.onend = () => {
    // Recognition ended without result — caller handles state
  };

  recognition.start();
  return () => recognition.abort();
}
```

### 13.4 Global error boundaries

`App.jsx` wraps the main render in an `ErrorBoundary` component (standard React class component). On error, it speaks "Something went wrong. Please reload." and shows a reload button.

---

## 14. Deployment

### 14.1 Vercel setup

```bash
# First deploy
vercel

# Set API key in Vercel environment (optional — only needed if you use env vars in build)
# For this MVP the key is in .env locally and not needed in Vercel
# since it ships in the built JS bundle
vercel env add VITE_ANTHROPIC_API_KEY

# Subsequent deploys
vercel --prod
```

### 14.2 Important: key in bundle

Because Vite inlines `import.meta.env.VITE_*` at build time, the API key will be present in the compiled JS bundle. This is acceptable for a demo on a controlled device. Do not share the Vercel URL publicly.

If you need to share the URL with judges, create a fresh API key with a low spend limit ($5) for demo day and revoke it afterward.

### 14.3 Local development

```bash
npm run dev
# Open http://localhost:5173 in Chrome
# Chrome on desktop will use the webcam for testing
# For Android testing: connect phone via USB, enable USB debugging, use chrome://inspect
```

---

## 15. Day 1 Checklist

Work through this in order. Do not move to the next item until the current one is verified.

- [ ] `npm create vite@latest visionguide -- --template react` runs without error
- [ ] `npm run dev` starts dev server at `http://localhost:5173`
- [ ] `.env` created with `VITE_ANTHROPIC_API_KEY=sk-ant-...`
- [ ] `.env` added to `.gitignore`
- [ ] `.env.example` created and committed
- [ ] Anthropic console: set $5.00 hard spend limit under Billing > Usage limits
- [ ] `src/api/claude.js` created — missing key throws on import
- [ ] `src/prompts/system.js` created — `buildSystemPrompt('navigation')` returns a string
- [ ] `src/constants.js` created with all values from Section 12.2
- [ ] `CameraPreview.jsx` renders a hidden `<video>` element in the DOM
- [ ] `initCamera(videoEl)` called in `App.jsx` on Start button click — camera stream starts
- [ ] `getFrame(videoEl)` returns a non-null base64 string while stream is active
- [ ] Single manual `callClaude()` call with a static hardcoded frame returns valid JSON — log to console
- [ ] `speak('Hello, VisionGuide is ready')` plays audio through phone speaker
- [ ] **`speechSynthesis.cancel()` test on target device:** call `speak()` with a 10-second utterance, then call `cancel()` mid-speech. Verify silence. If speech continues, confirm the rate=10 flush workaround in `speech.js` is active and re-test.
- [ ] Safety onboarding prompt plays on Start: "VisionGuide is a navigation aid only. Keep using your cane or other mobility aid."
- [ ] Repo pushed to GitHub
- [ ] `vercel` deploy completes — URL accessible from phone browser
- [ ] Camera and TTS work on the phone via the Vercel URL

**End of day 1 state:** camera streams, a single Claude call returns JSON, TTS and cancel() verified on device, safety prompt plays, deployed.
