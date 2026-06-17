# VisionGuide — Week 3 Implementation Spec: Reliability & UX

**Version:** 1.0  
**Depends on:** Week 2 spec complete and all acceptance tests passing on device  
**Deliverable:** Stable 5-minute session with no crashes, no unexplained silence, no repeated directions, and full TalkBack compatibility

---

## Table of Contents

1. [Objectives](#1-objectives)
2. [Daily Task Breakdown](#2-daily-task-breakdown)
3. [Implementation Order](#3-implementation-order)
4. [Context Window — Suppress Repetition](#4-context-window--suppress-repetition)
5. [Deduplication — Direction Suppression](#5-deduplication--direction-suppression)
6. [Silence Fallback Hardening](#6-silence-fallback-hardening)
7. [Stale Frame Guard Verification](#7-stale-frame-guard-verification)
8. [API Error Recovery](#8-api-error-recovery)
9. [Frozen Frame Detection](#9-frozen-frame-detection)
10. [WakeLock Re-acquisition](#10-wakelock-re-acquisition)
11. [Accessibility Audit](#11-accessibility-audit)
12. [WCAG AA Contrast Verification](#12-wcag-aa-contrast-verification)
13. [Memory Leak Prevention](#13-memory-leak-prevention)
14. [Updated loop.js](#14-updated-loopjs)
15. [Updated camera.js](#15-updated-camerajs)
16. [Updated speech.js](#16-updated-speechjs)
17. [Week 3 Acceptance Tests](#17-week-3-acceptance-tests)
18. [Common Failure Modes](#18-common-failure-modes)

---

## 1. Objectives

By end of Week 3 the following must all be true:

- App runs for 5+ minutes without crash, silent failure, or memory growth requiring a reload
- Claude does not repeat the same direction within 10 seconds, confirmed by context window sent with each request
- "Still scanning" fallback fires after 3 seconds of silence — and no more than once per 10 seconds
- Frozen camera frames are detected and the stream is re-initialized automatically
- API errors are recovered from gracefully — the loop continues on the next tick
- WakeLock is re-acquired if the user tabs away and returns
- App is fully operable via TalkBack on Android Chrome with no sighted assistance
- All UI elements pass WCAG AA contrast (4.5:1 minimum)
- No memory leaks from canvas, intervals, or event listeners over a 10-minute session

Do not start Week 4 prompt tuning until every item above passes on the physical device.

---

## 2. Daily Task Breakdown

### Day 1 (Monday)
- Implement context window: last 2 directions sent with every API call
- Implement deduplication in `speech.js`: same text suppressed within 10 seconds
- Verify: run loop for 2 minutes, directions do not repeat back-to-back

### Day 2 (Tuesday)
- Harden silence fallback: enforce 10-second holdoff between "Still scanning" calls
- Verify stale frame guard is set to 4500ms — not 1500ms (common regression from Week 1)
- Implement API error recovery: loop continues on non-200 and network failure
- Add `console.warn` logging for all error paths

### Day 3 (Wednesday)
- Implement frozen frame detection in `camera.js`
- Implement WakeLock re-acquisition on `visibilitychange`
- Full 10-minute session test: no intervention required

### Day 4 (Thursday)
- Accessibility audit: TalkBack end-to-end test
- WCAG AA contrast check on all UI elements
- Fix all failures found in audit

### Day 5 (Friday)
- Memory leak check: Chrome DevTools heap snapshot before and after 10-minute session
- All Week 3 acceptance tests on physical device
- Deploy to Vercel
- Confirm deployed URL works on phone

---

## 3. Implementation Order

```
1. Context window (constants.js + loop.js + App.jsx)
       ↓
2. Deduplication hardening (speech.js)
       ↓
3. Silence fallback holdoff (loop.js)
       ↓
4. API error recovery (loop.js + claude.js)
       ↓
5. Frozen frame detection (camera.js)
       ↓
6. WakeLock re-acquisition (camera.js)
       ↓
7. Accessibility audit (all components)
       ↓
8. Contrast verification (App.jsx + all components)
       ↓
9. Memory leak check
```

---

## 4. Context Window — Suppress Repetition

### 4.1 What it does

Each API call includes the last 2 `navigation_direction` strings Claude returned. This tells Claude what it already said so it does not repeat itself even when the scene has not changed.

Without context, Claude sees the same corridor frame and says "Move forward" five times in a row. With context, it says "Move forward" once, then "Continue ahead past the door on your right", then "The corridor continues — keep moving forward."

### 4.2 How context flows

Context is stored in `App.jsx` state and kept in sync with `loopStateRef` so the interval reads fresh values.

```js
// App.jsx — already in Week 2 implementation
const [context, setContext] = useState([]);

const handleContextUpdate = useCallback((direction) => {
  setContext(prev => [...prev.slice(-1), direction]); // Keep last 2 only
}, []);

// loopStateRef is kept in sync via useEffect
useEffect(() => {
  loopStateRef.current = { goal, context };
}, [goal, context]);
```

### 4.3 How context is sent to Claude

`buildUserMessage()` already includes context. Verify the assembled text matches this format:

```
Goal: the elevator
Prior directions: Move forward through the corridor. → Turn left past the desk.
Analyze this frame.
```

If `context` is empty (first call of the session):

```
Goal: the elevator
No prior context.
Analyze this frame.
```

### 4.4 Verification

Add a temporary `console.log` in `buildUserMessage()` to log the assembled text for the first 3 calls of a session:

```js
export function buildUserMessage(goal, context, base64Frame) {
  const contextText = context.length > 0
    ? `Prior directions: ${context.join(' → ')}`
    : 'No prior context.';

  const text = `Goal: ${goal}\n${contextText}\nAnalyze this frame.`;
  console.debug('Prompt text:', text); // Remove before Week 4
  // ...
}
```

Run the loop for 30 seconds and confirm in console:
- First call: "No prior context."
- Second call: prior direction from first call appears
- Third call: prior directions from calls 1 and 2 appear
- Fourth call: only calls 2 and 3 appear (window slides, call 1 dropped)

### 4.5 Reset context on new session

Context must be cleared when the user taps Start for a new session. Already handled in `handleStart` in `App.jsx`:

```js
setContext([]); // Called before startLoop()
```

Verify this is present. If context carries over between sessions, Claude's first direction in a new session will be influenced by the previous session's final state.

---

## 5. Deduplication — Direction Suppression

### 5.1 Current behavior

`speech.js` already has deduplication logic from the setup spec. Verify it is working correctly — this is the most common Week 2 regression.

```js
// speech.js — deduplication check inside speak()
const now = Date.now();
if (
  !interrupt &&
  text === lastSpokenText &&
  now - lastSpokenAt < DEDUP_WINDOW_MS
) return;
```

### 5.2 What this does and does not cover

**Covers:** Exact string matches. If Claude returns "Move forward" twice within 10 seconds, the second call is suppressed.

**Does not cover:** Near-duplicates. "Move forward" and "Move forward through the corridor" are different strings and both play. This is acceptable for MVP — exact duplicates are the most common case.

### 5.3 Deduplication must not apply to obstacle alerts

Obstacle alerts always use `interrupt=true`. The deduplication check skips when `interrupt=true`:

```js
if (
  !interrupt &&  // ← This ensures obstacle alerts are never deduplicated
  text === lastSpokenText &&
  now - lastSpokenAt < DEDUP_WINDOW_MS
) return;
```

Verify: trigger the same obstacle twice within 10 seconds. The alert must play both times.

### 5.4 Verification test

```js
// Manual test in browser console
speak('Move forward');     // Plays
speak('Move forward');     // Suppressed (within 10s)
speak('Move forward', true); // Plays (interrupt bypasses dedup)

// Wait 11 seconds
speak('Move forward');     // Plays (dedup window expired)
```

---

## 6. Silence Fallback Hardening

### 6.1 Current behavior

The silence fallback timer fires after `API_TIMEOUT_MS` (3000ms) if no response arrives. The problem: if every call takes 3.5 seconds, "Still scanning" fires on every single cycle, creating a wall of "Still scanning" calls.

The `SILENCE_HOLDOFF_MS` constant (10,000ms) must throttle this.

### 6.2 Implementation in loop.js

The silence fallback needs a module-level timestamp to track when it last fired:

```js
// loop.js — add at module level
let lastSilenceFiredAt = 0;
```

Update the silence timer inside the interval:

```js
const silenceTimer = setTimeout(() => {
  const now = Date.now();
  if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
    speak('Still scanning');
    callbacks.onSpeak('Still scanning');
    lastSilenceFiredAt = now;
  }
}, API_TIMEOUT_MS);
```

Reset `lastSilenceFiredAt` when the loop stops:

```js
export function stopLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  pending = false;
  lastSilenceFiredAt = 0; // Reset for next session
}
```

### 6.3 Verification

Simulate slow API response by temporarily adding a delay in `claude.js`:

```js
// Temporary test — remove after verification
await new Promise(resolve => setTimeout(resolve, 4000));
```

Run the loop for 30 seconds. "Still scanning" must play no more than 3 times (once per 10 seconds). Remove the artificial delay after verification.

---

## 7. Stale Frame Guard Verification

### 7.1 Common regression

`STALE_FRAME_MS` was changed from 1500ms to 4500ms in the setup spec based on the technical review. This is the most frequently regressed constant — developers sometimes reset it to a lower value thinking it improves responsiveness.

Verify `constants.js`:

```js
export const STALE_FRAME_MS = 4500; // Must be 4500, not 1500
```

### 7.2 Why 4500ms

At p50 latency of 3 seconds, a 1500ms stale guard discards every valid response. At 4500ms (p95 + 500ms buffer), only genuinely stale responses are dropped.

### 7.3 How to verify the guard is working

Add a temporary log in `loop.js`:

```js
// Temporary — remove after verification
if (Date.now() - capturedAt > STALE_FRAME_MS) {
  console.warn('Stale frame dropped. Age:', Date.now() - capturedAt, 'ms');
  return;
}
```

Run the loop for 2 minutes. Count stale frame drops in the console. If drops are frequent (more than 1 in 10 responses), the network is slow — this is expected and handled by the silence fallback. If drops never occur, the guard is correct and not interfering.

---

## 8. API Error Recovery

### 8.1 Error categories

| Error type | Source | Expected behavior |
|---|---|---|
| Network failure | `fetch()` throws | Speak "Still scanning", continue loop |
| Non-200 response | Anthropic API | Speak "Still scanning", continue loop |
| JSON parse failure | Truncated response | Return safe default, continue loop silently |
| Rate limit (429) | Anthropic API | Speak "Still scanning", back off 5 seconds |

### 8.2 Updated claude.js error handling

```js
// src/api/claude.js

export async function callClaude(systemPrompt, messages) {
  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: systemPrompt,
        messages,
      }),
    });
  } catch (networkErr) {
    // Network failure — fetch itself threw (offline, DNS failure, etc.)
    console.warn('Network error:', networkErr.message);
    throw new Error('network_failure');
  }

  if (response.status === 429) {
    console.warn('Rate limited by Anthropic API');
    throw new Error('rate_limited');
  }

  if (!response.ok) {
    console.warn('Anthropic API error:', response.status);
    throw new Error(`api_error_${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';

  try {
    return JSON.parse(text);
  } catch {
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

### 8.3 Rate limit back-off in loop.js

Handle the `rate_limited` error code with a 5-second pause before the next cycle:

```js
// loop.js — inside the catch block
} catch (err) {
  clearTimeout(silenceTimer);

  if (err.message === 'rate_limited') {
    speak('Connection slow. Pausing briefly.');
    callbacks.onSpeak('Connection slow. Pausing briefly.');
    // Back off: pause the loop for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    if (!silenceFired) {
      speak('Still scanning');
      callbacks.onSpeak('Still scanning');
    }
  }

  callbacks.onError(err.message);
  console.error('Loop error:', err.message);
}
```

### 8.4 Verify recovery

Test by temporarily modifying `claude.js` to throw on every other call:

```js
// Temporary test
let callCount = 0;
export async function callClaude(...) {
  callCount++;
  if (callCount % 2 === 0) throw new Error('network_failure');
  // ... rest of function
}
```

Run for 30 seconds. Every other cycle should speak "Still scanning" and the loop must continue running. Remove the artificial error after verification.

---

## 9. Frozen Frame Detection

### 9.1 Problem

If the camera stream freezes (hardware issue, browser bug, backgrounding), `getFrame()` keeps returning the same base64 string. Claude gets identical frames and navigation becomes unreliable.

### 9.2 Detection approach

Compare the current frame to the previous frame. If they are identical for 3+ consecutive cycles, the stream is frozen.

```js
// src/modules/camera.js — add at module level

let lastFrameData = null;
let frozenFrameCount = 0;
const FROZEN_FRAME_THRESHOLD = 3; // 3 consecutive identical frames = frozen

/**
 * Check if the current frame is identical to the previous one.
 * Resets count on any change.
 * @param {string} frame - base64 JPEG string
 * @returns {boolean} true if stream appears frozen
 */
export function checkFrozenFrame(frame) {
  if (frame === lastFrameData) {
    frozenFrameCount++;
  } else {
    frozenFrameCount = 0;
    lastFrameData = frame;
  }
  return frozenFrameCount >= FROZEN_FRAME_THRESHOLD;
}

export function resetFrozenFrameDetector() {
  lastFrameData = null;
  frozenFrameCount = 0;
}
```

### 9.3 Stream re-initialization

When a frozen frame is detected, stop and restart the camera stream:

```js
// src/modules/camera.js — add exported function

/**
 * Re-initialize camera stream on frozen frame detection.
 * @param {HTMLVideoElement} videoEl
 * @param {MediaStream} currentStream
 * @returns {Promise<MediaStream>} new stream
 */
export async function reinitCamera(videoEl, currentStream) {
  console.warn('Frozen frame detected — re-initializing camera stream');
  await stopCamera(currentStream);
  resetFrozenFrameDetector();
  return initCamera(videoEl);
}
```

### 9.4 Wire into loop.js

```js
// loop.js — inside the interval, after getFrame()
import { getFrame, checkFrozenFrame, reinitCamera } from './camera.js';

const frame = getFrame(videoEl);
if (!frame) return;

// Frozen frame check
if (checkFrozenFrame(frame)) {
  console.warn('Frozen frame — attempting stream reinit');
  try {
    streamRef.current = await reinitCamera(videoEl, streamRef.current);
  } catch (err) {
    speak('Camera stopped. Please reload the page.');
    callbacks.onSpeak('Camera stopped. Please reload the page.');
    stopLoop();
  }
  return; // Skip this cycle
}
```

> **Note:** `streamRef` must be passed into `startLoop()` so the loop can update it on reinit. Update the `startLoop` signature:

```js
export function startLoop(videoEl, streamRef, stateRef, callbacks) { ... }
```

Update `App.jsx` call accordingly:

```js
startLoop(videoRef.current, streamRef, loopStateRef, { ... });
```

---

## 10. WakeLock Re-acquisition

### 10.1 Problem

WakeLock is automatically released when the user backgrounds the app (switches to another app, locks screen, etc.). When they return, the screen will sleep again during navigation.

### 10.2 Implementation

Add a `visibilitychange` listener in `camera.js`. This must be registered once and cleaned up when the camera is stopped.

```js
// src/modules/camera.js

let visibilityHandler = null;

export async function initCamera(videoEl) {
  // ... existing stream setup and WakeLock request ...

  // Re-acquire WakeLock when app comes back to foreground
  visibilityHandler = async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.debug('WakeLock re-acquired after visibility change');
      } catch {
        // Silent — WakeLock is best-effort
      }
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  return stream;
}

export async function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;

  // Clean up visibility listener
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}
```

### 10.3 Verification

1. Start navigation on phone
2. Press home button (backgrounds the app)
3. Return to the browser tab
4. Wait 60 seconds without touching the screen
5. Screen must remain on

---

## 11. Accessibility Audit

Run this audit manually on the physical device using TalkBack. Enable TalkBack in Android Settings > Accessibility.

### 11.1 TalkBack navigation test

Work through every interactive element using TalkBack swipe navigation only — no visual assistance:

| Element | Expected TalkBack announcement |
|---|---|
| Goal text input | "Navigation destination, edit text" |
| Mic button (available) | "Speak your destination, button" |
| Mic button (listening) | "Stop listening, button" |
| Start button | "Start Navigation, button" |
| Stop button | "Stop, button" |
| Status display | Announces status changes automatically without swipe |
| Last spoken text | Announces new directions automatically without swipe |

### 11.2 aria-live verification

`StatusDisplay` uses `aria-live="assertive"`. Verify that when a new navigation direction is spoken by TTS, TalkBack also announces the text change in the `lastSpoken` display without the user swiping to it.

If TalkBack is not announcing changes:
- Confirm `aria-live="assertive"` is on the wrapper `<div>`
- Confirm `aria-atomic="true"` is set (announces the whole region, not just the changed part)
- Check that the DOM update is happening — React state must actually change for `aria-live` to fire

### 11.3 Focus management

On page load, the goal input must be focused. Verify with TalkBack: when the page loads, TalkBack must immediately announce the goal input without the user swiping.

```jsx
// GoalInput.jsx
useEffect(() => {
  inputRef.current?.focus();
}, []);
```

### 11.4 Tap target sizes

Measure all tap targets on the physical device:

```js
// Run in browser console to check element dimensions
document.querySelectorAll('button, input').forEach(el => {
  const rect = el.getBoundingClientRect();
  console.log(el.tagName, el.getAttribute('aria-label') ?? el.textContent.trim(),
    'height:', rect.height, 'width:', rect.width);
});
```

All heights must be ≥ 56px. All widths must be ≥ 56px for buttons.

### 11.5 Required ARIA attributes

Audit checklist:

```
[ ] <input> has aria-label="Navigation destination"
[ ] <input> has aria-describedby pointing to hint text element
[ ] Mic button has aria-label that changes between "Speak your destination" and "Stop listening"
[ ] Start/Stop button aria-label matches visible text
[ ] StatusDisplay wrapper has aria-live="assertive" and aria-atomic="true"
[ ] CameraPreview <video> has aria-hidden="true" (hidden from screen reader — user never needs to interact with it)
[ ] No interactive elements have tabIndex="-1" unless intentionally removed from tab order
```

---

## 12. WCAG AA Contrast Verification

### 12.1 Required ratios

- Normal text (< 18px): minimum 4.5:1
- Large text (≥ 18px or ≥ 14px bold): minimum 3:1
- UI components (buttons, inputs, borders): minimum 3:1

### 12.2 Current color pairs to check

| Element | Foreground | Background | Required ratio |
|---|---|---|---|
| Body text | `#ffffff` | `#0f0f0f` | 4.5:1 |
| Label text | `#ffffff` | `#0f0f0f` | 4.5:1 |
| Hint text | `#777777` | `#0f0f0f` | 4.5:1 |
| Last spoken text | `#ffffff` | `#1a1a1a` | 4.5:1 |
| Status text | `#aaaaaa` | `#1a1a1a` | 4.5:1 |
| Input text | `#ffffff` | `#1a1a1a` | 4.5:1 |
| Input border | `#444444` | `#1a1a1a` | 3:1 |
| Start button | `#ffffff` | `#1a4fd6` | 4.5:1 |
| Stop button | `#ffffff` | `#7a0000` | 4.5:1 |

### 12.3 Known failures to fix

**Hint text `#777777` on `#0f0f0f`:** Contrast ratio is approximately 4.5:1 — borderline. Change to `#888888` minimum, or `#999999` for comfortable margin.

**Status text `#aaaaaa` on `#1a1a1a`:** Ratio is approximately 4.8:1 — passes but barely. Acceptable.

### 12.4 Verification tool

Use the browser DevTools accessibility panel (Chrome DevTools > Elements > Accessibility) to check computed contrast ratios on the physical device via remote debugging:

```
chrome://inspect → inspect phone tab → DevTools → Elements panel → Accessibility tab
```

Alternatively, use the [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) with the hex values above.

---

## 13. Memory Leak Prevention

### 13.1 Sources of leaks in this app

| Source | Risk | Fix |
|---|---|---|
| `setInterval` not cleared | High | `stopLoop()` calls `clearInterval` — verify it is always called on unmount |
| Canvas element created once at module level | Low | Singleton pattern in `camera.js` is correct — canvas is reused not recreated |
| `visibilitychange` listener not removed | Medium | `stopCamera()` removes the listener — verify cleanup runs on unmount |
| `setTimeout` in silence fallback | Low | `clearTimeout(silenceTimer)` in both `try` and `catch` — verify both paths |
| React state updates after unmount | Medium | Check `useEffect` cleanup in `App.jsx` calls `stopLoop()` and `stopCamera()` |
| `SpeechSynthesisUtterance` references | Low | Utterances are garbage collected after `.onend` fires — no manual cleanup needed |

### 13.2 App.jsx cleanup verification

```js
// App.jsx — useEffect cleanup
useEffect(() => {
  return () => {
    stopLoop();
    cancel();
    if (streamRef.current) {
      stopCamera(streamRef.current);
      streamRef.current = null;
    }
  };
}, []); // Empty deps — runs only on unmount
```

Verify this `useEffect` is present and that its dependency array is empty. If it has dependencies, it will run cleanup and re-setup on every render that changes those dependencies, causing loop restarts.

### 13.3 Memory snapshot test

Use Chrome DevTools remote debugging on the phone:

1. Start navigation on phone
2. Open `chrome://inspect` on desktop, connect to phone tab
3. DevTools > Memory > Take heap snapshot (baseline)
4. Let navigation run for 10 minutes
5. Take second heap snapshot
6. Compare: total heap size must not grow by more than 20MB between snapshots
7. Look for accumulating `SpeechSynthesisUtterance`, `ImageData`, or `HTMLCanvasElement` objects

If heap grows continuously, the most likely cause is canvas `ImageData` objects not being released. Ensure `ctx.drawImage()` overwrites the same canvas rather than creating new ones.

---

## 14. Updated loop.js

Full updated implementation incorporating all Week 3 changes:

```js
// src/modules/loop.js

import { getFrame, checkFrozenFrame, reinitCamera } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles, resetObstacles } from './obstacles.js';
import { trackGoal, resetGoalTracker } from './goalTracker.js';
import {
  LOOP_INTERVAL_MS,
  API_TIMEOUT_MS,
  STALE_FRAME_MS,
  SILENCE_HOLDOFF_MS,
} from '../constants.js';

let intervalId = null;
let pending = false;
let lastSilenceFiredAt = 0;

/**
 * @param {HTMLVideoElement} videoEl
 * @param {React.MutableRefObject} streamRef  - Ref to MediaStream (updatable on reinit)
 * @param {React.MutableRefObject} stateRef   - Ref to { goal, context }
 * @param {object} callbacks
 */
export function startLoop(videoEl, streamRef, stateRef, callbacks) {
  if (intervalId !== null) return;

  resetObstacles();
  resetGoalTracker();

  intervalId = setInterval(async () => {
    if (pending) return;

    const frame = getFrame(videoEl);
    if (!frame) return;

    // Frozen frame detection
    if (checkFrozenFrame(frame)) {
      console.warn('Frozen frame detected — reinitializing stream');
      try {
        streamRef.current = await reinitCamera(videoEl, streamRef.current);
      } catch {
        speak('Camera stopped. Please reload the page.');
        callbacks.onSpeak('Camera stopped. Please reload the page.');
        stopLoop();
      }
      return;
    }

    const capturedAt = Date.now();
    pending = true;

    // Silence fallback with holdoff
    let silenceFired = false;
    const silenceTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
        speak('Still scanning');
        callbacks.onSpeak('Still scanning');
        lastSilenceFiredAt = now;
        silenceFired = true;
      }
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;

      const result = await callClaude(
        buildSystemPrompt('navigation'),
        [buildUserMessage(goal, context, frame)]
      );

      clearTimeout(silenceTimer);

      // Stale frame guard
      if (Date.now() - capturedAt > STALE_FRAME_MS) {
        console.debug('Stale response dropped:', Date.now() - capturedAt, 'ms');
        return;
      }

      // Route obstacles
      if (result.obstacles?.length > 0) {
        routeObstacles(result.obstacles);
      }

      // Speak direction
      if (result.navigation_direction) {
        speak(result.navigation_direction);
        callbacks.onSpeak(result.navigation_direction);
        callbacks.onContextUpdate(result.navigation_direction);
      }

      // Check arrival
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        speak(`You have arrived at ${goal}`, true);
        callbacks.onSpeak(`Arrived at ${goal}`);
        callbacks.onArrival();
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);

      if (err.message === 'rate_limited') {
        speak('Connection slow. Pausing briefly.');
        callbacks.onSpeak('Connection slow. Pausing briefly.');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else if (!silenceFired) {
        const now = Date.now();
        if (now - lastSilenceFiredAt >= SILENCE_HOLDOFF_MS) {
          speak('Still scanning');
          callbacks.onSpeak('Still scanning');
          lastSilenceFiredAt = now;
        }
      }

      callbacks.onError(err.message);
      console.error('Loop error:', err.message);
    } finally {
      pending = false;
    }

  }, LOOP_INTERVAL_MS);
}

export function stopLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  pending = false;
  lastSilenceFiredAt = 0;
}

export function isLoopRunning() {
  return intervalId !== null;
}
```

---

## 15. Updated camera.js

Full updated implementation incorporating frozen frame detection and WakeLock re-acquisition:

```js
// src/modules/camera.js

import { speak } from './speech.js';

const FRAME_WIDTH  = 640;
const FRAME_HEIGHT = 480;
const JPEG_QUALITY = 0.7;
const FROZEN_FRAME_THRESHOLD = 3;

// Singleton canvas — reused every frame, never recreated
const canvas = document.createElement('canvas');
canvas.width  = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;
const ctx = canvas.getContext('2d');

let wakeLock = null;
let visibilityHandler = null;

// Frozen frame state
let lastFrameData = null;
let frozenFrameCount = 0;

// --- Camera init / stop ---

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

  // WakeLock
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    console.debug('WakeLock acquired');
  } catch {
    speak('Please keep the screen on manually during navigation.');
  }

  // Re-acquire WakeLock on visibility change
  visibilityHandler = async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.debug('WakeLock re-acquired');
      } catch { /* silent */ }
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  return stream;
}

export async function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());

  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }

  resetFrozenFrameDetector();
}

export async function reinitCamera(videoEl, currentStream) {
  await stopCamera(currentStream);
  return initCamera(videoEl);
}

// --- Frame capture ---

export function getFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  ctx.drawImage(videoEl, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1];
}

// --- Frozen frame detection ---

export function checkFrozenFrame(frame) {
  if (frame === lastFrameData) {
    frozenFrameCount++;
    if (frozenFrameCount >= FROZEN_FRAME_THRESHOLD) {
      console.warn(`Frozen frame count: ${frozenFrameCount}`);
    }
  } else {
    frozenFrameCount = 0;
    lastFrameData = frame;
  }
  return frozenFrameCount >= FROZEN_FRAME_THRESHOLD;
}

export function resetFrozenFrameDetector() {
  lastFrameData = null;
  frozenFrameCount = 0;
}
```

---

## 16. Updated speech.js

No structural changes from Week 2. Verify the following are all present and correct:

```js
// src/modules/speech.js — full verified implementation

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
  if (!voices.length) return null; // Voices not loaded yet — utterance will use default
  selectedVoice = voices.find(v => v.lang === TTS_CONFIG.voiceLang && v.localService)
    || voices.find(v => v.lang === TTS_CONFIG.voiceLang)
    || voices[0];
  return selectedVoice;
}

window.speechSynthesis.onvoiceschanged = () => { selectedVoice = null; };

function createUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate   = TTS_CONFIG.rate;
  u.pitch  = TTS_CONFIG.pitch;
  u.volume = TTS_CONFIG.volume;
  u.voice  = selectVoice(); // May be null on first call — browser uses default
  return u;
}

let lastSpokenText = '';
let lastSpokenAt = 0;
const DEDUP_WINDOW_MS = 10_000;

export function speak(text, interrupt = false) {
  if (!text || !text.trim()) return;

  const now = Date.now();
  if (
    !interrupt &&
    text === lastSpokenText &&
    now - lastSpokenAt < DEDUP_WINDOW_MS
  ) return;

  if (interrupt) cancel();

  const utterance = createUtterance(text);
  window.speechSynthesis.speak(utterance);

  lastSpokenText = text;
  lastSpokenAt = now;
}

export function cancel() {
  window.speechSynthesis.cancel();
  // Android cancel() bug workaround
  if (window.speechSynthesis.speaking) {
    const flush = new SpeechSynthesisUtterance(' ');
    flush.volume = 0;
    flush.rate = 10;
    window.speechSynthesis.speak(flush);
  }
}

export function resetSpeech() {
  cancel();
  lastSpokenText = '';
  lastSpokenAt = 0;
}
```

Call `resetSpeech()` in `App.jsx` `handleStop()` instead of just `cancel()` so deduplication state is also cleared between sessions.

---

## 17. Week 3 Acceptance Tests

Run all on the physical device. All Week 2 acceptance tests must still pass.

### AT-W3-01: No repeated directions
- Run loop for 2 minutes in a static scene (phone not moving)
- **Pass:** Same direction not spoken more than once per 10 seconds

### AT-W3-02: Context window active
- Check browser console for prompt text logs (if temporary logging still in place)
- **Pass:** Third+ API calls show prior directions in the prompt text

### AT-W3-03: Silence fallback throttled
- Simulate slow network (Chrome DevTools > Network throttling > Slow 3G via remote debug)
- Run loop for 60 seconds
- **Pass:** "Still scanning" plays no more than 6 times (once per 10 seconds maximum)

### AT-W3-04: API error recovery
- Enable airplane mode briefly (3 seconds) during navigation, then disable
- **Pass:** App speaks "Still scanning" during outage, resumes directions within 5 seconds of reconnection

### AT-W3-05: Frozen frame recovery
- This is hard to trigger naturally — test by temporarily returning a fixed string from `getFrame()` for 5 seconds
- **Pass:** Stream reinitializes, navigation resumes within 5 seconds of freeze detection

### AT-W3-06: WakeLock persists after backgrounding
- Start navigation, press home button, wait 10 seconds, return to browser tab
- Wait 2 minutes without touching screen
- **Pass:** Screen remains on

### AT-W3-07: Full 5-minute session
- Start navigation, set phone on desk pointed at a door
- Do not touch phone for 5 minutes
- **Pass:** Directions continue throughout, no crashes, no unexplained silence longer than 15 seconds, screen remains on

### AT-W3-08: TalkBack full operation
- Enable TalkBack, complete a full navigation session using only TalkBack swipe navigation
- **Pass:** Every interactive element is reachable and correctly labelled, status changes announced automatically

### AT-W3-09: Contrast pass
- Open DevTools accessibility panel via remote debug
- Check all color pairs from Section 12.2
- **Pass:** All pairs meet or exceed 4.5:1

### AT-W3-10: Memory stability
- Take heap snapshot before and after 10-minute session
- **Pass:** Heap growth under 20MB

---

## 18. Common Failure Modes

### Context not updating between calls
- `loopStateRef` not being kept in sync with state — check `useEffect` in `App.jsx` has both `goal` and `context` in its dependency array
- `context` state setter using stale value — confirm `setContext(prev => ...)` pattern (functional update), not `setContext([...context, direction])`

### "Still scanning" fires every cycle despite holdoff
- `lastSilenceFiredAt` is a module-level variable but `stopLoop()` is not resetting it to 0 — check `stopLoop()` resets it
- Silence timer `clearTimeout` not being called on the success path — verify `clearTimeout(silenceTimer)` is inside the `try` block before the `return` on stale frame drop

### Frozen frame detection triggers incorrectly in low light
- Low-light scenes produce very similar (but not identical) frames — identical string comparison is strict, so this should not trigger false positives
- If it does: add a minimum count check — require 5 consecutive identical frames instead of 3 by increasing `FROZEN_FRAME_THRESHOLD`

### WakeLock not re-acquired after backgrounding
- `visibilityHandler` registered but `wakeLock` not nulled on release — when the system releases WakeLock (on background), `wakeLock` object still exists but is released; the check `wakeLock === null` fails
- Fix: listen to the WakeLock's own release event:

```js
wakeLock = await navigator.wakeLock.request('screen');
wakeLock.addEventListener('release', () => {
  wakeLock = null; // Nulled when system releases it
  console.debug('WakeLock released by system');
});
```

### TalkBack not announcing direction changes
- `aria-live` is on the wrong element — must be on the container, not the text element itself
- React is updating state but DOM is not changing — if `lastSpoken` is set to the same string twice, React may batch and skip the update; add a timestamp or counter to force a change:

```js
// App.jsx — handleSpeak
const handleSpeak = useCallback((text) => {
  setLastSpoken({ text, ts: Date.now() }); // Force new object reference
}, []);

// StatusDisplay.jsx
<p>{lastSpoken.text}</p>
```

### Memory growing continuously
- Canvas `getImageData()` being called somewhere and not released — check no one is calling `ctx.getImageData()` (not needed in this implementation)
- `SpeechSynthesisUtterance` objects accumulating — ensure no array or ref is storing utterances after they fire
- Event listeners accumulating — verify `visibilitychange` listener is removed in `stopCamera()` and only one listener is added per `initCamera()` call
