# VisionGuide — Week 2 Implementation Spec: Core Loop

**Version:** 1.0  
**Depends on:** Week 1 setup spec (project scaffolded, camera streaming, single Claude call verified, TTS verified, deployed)  
**Deliverable:** Point phone at a room, speak or type a destination, hear spoken navigation directions continuously

---

## Table of Contents

1. [Objectives](#1-objectives)
2. [Daily Task Breakdown](#2-daily-task-breakdown)
3. [Implementation Order](#3-implementation-order)
4. [loop.js — NavigationLoop](#4-loopjs--navigationloop)
5. [obstacles.js — ObstacleRouter](#5-obstaclesjs--obstaclerouter)
6. [goalTracker.js — GoalTracker](#6-goaltrackerjs--goaltracker)
7. [speech.js — Interrupt vs Queue](#7-speechjs--interrupt-vs-queue)
8. [App.jsx — Wiring Everything Together](#8-appjsx--wiring-everything-together)
9. [GoalInput.jsx](#9-goalinputjsx)
10. [StartStopButton.jsx](#10-startstopbuttonjsx)
11. [StatusDisplay.jsx](#11-statusdisplayjsx)
12. [Safety Onboarding Prompt](#12-safety-onboarding-prompt)
13. [WakeLock Verification](#13-wakelock-verification)
14. [Week 2 Acceptance Tests](#14-week-2-acceptance-tests)
15. [Common Failure Modes](#15-common-failure-modes)

---

## 1. Objectives

By end of Week 2 the following must all be true:

- The navigation loop runs at 1 fps continuously after the user taps Start
- Each loop cycle captures a live frame, sends it to Claude with the user's goal, and speaks the returned direction
- High-urgency obstacles interrupt current speech immediately
- Medium-urgency obstacles queue after current speech finishes
- Goal arrival stops the loop and speaks confirmation
- The loop stops cleanly when the user taps Stop
- WakeLock prevents screen sleep during navigation
- Safety onboarding prompt plays before the first loop cycle

Nothing else. No context window, no deduplication tuning, no error recovery polish — those are Week 3.

---

## 2. Daily Task Breakdown

### Day 1 (Monday)
- Implement `loop.js` with hardcoded goal string `"the exit"`
- Verify full pipeline: frame → Claude → speak, without any UI wiring
- Goal: spoken direction within 3 seconds of starting the loop manually from console or a temporary button

### Day 2 (Tuesday)
- Implement `obstacles.js` and `goalTracker.js`
- Wire both into the loop
- Verify: hold phone near a chair, hear an obstacle alert interrupt navigation direction

### Day 3 (Wednesday)
- Implement `GoalInput.jsx`, `StartStopButton.jsx`, `StatusDisplay.jsx`
- Wire goal input to app state
- Replace hardcoded goal with live state value
- Verify: type "the elevator", tap Start, hear directions

### Day 4 (Thursday)
- Implement safety onboarding prompt
- Implement WakeLock in `camera.js` (may already be partially done from Week 1)
- Wire Start/Stop button to loop start/stop
- Full end-to-end test: goal input → Start → navigation → Stop

### Day 5 (Friday)
- End-to-end acceptance test against all criteria in Section 14
- Fix any failures
- Deploy to Vercel
- Test on phone over the deployed URL

---

## 3. Implementation Order

Do not build these in parallel. Build in this sequence — each item depends on the previous one working.

```
1. loop.js (hardcoded goal)
       ↓
2. obstacles.js + goalTracker.js → wire into loop.js
       ↓
3. GoalInput.jsx + StartStopButton.jsx + StatusDisplay.jsx
       ↓
4. App.jsx wiring (state → loop → components)
       ↓
5. Safety prompt + WakeLock
       ↓
6. Acceptance tests
```

---

## 4. loop.js — NavigationLoop

This is the core of the entire application. Everything else serves it.

### 4.1 Full implementation

```js
// src/modules/loop.js

import { getFrame } from './camera.js';
import { callClaude, buildUserMessage } from '../api/claude.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { speak } from './speech.js';
import { routeObstacles, resetObstacles } from './obstacles.js';
import { trackGoal, resetGoalTracker } from './goalTracker.js';
import {
  LOOP_INTERVAL_MS,
  API_TIMEOUT_MS,
  STALE_FRAME_MS,
} from '../constants.js';

let intervalId = null;
let pending = false;

/**
 * Start the navigation loop.
 *
 * @param {HTMLVideoElement} videoEl      - Live camera feed element
 * @param {React.MutableRefObject} stateRef - Ref containing { goal: string, context: string[] }
 *                                           Use a ref (not state) so the interval always reads
 *                                           fresh values without needing to restart the loop.
 * @param {object} callbacks
 * @param {function} callbacks.onSpeak          - Called with spoken text string (updates StatusDisplay)
 * @param {function} callbacks.onContextUpdate  - Called with navigation_direction string (updates context array)
 * @param {function} callbacks.onArrival        - Called when goal is confirmed reached
 * @param {function} callbacks.onError          - Called with error string on API failure
 */
export function startLoop(videoEl, stateRef, callbacks) {
  if (intervalId !== null) return; // Prevent double-start

  resetObstacles();
  resetGoalTracker();

  intervalId = setInterval(async () => {
    // Guard: skip if prior call is still in flight
    if (pending) return;

    // Capture frame
    const frame = getFrame(videoEl);
    if (!frame) return; // Video not ready yet

    const capturedAt = Date.now();
    pending = true;

    // Silence fallback: if no response within API_TIMEOUT_MS, speak holding message
    let silenceFired = false;
    const silenceTimer = setTimeout(() => {
      silenceFired = true;
      speak('Still scanning');
      callbacks.onSpeak('Still scanning');
    }, API_TIMEOUT_MS);

    try {
      const { goal, context } = stateRef.current;

      const result = await callClaude(
        buildSystemPrompt('navigation'),
        [buildUserMessage(goal, context, frame)]
      );

      clearTimeout(silenceTimer);

      // Drop stale responses — user has moved too far for this frame to be actionable
      if (Date.now() - capturedAt > STALE_FRAME_MS) {
        console.debug('Stale frame dropped', Date.now() - capturedAt, 'ms old');
        return;
      }

      // Route obstacles first — may interrupt speech
      if (result.obstacles?.length > 0) {
        routeObstacles(result.obstacles);
      }

      // Speak navigation direction
      if (result.navigation_direction) {
        speak(result.navigation_direction);
        callbacks.onSpeak(result.navigation_direction);
        callbacks.onContextUpdate(result.navigation_direction);
      }

      // Check goal arrival
      const arrived = trackGoal(result.goal_found, result.goal_confidence);
      if (arrived) {
        speak(`You have arrived at ${goal}`, true);
        callbacks.onSpeak(`Arrived at ${goal}`);
        callbacks.onArrival();
        stopLoop();
      }

    } catch (err) {
      clearTimeout(silenceTimer);
      if (!silenceFired) {
        speak('Still scanning');
        callbacks.onSpeak('Still scanning');
      }
      callbacks.onError(err.message);
      console.error('Loop error:', err);
    } finally {
      pending = false;
    }

  }, LOOP_INTERVAL_MS);
}

/**
 * Stop the navigation loop. Safe to call if loop is not running.
 */
export function stopLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  pending = false;
}

/**
 * Check if loop is currently running.
 * @returns {boolean}
 */
export function isLoopRunning() {
  return intervalId !== null;
}
```

### 4.2 The stateRef pattern

The loop runs inside `setInterval`. If you pass React state directly, the interval captures a stale closure — it will always read the goal value from when the loop started, ignoring updates.

Use a `useRef` in `App.jsx` that you keep in sync with state:

```js
// App.jsx
const [goal, setGoal] = useState('');
const [context, setContext] = useState([]);

// Keep a ref in sync with state so the loop always reads fresh values
const loopStateRef = useRef({ goal, context });
useEffect(() => {
  loopStateRef.current = { goal, context };
}, [goal, context]);
```

Pass `loopStateRef` to `startLoop()`. The interval reads `stateRef.current` on every tick.

### 4.3 Day 1 smoke test (before UI wiring)

Add a temporary button in `App.jsx` to verify the loop works before building the UI:

```jsx
// Temporary — remove after Day 1 verification
<button onClick={() => {
  const ref = { current: { goal: 'the exit', context: [] } };
  startLoop(videoRef.current, ref, {
    onSpeak: (t) => console.log('Spoken:', t),
    onContextUpdate: (t) => console.log('Context:', t),
    onArrival: () => console.log('Arrived'),
    onError: (e) => console.error('Error:', e),
  });
}}>
  Test Loop
</button>
<button onClick={stopLoop}>Stop</button>
```

Expected console output within 3-4 seconds of clicking Test Loop:
```
Spoken: Move forward through the corridor ahead.
Context: Move forward through the corridor ahead.
```

---

## 5. obstacles.js — ObstacleRouter

### 5.1 Full implementation

```js
// src/modules/obstacles.js

import { speak } from './speech.js';

/**
 * Route obstacles to speech output.
 *
 * High urgency: interrupt current speech immediately, fire on first frame.
 * No 2-frame confirmation — at 1fps + 3s latency, confirmation delay
 * consumes the entire available safety window.
 *
 * Medium urgency: queue after current speech.
 * Low urgency: discard silently.
 *
 * @param {Array<{type: string, direction: string, urgency: 'high'|'medium'|'low'}>} obstacles
 */
export function routeObstacles(obstacles) {
  if (!obstacles || obstacles.length === 0) return;

  // Process high urgency first — only the first one fires to avoid speech pile-up
  const highUrgency = obstacles.find(o => o.urgency === 'high');
  if (highUrgency) {
    const alert = formatObstacleAlert(highUrgency);
    speak(alert, true); // interrupt=true
    return; // Don't queue medium after a high interrupt
  }

  // Medium urgency — queue, don't interrupt
  const medium = obstacles.find(o => o.urgency === 'medium');
  if (medium) {
    const alert = formatObstacleAlert(medium);
    speak(alert, false); // interrupt=false, queues after current speech
  }

  // Low urgency: discard
}

/**
 * Format obstacle into a short spoken alert.
 * Max 8 words. No "I see" or "it looks like".
 *
 * @param {{type: string, direction: string}} obstacle
 * @returns {string}
 */
function formatObstacleAlert(obstacle) {
  const type = obstacle.type?.toLowerCase() ?? 'obstacle';
  const dir = obstacle.direction?.toLowerCase() ?? 'ahead';

  // Special case: steps and stairs are higher risk — prepend "Caution"
  if (type.includes('step') || type.includes('stair')) {
    return `Caution — ${type} ${dir}`;
  }

  return `${capitalize(type)} on your ${dir}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Reset obstacle state. Call before starting a new navigation session.
 * (No confirmation counter in current implementation — kept for API consistency
 * and future use if confirmation is re-introduced.)
 */
export function resetObstacles() {
  // No state to reset currently
}
```

### 5.2 Verification test

With the loop running, place an object close to the camera and wait for a response. The spoken alert should interrupt any ongoing navigation direction. Check in console that `speak()` was called with `interrupt=true`.

---

## 6. goalTracker.js — GoalTracker

### 6.1 Full implementation

```js
// src/modules/goalTracker.js

import { GOAL_CONFIDENCE_THRESHOLD, GOAL_CONFIRM_FRAMES } from '../constants.js';

let consecutiveFoundCount = 0;

/**
 * Track goal arrival across consecutive frames.
 * Requires GOAL_CONFIRM_FRAMES consecutive frames with goal_found=true
 * and goal_confidence >= GOAL_CONFIDENCE_THRESHOLD before confirming arrival.
 * Two-frame confirmation retained for goal (unlike obstacles) because a false
 * arrival announcement stops the entire loop — more costly than a false obstacle alert.
 *
 * @param {boolean} goalFound
 * @param {number}  goalConfidence  - 0.0 to 1.0
 * @returns {boolean} true when arrival is confirmed, false otherwise
 */
export function trackGoal(goalFound, goalConfidence) {
  if (goalFound === true && goalConfidence >= GOAL_CONFIDENCE_THRESHOLD) {
    consecutiveFoundCount++;
    console.debug(`Goal confidence: ${goalConfidence}, consecutive: ${consecutiveFoundCount}`);
    return consecutiveFoundCount >= GOAL_CONFIRM_FRAMES;
  }

  // Reset on any frame that doesn't meet threshold
  if (consecutiveFoundCount > 0) {
    console.debug('Goal confidence dropped, resetting counter');
  }
  consecutiveFoundCount = 0;
  return false;
}

/**
 * Reset tracker. Call before starting a new navigation session.
 */
export function resetGoalTracker() {
  consecutiveFoundCount = 0;
}
```

---

## 7. speech.js — Interrupt vs Queue

The speech module from the setup spec is complete. Verify the following behaviors are working before wiring the loop:

### 7.1 Behavior checklist

| Scenario | Expected behavior |
|---|---|
| `speak('text A')` then `speak('text B')` | A plays, B queues, B plays after A finishes |
| `speak('text A')` then `speak('text B', true)` | A is cancelled mid-speech, B plays immediately |
| `speak('same text')` called twice within 10s | Second call is suppressed by deduplication |
| `speak('same text')` called after 10s | Second call plays normally |
| `speak('')` | No-op, no error |

### 7.2 Manual verification in browser console

```js
// Open browser console at localhost:5173
// Import or call via window if exposed temporarily

speechSynthesis.speak(new SpeechSynthesisUtterance('This is a long sentence that will take several seconds to speak aloud in the browser'));
// Immediately after:
speechSynthesis.cancel();
// Then check: did speech stop? If not, the Android cancel() workaround is needed.
```

### 7.3 Reminder: cancel() workaround

Ensure `cancel()` in `speech.js` includes the Android workaround from the setup spec:

```js
export function cancel() {
  window.speechSynthesis.cancel();
  if (window.speechSynthesis.speaking) {
    const flush = new SpeechSynthesisUtterance(' ');
    flush.volume = 0;
    flush.rate = 10;
    window.speechSynthesis.speak(flush);
  }
}
```

---

## 8. App.jsx — Wiring Everything Together

### 8.1 Full implementation

```jsx
// src/App.jsx

import { useState, useRef, useEffect, useCallback } from 'react';
import { initCamera, stopCamera } from './modules/camera.js';
import { startLoop, stopLoop } from './modules/loop.js';
import { speak, cancel } from './modules/speech.js';
import GoalInput from './components/GoalInput.jsx';
import StartStopButton from './components/StartStopButton.jsx';
import StatusDisplay from './components/StatusDisplay.jsx';
import CameraPreview from './components/CameraPreview.jsx';

export default function App() {
  // --- State ---
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState('idle');
  // 'idle' | 'listening' | 'navigating' | 'arrived'
  const [lastSpoken, setLastSpoken] = useState('');
  const [context, setContext] = useState([]);

  // --- Refs ---
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Keep loopStateRef in sync with state so the interval reads fresh values
  const loopStateRef = useRef({ goal, context });
  useEffect(() => {
    loopStateRef.current = { goal, context };
  }, [goal, context]);

  // --- Callbacks for the loop ---
  const handleSpeak = useCallback((text) => {
    setLastSpoken(text);
  }, []);

  const handleContextUpdate = useCallback((direction) => {
    setContext(prev => [...prev.slice(-1), direction]); // Keep last 2
  }, []);

  const handleArrival = useCallback(() => {
    setStatus('arrived');
  }, []);

  const handleError = useCallback((errorMsg) => {
    console.error('Navigation error:', errorMsg);
    // Loop continues — errors are handled inside loop.js with "Still scanning"
  }, []);

  // --- Start navigation ---
  const handleStart = useCallback(async () => {
    if (!goal.trim()) return;
    if (status === 'navigating') return;

    // Initialize camera if not already running
    if (!streamRef.current) {
      try {
        streamRef.current = await initCamera(videoRef.current);
      } catch {
        setLastSpoken('Camera access denied. Please allow camera and try again.');
        return;
      }
    }

    // Play safety onboarding prompt — loop starts after it finishes speaking
    const safetyUtterance = new SpeechSynthesisUtterance(
      'VisionGuide is a navigation aid only. Keep using your cane or other mobility aid.'
    );
    safetyUtterance.onend = () => {
      setStatus('navigating');
      setContext([]);
      startLoop(videoRef.current, loopStateRef, {
        onSpeak: handleSpeak,
        onContextUpdate: handleContextUpdate,
        onArrival: handleArrival,
        onError: handleError,
      });
    };
    window.speechSynthesis.speak(safetyUtterance);

  }, [goal, status, handleSpeak, handleContextUpdate, handleArrival, handleError]);

  // --- Stop navigation ---
  const handleStop = useCallback(() => {
    stopLoop();
    cancel();
    setStatus('idle');
    setLastSpoken('');
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      stopLoop();
      if (streamRef.current) {
        stopCamera(streamRef.current);
      }
    };
  }, []);

  return (
    <div style={styles.container}>
      <CameraPreview videoRef={videoRef} />

      <div style={styles.content}>
        <h1 style={styles.title}>VisionGuide</h1>

        <GoalInput
          goal={goal}
          onGoalChange={setGoal}
          disabled={status === 'navigating'}
          isListening={status === 'listening'}
          onStatusChange={setStatus}
        />

        <StartStopButton
          status={status}
          onStart={handleStart}
          onStop={handleStop}
          disabled={!goal.trim() || status === 'listening'}
        />

        <StatusDisplay
          status={status}
          lastSpoken={lastSpoken}
        />
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f0f',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  content: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  title: {
    color: '#ffffff',
    fontSize: '28px',
    fontWeight: '700',
    margin: 0,
    letterSpacing: '-0.02em',
  },
};
```

### 8.2 Why the safety prompt uses `onend`

The loop must not start until the safety prompt finishes playing. Using `onend` ensures this. Do not use a `setTimeout` — speech duration varies by device and voice.

---

## 9. GoalInput.jsx

```jsx
// src/components/GoalInput.jsx

import { useEffect, useRef } from 'react';
import { isRecognitionAvailable, startRecognition } from '../modules/recognition.js';
import { speak } from '../modules/speech.js';

export default function GoalInput({ goal, onGoalChange, disabled, isListening, onStatusChange }) {
  const inputRef = useRef(null);
  const stopRecognitionRef = useRef(null);

  // Focus input on mount for screen reader / keyboard access
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleMicClick = () => {
    if (isListening) {
      // Cancel active recognition
      stopRecognitionRef.current?.();
      onStatusChange('idle');
      return;
    }

    onStatusChange('listening');
    speak('Listening');

    stopRecognitionRef.current = startRecognition(
      (result) => {
        onGoalChange(result);
        speak(`I heard: ${result}. Tap Start to begin.`);
        onStatusChange('idle');
      },
      (error) => {
        console.warn('Recognition error:', error);
        speak("Didn't catch that. Please try again or type your destination.");
        onStatusChange('idle');
      }
    );
  };

  return (
    <div style={styles.wrapper}>
      <label
        htmlFor="goal-input"
        style={styles.label}
      >
        Where do you want to go?
      </label>

      <div style={styles.row}>
        <input
          id="goal-input"
          ref={inputRef}
          type="text"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          placeholder="e.g. the elevator, room 204, the exit"
          disabled={disabled}
          aria-label="Navigation destination"
          aria-describedby="goal-hint"
          style={{
            ...styles.input,
            opacity: disabled ? 0.5 : 1,
          }}
        />

        {isRecognitionAvailable() && (
          <button
            onClick={handleMicClick}
            disabled={disabled}
            aria-label={isListening ? 'Stop listening' : 'Speak your destination'}
            style={{
              ...styles.micButton,
              background: isListening ? '#b84c00' : '#1a4fd6',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {isListening ? '■' : '🎤'}
          </button>
        )}
      </div>

      <span id="goal-hint" style={styles.hint}>
        {isListening ? 'Listening — speak your destination now' : 'Type or speak where you want to go'}
      </span>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: '500',
  },
  row: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    fontSize: '18px',
    border: '1px solid #444',
    borderRadius: '8px',
    background: '#1a1a1a',
    color: '#ffffff',
    outline: 'none',
    minHeight: '56px',
  },
  micButton: {
    width: '56px',
    height: '56px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  hint: {
    color: '#777',
    fontSize: '13px',
  },
};
```

---

## 10. StartStopButton.jsx

```jsx
// src/components/StartStopButton.jsx

export default function StartStopButton({ status, onStart, onStop, disabled }) {
  const isNavigating = status === 'navigating';
  const isListening = status === 'listening';
  const isArrived = status === 'arrived';

  const label = isNavigating
    ? 'Stop'
    : isListening
    ? 'Listening...'
    : isArrived
    ? 'Start Again'
    : 'Start Navigation';

  const handleClick = isNavigating ? onStop : onStart;

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isListening}
      aria-label={label}
      style={{
        ...styles.button,
        background: isNavigating ? '#7a0000' : '#1a4fd6',
        opacity: (disabled || isListening) ? 0.4 : 1,
        cursor: (disabled || isListening) ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const styles = {
  button: {
    width: '100%',
    minHeight: '64px',
    borderRadius: '10px',
    border: 'none',
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    letterSpacing: '-0.01em',
    transition: 'background 0.15s',
  },
};
```

---

## 11. StatusDisplay.jsx

```jsx
// src/components/StatusDisplay.jsx

const STATUS_LABELS = {
  idle: 'Ready',
  listening: 'Listening...',
  navigating: 'Navigating',
  arrived: 'Arrived',
};

export default function StatusDisplay({ status, lastSpoken }) {
  return (
    // aria-live="assertive" ensures TalkBack announces all changes without user interaction
    <div
      aria-live="assertive"
      aria-atomic="true"
      style={styles.wrapper}
    >
      <div style={styles.statusLine}>
        <span style={{
          ...styles.dot,
          background: status === 'navigating' ? '#22c55e'
            : status === 'arrived' ? '#1a4fd6'
            : status === 'listening' ? '#b84c00'
            : '#555',
        }} />
        <span style={styles.statusText}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      {lastSpoken ? (
        <p style={styles.lastSpoken}>
          {lastSpoken}
        </p>
      ) : null}
    </div>
  );
}

const styles = {
  wrapper: {
    padding: '16px',
    background: '#1a1a1a',
    borderRadius: '10px',
    border: '1px solid #333',
    minHeight: '80px',
  },
  statusLine: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    color: '#aaa',
    fontSize: '13px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  lastSpoken: {
    color: '#ffffff',
    fontSize: '18px',
    lineHeight: '1.5',
    margin: 0,
  },
};
```

---

## 12. Safety Onboarding Prompt

The safety prompt is wired in `App.jsx` inside `handleStart`. It must play before every session, every time Start is tapped.

```js
// Inside handleStart() in App.jsx — already shown in Section 8
const safetyUtterance = new SpeechSynthesisUtterance(
  'VisionGuide is a navigation aid only. Keep using your cane or other mobility aid.'
);
safetyUtterance.onend = () => {
  setStatus('navigating');
  setContext([]);
  startLoop(videoRef.current, loopStateRef, { ... });
};
window.speechSynthesis.speak(safetyUtterance);
```

**Verify:** tap Start, confirm the safety prompt plays fully before the first navigation direction is spoken. The status indicator must remain on "Ready" until `safetyUtterance.onend` fires.

---

## 13. WakeLock Verification

WakeLock should have been implemented in `camera.js` during Week 1. Verify it is working:

1. Start navigation on the phone
2. Wait 30 seconds without touching the screen
3. Screen must remain on

If the screen sleeps, check:

```js
// camera.js — initCamera()
try {
  wakeLock = await navigator.wakeLock.request('screen');
  console.log('WakeLock acquired');
} catch (err) {
  console.warn('WakeLock failed:', err);
  speak('Please keep the screen on manually during navigation.');
}
```

WakeLock is released automatically when the tab is backgrounded. If the user switches apps, it releases. Re-acquire it on `visibilitychange`:

```js
// Add to camera.js
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* silent */ }
  }
});
```

---

## 14. Week 2 Acceptance Tests

Run all of these on the physical demo device before end of week. Not on desktop.

### AT-01: Basic loop runs
- Start navigation with goal "the exit"
- **Pass:** Spoken navigation direction heard within 4 seconds

### AT-02: Loop continues
- Run loop for 2 minutes without touching the phone
- **Pass:** Directions continue playing approximately every 3-5 seconds, no unexplained silence longer than 10 seconds

### AT-03: Stop button works
- Start navigation, tap Stop
- **Pass:** Speech stops, status returns to "Ready", no further directions are spoken

### AT-04: Goal arrival
- Hold phone directly in front of a clearly labelled door or elevator
- Set goal to match exactly what is visible
- **Pass:** App speaks "You have arrived at [goal]" and stops the loop within 10 seconds

### AT-05: High-urgency obstacle interrupt
- Start navigation with open path
- Move phone suddenly to face a close object (chair, wall, person)
- **Pass:** Obstacle alert interrupts any ongoing navigation direction and plays immediately

### AT-06: Medium-urgency obstacle queues
- If you can arrange a medium-urgency obstacle in the scene (object to the side, not directly in path)
- **Pass:** Obstacle alert plays after the current navigation direction finishes, not interrupting it

### AT-07: Safety prompt on every Start
- Tap Start, listen
- Tap Stop, tap Start again
- **Pass:** Safety prompt plays both times before navigation directions begin

### AT-08: Screen stays on
- Start navigation, leave phone on a surface for 2 minutes without touching
- **Pass:** Screen remains on

### AT-09: Goal input → directions match goal
- Type "the elevator" as goal
- **Pass:** Claude's navigation directions reference moving toward or finding an elevator, not a generic direction

### AT-10: Voice input populates goal
- Tap mic button, speak "the exit"
- **Pass:** Goal field populates with "the exit", readback plays "I heard: the exit. Tap Start to begin."

---

## 15. Common Failure Modes

### Loop runs but speech never plays
- Check `speechSynthesis.getVoices()` returns voices — on some Android builds voices load async and are empty on first call
- Ensure `window.speechSynthesis.onvoiceschanged` is set in `speech.js` to re-select voice after load
- Check browser console for errors in `speak()`

### Loop fires once then stops
- `pending` flag not being reset — ensure `finally { pending = false; }` is in the loop
- Check that `callClaude()` is not throwing and being caught before `finally`

### "Still scanning" plays every cycle
- API latency is consistently above `API_TIMEOUT_MS` (3000ms) — normal under poor network
- Or `callClaude()` is throwing on every call — check console for API errors
- Or `STALE_FRAME_MS` (4500ms) is still set to old value of 1500ms — check `constants.js`

### Safety prompt plays but loop never starts
- `safetyUtterance.onend` not firing — happens if `speechSynthesis` is already speaking when you call `speak()` for the safety prompt
- Fix: call `window.speechSynthesis.cancel()` before speaking the safety prompt to clear the queue

### Obstacle alert doesn't interrupt navigation direction
- `speak(alert, true)` is being called but `cancel()` is not working — Android cancel() bug
- Confirm the rate=10 flush workaround is present in `cancel()` in `speech.js`

### Goal arrival never triggers
- `goal_confidence` is consistently below 0.8 for the chosen destination
- Try a more visually distinct destination (large elevator door, illuminated exit sign)
- Log `result.goal_found` and `result.goal_confidence` to console to confirm values being returned

### Video ref is null when loop starts
- `videoRef` is being passed to `startLoop` before `CameraPreview` has mounted
- Ensure `initCamera()` is called after the component has mounted, inside `handleStart`, not in a `useEffect` on mount
