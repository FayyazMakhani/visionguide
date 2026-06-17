# VisionGuide — Week 4 Implementation Spec: Polish & Demo

**Version:** 1.0  
**Depends on:** Week 3 spec complete — all acceptance tests passing, 5-minute stable session confirmed on device  
**Deliverable:** Demo-ready build on a shareable Vercel URL, working on the demo device, with a recorded demo video and pitch slide deck

---

## Table of Contents

1. [Objectives](#1-objectives)
2. [Daily Task Breakdown](#2-daily-task-breakdown)
3. [Implementation Order](#3-implementation-order)
4. [Prompt Tuning — Real Building](#4-prompt-tuning--real-building)
5. [Obstacle False Positive Reduction](#5-obstacle-false-positive-reduction)
6. [Goal Confidence Tuning](#6-goal-confidence-tuning)
7. [Landmark Memory](#7-landmark-memory)
8. [Onboarding Flow](#8-onboarding-flow)
9. [Demo Route Selection](#9-demo-route-selection)
10. [Demo Device Hardening](#10-demo-device-hardening)
11. [Final Deployment](#11-final-deployment)
12. [Demo Video](#12-demo-video)
13. [Pitch Slide Deck](#13-pitch-slide-deck)
14. [Demo Day Runbook](#14-demo-day-runbook)
15. [Week 4 Acceptance Tests](#15-week-4-acceptance-tests)
16. [Known Limitations to Disclose](#16-known-limitations-to-disclose)

---

## 1. Objectives

By end of Week 4:

- Prompt is tuned against the actual demo building — directions are accurate and useful in that specific environment
- Obstacle false positive rate is low enough that alarm fatigue does not occur during the demo
- Demo route is selected, rehearsed, and confirmed to work end-to-end at least 3 times
- Onboarding flow is clean — a first-time user can start navigating without explanation
- Demo video is recorded in the real building, 3 minutes maximum
- Pitch slide deck covers the problem, solution, architecture, and live demo plan
- Demo device is hardened — no notifications, no sleep, correct Chrome version, URL bookmarked
- A backup plan exists for every failure mode that could occur on demo day

Do not add new features this week. The only code changes allowed are prompt tuning, bug fixes discovered during demo rehearsal, and the onboarding flow. Everything else is out of scope.

---

## 2. Daily Task Breakdown

### Day 1 (Monday)
- First real building test session: walk the planned demo route with the app running
- Log every incorrect direction, missed obstacle, and false positive to a test log
- Identify the 3 most common prompt failures from the session
- Begin prompt tuning iteration 1

### Day 2 (Tuesday)
- Prompt tuning iteration 2 based on Day 1 log
- Second real building test session — same route
- Compare results against Day 1 log
- Implement onboarding flow

### Day 3 (Wednesday)
- Prompt tuning iteration 3 if needed
- Demo route finalized — document it precisely (start point, waypoints, destination)
- Full rehearsal: complete the demo route 3 times consecutively
- Record demo video

### Day 4 (Thursday)
- Demo device hardening (Section 10)
- Final Vercel deploy
- Pitch slide deck complete
- Rehearse the verbal demo presentation

### Day 5 (Friday)
- All Week 4 acceptance tests
- Final rehearsal on demo device using the deployed URL
- Demo day runbook printed or on a separate device
- Rest

---

## 3. Implementation Order

```
1. Real building test → test log
       ↓
2. Prompt tuning (iterative, 2-3 rounds)
       ↓
3. Onboarding flow
       ↓
4. Demo route finalized
       ↓
5. Demo device hardening
       ↓
6. Final deploy
       ↓
7. Demo video
       ↓
8. Pitch deck
       ↓
9. Runbook
```

---

## 4. Prompt Tuning — Real Building

### 4.1 Test log format

Create a file `prompt-tuning-log.md` and log every session. One row per observed failure:

```markdown
## Session 1 — [Date] — [Building/Location]

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | Long corridor, door at end | "Move forward" | "Move forward toward the double doors at the end of the corridor" | Too vague |
| 2 | Chair 0.5m away center | No obstacle reported | "Chair ahead — stop" | Missed obstacle |
| 3 | Person walking past | "Person on your left, stop immediately" | "Person passing on your left" | False high urgency |
```

Failure types:
- **Too vague** — direction is correct but not specific enough to be actionable
- **Missed obstacle** — obstacle present but not reported
- **False high urgency** — medium or low urgency reported as high
- **Wrong direction** — left/right/ahead incorrect
- **Goal false negative** — destination is visible but `goal_found=false`
- **Goal false positive** — destination not visible but `goal_found=true`
- **Repetition** — same direction despite context window

### 4.2 Prompt iteration process

After each session, identify the most common failure type and adjust the system prompt to address it. Change one thing at a time — do not rewrite the whole prompt between sessions.

Current system prompt is in `src/prompts/system.js` via `buildSystemPrompt('navigation')`. All tuning happens in that file.

### 4.3 Tuning for "too vague" directions

Add specificity requirements to the prompt:

```js
// Add to Rules section in buildSystemPrompt()
`- navigation_direction must reference a specific visible landmark when one exists.
  BAD: "Move forward."
  GOOD: "Move forward toward the elevator doors at the end of the corridor."
  BAD: "Turn left."
  GOOD: "Turn left at the fire extinguisher."`,
```

### 4.4 Tuning for missed obstacles

The model under-reports obstacles when they appear at the edges of the frame. Add:

```js
`- Scan the full width of the image for obstacles, not just the center.
  Report any object within approximately 2 metres on any part of the path ahead.`,
```

### 4.5 Tuning for false high urgency

The most common false positive is a person walking past being classified as high urgency. Add:

```js
`- urgency=high only for stationary objects directly blocking the path within 1 metre.
  Moving people passing to the side are urgency=medium at most.
  An open door, a wall, or the end of a corridor is not an obstacle.`,
```

### 4.6 Tuning for wrong left/right directions

Left/right errors occur because the model interprets the scene from a viewer perspective rather than the camera-holder's perspective. Add:

```js
`- All directions are from the perspective of the person holding the camera.
  Left means to their left hand side. Right means to their right hand side.
  Do not describe directions from a bird's-eye or third-person perspective.`,
```

### 4.7 Tuning for goal detection

When the goal is a door with a sign, the model sometimes misses it when the sign is small or at an angle. Add:

```js
`- For text-based goals (room numbers, named rooms), look for signage on doors and walls.
  Report goal_found=true if the sign is visible and readable, even if not fully centered.
  Report goal_confidence based on how clearly the sign matches the goal string.`,
```

### 4.8 Full tuned system prompt

Update `buildSystemPrompt()` in `src/prompts/system.js` with the accumulated tuning:

```js
export function buildSystemPrompt(mode = 'navigation') {
  const baseSchema = `{
  "obstacles": [
    {
      "type": string,
      "direction": string,  // "left" | "center" | "right"
      "urgency": "high" | "medium" | "low"
    }
  ],
  "navigation_direction": string,
  "goal_found": boolean,
  "goal_confidence": number
}`;

  const describeField = mode === 'describe'
    ? `  "scene_description": string,\n`
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
- navigation_direction: max 15 words, action-oriented, references a specific visible landmark when one exists.
  BAD: "Move forward." GOOD: "Move forward toward the elevator doors ahead."
  BAD: "Turn left." GOOD: "Turn left at the blue door."
- Use spatial words only: left, right, ahead, behind. Never compass directions.
- All directions are from the perspective of the person holding the camera.
  Left = their left hand. Right = their right hand. Not a viewer or third-person perspective.
- Scan the full width of the image for obstacles, not just center frame.
  Report any object within approximately 2 metres on the path ahead.
- urgency=high: stationary object directly blocking the path within 1 metre only.
- urgency=medium: object nearby but not immediately blocking, or person passing to the side.
- urgency=low: object far away or clearly off the path. Do not report unless notable.
- Moving people passing to the side are urgency=medium at most, never high.
- An open door, a wall at the end of a corridor, or a recessed doorway is not an obstacle.
- For text-based goals (room numbers, named rooms), look for signage on doors and walls.
  goal_found=true if the sign is visible and readable even if not fully centered.
  goal_confidence reflects how clearly the visible sign matches the goal string.
- If goal is not visible: goal_found=false, goal_confidence=0.
- If nothing is blocking and the path is clear, say so: "Path is clear, continue ahead."
- Do NOT include scene descriptions or commentary. Navigation output only.
- Return valid JSON only. Nothing else.`;
}
```

---

## 5. Obstacle False Positive Reduction

### 5.1 Remaining mitigation after prompt tuning

Prompt tuning reduces false positives but does not eliminate them. Two additional code-level mitigations:

**1. Direction filter:** If the same obstacle type is reported at high urgency in a single direction for 2 consecutive frames, suppress the second alert. This prevents a static misclassification from alerting twice.

```js
// obstacles.js — add module-level tracking
let lastHighAlert = { type: '', direction: '', firedAt: 0 };
const HIGH_ALERT_COOLDOWN_MS = 4000; // Don't fire same alert twice within 4 seconds

export function routeObstacles(obstacles) {
  if (!obstacles || obstacles.length === 0) return;

  const highUrgency = obstacles.find(o => o.urgency === 'high');
  if (highUrgency) {
    const now = Date.now();
    const isSameAlert =
      highUrgency.type === lastHighAlert.type &&
      highUrgency.direction === lastHighAlert.direction &&
      now - lastHighAlert.firedAt < HIGH_ALERT_COOLDOWN_MS;

    if (!isSameAlert) {
      speak(formatObstacleAlert(highUrgency), true);
      lastHighAlert = { type: highUrgency.type, direction: highUrgency.direction, firedAt: now };
    }
    return;
  }

  const medium = obstacles.find(o => o.urgency === 'medium');
  if (medium) {
    speak(formatObstacleAlert(medium), false);
  }
}

export function resetObstacles() {
  lastHighAlert = { type: '', direction: '', firedAt: 0 };
}
```

**2. Prompt specificity:** Already added in Section 4.5 — moving people are capped at medium urgency.

### 5.2 Acceptable false positive rate

For a demo, target: no more than 1 false high-urgency alert per minute of navigation on the planned demo route. Measure this in the Day 2 test session by counting alerts against video of the session.

---

## 6. Goal Confidence Tuning

### 6.1 Threshold verification

The current threshold is `goal_confidence >= 0.8` across 2 consecutive frames. Test this against the actual demo destination:

1. Walk to within 2 metres of the demo destination
2. Watch console logs for `result.goal_confidence` values
3. If confidence never reaches 0.8 for the destination, lower the threshold to 0.7

```js
// constants.js — adjust if needed after testing
export const GOAL_CONFIDENCE_THRESHOLD = 0.8; // Lower to 0.7 if demo destination is missed
```

### 6.2 Demo destination selection rules

Choose a destination that reliably produces `goal_confidence >= 0.8`:

| Destination type | Reliability | Notes |
|---|---|---|
| Illuminated exit sign | High | Bright, high contrast, distinctive shape |
| Elevator with large label | High | Distinctive doors, large buttons |
| Fire door with "FIRE EXIT" text | High | High contrast signage |
| Room with large door number | Medium | Works in good light, fails at angle |
| Named room with small sign | Low | Small text, angle-sensitive |
| Generic door with no sign | Very low | Model has nothing to match against |

### 6.3 Log confidence values during tuning sessions

Add a temporary console log in `goalTracker.js`:

```js
export function trackGoal(goalFound, goalConfidence) {
  console.debug(`goal_found: ${goalFound}, confidence: ${goalConfidence}`); // Remove before demo
  // ...
}
```

Run 3 passes in front of the destination and review confidence values. If they consistently land between 0.6 and 0.8, lower the threshold. If they are consistently above 0.9, the threshold is fine.

---

## 7. Landmark Memory

### 7.1 What it is

Landmark memory tells Claude what significant features the user has already passed. This improves direction quality for longer routes — Claude can say "Continue past the reception desk you passed earlier" rather than redescribing it.

### 7.2 Implementation

Add a `landmarks` array to app state, separate from `context`. Landmarks are extracted from `scene_description` when the describe mode is briefly activated, or extracted from navigation directions heuristically.

For MVP, use a simpler approach: extract landmark nouns from `navigation_direction` strings and append them to the user message:

```js
// src/modules/landmarks.js

const LANDMARK_KEYWORDS = [
  'door', 'elevator', 'stairs', 'staircase', 'reception', 'desk',
  'corridor', 'hallway', 'sign', 'exit', 'entrance', 'lobby',
  'window', 'counter', 'pillar', 'column', 'junction', 'corner',
];

let landmarks = [];
const MAX_LANDMARKS = 5;

/**
 * Extract landmark nouns from a navigation direction string and store them.
 * @param {string} direction
 */
export function extractLandmarks(direction) {
  const words = direction.toLowerCase().split(/\s+/);
  const found = LANDMARK_KEYWORDS.filter(k => words.some(w => w.includes(k)));
  if (found.length > 0) {
    // Add new landmarks, avoid duplicates, cap at MAX_LANDMARKS
    const newLandmarks = [...new Set([...landmarks, ...found])].slice(-MAX_LANDMARKS);
    landmarks = newLandmarks;
  }
}

/**
 * Get landmarks as a formatted string for the prompt.
 * @returns {string}
 */
export function getLandmarkContext() {
  if (landmarks.length === 0) return '';
  return `Landmarks already passed: ${landmarks.join(', ')}.`;
}

/**
 * Reset landmarks. Call at session start.
 */
export function resetLandmarks() {
  landmarks = [];
}
```

### 7.3 Wire into buildUserMessage

```js
// src/api/claude.js
import { getLandmarkContext } from '../modules/landmarks.js';

export function buildUserMessage(goal, context, base64Frame) {
  const contextText = context.length > 0
    ? `Prior directions: ${context.join(' → ')}`
    : 'No prior context.';

  const landmarkText = getLandmarkContext();

  const textParts = [
    `Goal: ${goal}`,
    contextText,
    landmarkText,
    'Analyze this frame.',
  ].filter(Boolean).join('\n');

  return {
    role: 'user',
    content: [
      { type: 'text', text: textParts },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64Frame },
      },
    ],
  };
}
```

### 7.4 Wire into loop.js

```js
// loop.js — after speaking the direction
import { extractLandmarks, resetLandmarks } from './landmarks.js';

if (result.navigation_direction) {
  speak(result.navigation_direction);
  callbacks.onSpeak(result.navigation_direction);
  callbacks.onContextUpdate(result.navigation_direction);
  extractLandmarks(result.navigation_direction); // Add to landmark memory
}
```

```js
// loop.js — in startLoop(), before startLoop begins
resetLandmarks(); // Clear for new session
```

### 7.5 Verify landmark memory

After 2-3 minutes of navigation, log `getLandmarkContext()` to console. It should read something like:

```
Landmarks already passed: corridor, door, elevator.
```

If the landmark list is empty after several directions, add temporary logging inside `extractLandmarks()` to check whether direction strings contain the expected keywords.

---

## 8. Onboarding Flow

### 8.1 What it is

A first-time user picks up the phone and needs to understand what to do without reading anything or being told verbally. The onboarding flow guides them through the two required steps: setting a goal, and starting navigation.

### 8.2 Onboarding states

```
first_visit → shows onboarding hints
returning_visit → shows normal UI (hints hidden)
```

Track first visit with `sessionStorage` (not `localStorage` — reset each browser session is correct behavior):

```js
// App.jsx
const isFirstVisit = !sessionStorage.getItem('vg_visited');
if (isFirstVisit) sessionStorage.setItem('vg_visited', '1');
```

### 8.3 Onboarding component

```jsx
// src/components/Onboarding.jsx

export default function Onboarding({ onDismiss }) {
  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to VisionGuide"
    >
      <div style={styles.card}>
        <h2 style={styles.title}>Welcome to VisionGuide</h2>
        <p style={styles.body}>
          VisionGuide listens to your camera and speaks directions to help you navigate indoors.
        </p>
        <ol style={styles.steps}>
          <li>Type or speak where you want to go</li>
          <li>Tap Start Navigation</li>
          <li>Hold your phone in front of you at chest height</li>
          <li>Follow the spoken directions</li>
        </ol>
        <div style={styles.warning}>
          Keep using your white cane or mobility aid at all times.
        </div>
        <button
          onClick={onDismiss}
          autoFocus
          style={styles.button}
          aria-label="Got it, start using VisionGuide"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '24px',
  },
  card: {
    background: '#1a1a1a',
    borderRadius: '12px',
    padding: '28px 24px',
    maxWidth: '400px',
    width: '100%',
    border: '1px solid #333',
  },
  title: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    marginBottom: '12px',
  },
  body: {
    color: '#aaa',
    fontSize: '15px',
    lineHeight: '1.6',
    marginBottom: '16px',
  },
  steps: {
    color: '#ffffff',
    fontSize: '16px',
    lineHeight: '2',
    paddingLeft: '20px',
    marginBottom: '20px',
  },
  warning: {
    background: '#2a1500',
    border: '1px solid #b84c00',
    borderRadius: '8px',
    padding: '12px 16px',
    color: '#f97316',
    fontSize: '14px',
    marginBottom: '20px',
    lineHeight: '1.5',
  },
  button: {
    width: '100%',
    minHeight: '56px',
    background: '#1a4fd6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: '700',
    cursor: 'pointer',
  },
};
```

### 8.4 Wire into App.jsx

```jsx
// App.jsx
import Onboarding from './components/Onboarding.jsx';

const [showOnboarding, setShowOnboarding] = useState(
  !sessionStorage.getItem('vg_visited')
);

const handleOnboardingDismiss = () => {
  sessionStorage.setItem('vg_visited', '1');
  setShowOnboarding(false);
  // Speak the onboarding summary for screen reader users
  speak('Welcome to VisionGuide. Type or speak your destination, then tap Start Navigation.');
};

// In the JSX return:
{showOnboarding && <Onboarding onDismiss={handleOnboardingDismiss} />}
```

### 8.5 Phone holding instruction

The most common demo failure is the user holding the phone at the wrong angle — pointing down at the floor or up at the ceiling. Add a spoken instruction when navigation starts:

```js
// App.jsx — handleStart(), after safety prompt onend fires
// Add before startLoop():
speak('Hold your phone at chest height, pointing forward.');
// Then after a short delay:
setTimeout(() => {
  startLoop(videoRef.current, streamRef, loopStateRef, { ... });
}, 2500); // Wait for holding instruction to finish
```

---

## 9. Demo Route Selection

### 9.1 Route requirements

The demo route must satisfy all of these:

- Start point is easy to find (building entrance, lobby, a specific door)
- At least one turn
- At least one obstacle opportunity (a chair, a desk, a bin — something that can be placed deliberately)
- Destination is high-contrast and visually distinct (elevator, illuminated exit, large numbered door)
- Total walking distance: 20-50 metres
- Can be completed in under 90 seconds at a deliberate pace

### 9.2 Route documentation

Document the route precisely so it can be reproduced consistently on demo day:

```markdown
## Demo Route — [Building Name]

**Start:** Main lobby entrance doors, standing 1 metre inside facing the corridor

**Waypoints:**
1. Walk forward ~10 metres along the main corridor
2. Turn left at the fire extinguisher
3. Walk forward ~8 metres to the elevator bank

**Destination:** Elevator — left bank, ground floor (large silver doors with illuminated button panel)

**Obstacle placement:** One chair placed 3 metres from start, center of corridor

**Expected duration:** ~60 seconds at deliberate pace

**Known issues:**
- Lighting is dim at waypoint 2 — Claude may miss the fire extinguisher landmark
- Elevator confidence spikes to >0.9 only when within 2 metres of the doors
```

### 9.3 Rehearsal protocol

Run the route 3 times consecutively before recording the demo video:

- Run 1: note any direction errors, goal detection failures, false obstacle alerts
- Run 2: verify prompt tuning from Run 1 observations has been applied
- Run 3: clean run for confidence — this is the baseline for the demo

### 9.4 Backup destination

Identify a backup destination on the same route in case goal detection fails for the primary destination on demo day. The backup should be within sight of the primary (e.g., if the elevator fails to detect, the "EXIT" sign above the elevator doors is the backup).

---

## 10. Demo Device Hardening

### 10.1 Phone setup checklist

Complete all of these before demo day. Do not do them on demo day morning — do them the day before and verify.

```
[ ] Chrome version confirmed: chrome://version must show 120 or higher
[ ] All Chrome notifications disabled: Settings > Notifications > Chrome > Off
[ ] Do Not Disturb enabled for demo duration
[ ] Phone calls forwarded or SIM removed if possible
[ ] Screen timeout set to Never (or maximum available): Settings > Display > Screen timeout
[ ] Auto-brightness disabled, brightness set to maximum
[ ] VisionGuide URL bookmarked and set as Chrome home page
[ ] Demo URL tested over WiFi at the demo venue (not just local network)
[ ] Backup: URL also accessible over mobile data in case venue WiFi fails
[ ] Phone charged to 100% night before
[ ] Portable charger available on demo day
[ ] Phone case removed if it obscures the rear camera
[ ] Camera lens cleaned
[ ] TalkBack disabled (it interferes with Web Speech API on some Android builds)
[ ] Volume set to maximum
[ ] Bluetooth headset available as backup audio output if phone speaker is too quiet in a noisy venue
```

### 10.2 Chrome flags to verify

Open `chrome://flags` on the device and confirm these are default (not disabled):

- `#enable-web-speech` — must be Default or Enabled
- `#enable-experimental-web-platform-features` — Default is fine

### 10.3 Network test at venue

At least one day before the demo, visit the venue and test the app on the venue WiFi:

```
[ ] App loads at Vercel URL
[ ] Camera permission prompt appears and can be granted
[ ] Single manual Claude call returns a response (check console)
[ ] TTS plays through phone speaker
[ ] API response time measured — note the p50 latency from venue WiFi
```

If venue WiFi is unreliable, set up a phone hotspot from a second device as the primary network for the demo.

---

## 11. Final Deployment

### 11.1 Pre-deploy checklist

```
[ ] All console.debug and console.log calls removed or gated behind a DEV flag
[ ] Temporary test code removed (artificial delays, hardcoded goals, error injection)
[ ] STALE_FRAME_MS is 4500 in constants.js
[ ] OBSTACLE_CONFIRM_FRAMES is not present (removed in Week 3)
[ ] max_tokens is 500 in claude.js
[ ] buildSystemPrompt() returns the final tuned prompt
[ ] .env is in .gitignore and not committed
[ ] VITE_ANTHROPIC_API_KEY is the demo key with $5 spend limit set in Anthropic console
[ ] package.json version bumped to 1.0.0
```

### 11.2 Remove debug logging

Replace any remaining `console.debug` calls with a single dev flag:

```js
// src/constants.js
export const DEV_MODE = false; // Set to true locally for debugging

// Usage:
if (DEV_MODE) console.debug('Stale frame dropped:', age, 'ms');
```

### 11.3 Deploy command

```bash
# Final production deploy
npm run build
vercel --prod

# Verify the deployed URL immediately after deploy
# Open on the demo device and run through the demo route once
```

### 11.4 Post-deploy smoke test

After deploying, run through this sequence on the demo device using the Vercel URL:

```
[ ] Page loads without errors (check DevTools console via remote debug)
[ ] Onboarding appears on first visit
[ ] Camera permission granted, stream starts
[ ] Goal typed, Start tapped, safety prompt plays
[ ] Navigation directions spoken within 4 seconds
[ ] Stop button stops the loop
[ ] Demo route completed end-to-end
```

---

## 12. Demo Video

### 12.1 Requirements

- Maximum 3 minutes
- Shot in the real demo building, on the real demo route
- Audio from phone speaker must be audible on the recording
- No editing required — single continuous take preferred
- Record at least 3 takes, use the cleanest one

### 12.2 Shot setup

```
Camera person: walks alongside the demo user, 1-2 metres away
Angle: side-on, showing both the phone screen and the environment ahead
Audio: record on a second phone held close to the demo device speaker, or use a lapel mic
Lighting: ensure corridor is well lit — dim lighting degrades Claude's scene analysis
```

### 12.3 Script

Do not use a word-for-word script. Use this outline:

```
0:00 - 0:20  Problem statement spoken aloud: "Navigating an unfamiliar building
              is difficult without sight. GPS doesn't work indoors.
              VisionGuide uses AI vision to guide you in real time."

0:20 - 0:30  Show the app UI — type the destination, tap Start

0:30 - 2:30  Walk the demo route. Let the spoken directions play naturally.
              Point the camera at the obstacle — let the obstacle alert fire.
              Walk to the destination — let the arrival announcement play.

2:30 - 3:00  Closing: "No special hardware. No pre-mapped building.
              Just a phone and AI."
```

### 12.4 What to show on screen

During the demo recording, keep the phone's screen visible in the recording. The status display and last-spoken text reinforce what the audio is saying for viewers who may be watching on mute.

---

## 13. Pitch Slide Deck

### 13.1 Slide structure

**Slide 1 — Problem (1 slide)**
- 285 million people are visually impaired worldwide
- GPS does not work indoors
- Existing solutions require building-specific infrastructure (BLE beacons, pre-mapped floor plans)
- No scalable, infrastructure-free solution exists

**Slide 2 — Solution (1 slide)**
- VisionGuide: AI-powered indoor navigation using only a smartphone camera
- Real-time spoken directions, obstacle alerts, goal detection
- Works in any building, on first visit, with no pre-installation

**Slide 3 — How it works (1 slide)**
- Simple two-step architecture diagram: Browser → Claude Vision API
- 1 fps frame capture → Claude analyzes scene → spoken direction
- Key stat: ~3 second latency, $0.003 per API call

**Slide 4 — Demo (1 slide or live)**
- Play demo video OR run live demo
- Call out: obstacle detection alert, navigation direction, arrival announcement

**Slide 5 — Architecture (1 slide)**
- Vite + React PWA
- Direct browser → Anthropic API (no backend)
- Web Speech API for TTS and voice input
- Chrome on Android

**Slide 6 — Limitations & Roadmap (1 slide)**
- Honest: ~3-5s latency, 1fps, supplement not replacement for mobility aids
- Roadmap: multi-floor navigation, offline on-device model, iOS support, BLE landmark anchoring

**Slide 7 — Team (1 slide)**
- Names, roles

### 13.2 Slide design rules

- Black background, white text — mirrors the app aesthetic
- No bullet point walls — maximum 4 points per slide
- Architecture diagram from the PRD on slide 5 (export the SVG from the PRD HTML)
- Font size minimum 24px — must be readable projected on a large screen

---

## 14. Demo Day Runbook

Print this or keep it on a separate device. Do not rely on memory under pressure.

### 14.1 Setup (T-30 minutes)

```
[ ] Confirm venue WiFi SSID and password
[ ] Connect demo device to venue WiFi — confirm API call succeeds
[ ] Open VisionGuide URL in Chrome on demo device
[ ] Dismiss onboarding (already visited)
[ ] Set volume to maximum
[ ] Confirm Do Not Disturb is on
[ ] Charge to 100%
[ ] Walk the demo route once with app running — confirm it still works in this environment
[ ] Note current API latency from console (venue WiFi may differ from dev environment)
```

### 14.2 Demo sequence

```
Step 1: Open VisionGuide in Chrome on demo device
Step 2: Show audience the UI — "One input, one button"
Step 3: Speak or type the destination: "[demo destination]"
Step 4: Tap Start Navigation
Step 5: Safety prompt plays — wait for it to finish
Step 6: Walk the route — let directions play naturally, do not narrate over them
Step 7: Approach the planted obstacle — let alert fire
Step 8: Continue to destination — let arrival announcement play
Step 9: Tap Stop
```

### 14.3 Failure contingencies

| Failure | Immediate action |
|---|---|
| Camera permission denied | Open Chrome Settings > Site Settings > Camera > Allow for this site |
| No speech output | Check volume. Check headset is not connected. Reload page. |
| "Still scanning" on every cycle | API latency too high on venue WiFi. Switch to mobile hotspot. |
| App crashes / blank screen | Reload the Vercel URL. Session state is lost — re-enter goal. |
| Goal never detected | Walk closer to the destination. Destination under 2 metres works best. |
| Obstacle not alerted | Reposition obstacle to be more centered in frame. |
| Vercel URL unreachable | Run `npm run dev` on a laptop, connect demo device to laptop hotspot, use `http://[laptop-ip]:5173` |

### 14.4 Backup device

Have a second phone with the app pre-loaded at the Vercel URL, camera tested, and volume set. If the primary device fails in any unrecoverable way, hand-off to the backup device takes under 30 seconds.

---

## 15. Week 4 Acceptance Tests

### AT-W4-01: Tuned prompt — direction specificity
- Walk the demo route
- **Pass:** At least 80% of navigation directions reference a specific visible landmark, not just "move forward" or "turn left"

### AT-W4-02: False positive rate
- Walk the demo route without any deliberate obstacles
- **Pass:** Zero high-urgency obstacle alerts fire during a clean route walk

### AT-W4-03: Obstacle detection
- Place an obstacle (chair, box) directly in the center of the path
- **Pass:** High-urgency alert fires within 4 seconds of the obstacle entering the frame

### AT-W4-04: Goal detection — demo destination
- Walk to the demo destination
- **Pass:** Arrival announced within 2 metres of the destination on at least 3 out of 3 consecutive test runs

### AT-W4-05: Landmark memory active
- Walk for 3+ minutes
- Check console log of `getLandmarkContext()`
- **Pass:** At least 2 landmarks extracted and present in the context string

### AT-W4-06: Onboarding appears on first visit
- Clear `sessionStorage` in DevTools, reload page
- **Pass:** Onboarding overlay appears, "Got it" button is auto-focused, TalkBack announces "Welcome to VisionGuide"

### AT-W4-07: Onboarding does not appear on returning visit
- After dismissing onboarding, reload page
- **Pass:** Onboarding does not appear

### AT-W4-08: Phone holding instruction plays
- Tap Start
- **Pass:** "Hold your phone at chest height, pointing forward" is spoken after the safety prompt and before the first navigation direction

### AT-W4-09: No debug logs in production build
- Open `chrome://inspect`, connect to the Vercel URL on device
- **Pass:** No `console.debug` or test-related `console.log` output during normal navigation

### AT-W4-10: Full demo route end-to-end
- Complete the full documented demo route 3 times consecutively
- **Pass:** All 3 runs complete without manual intervention, arrival announced each time

### AT-W4-11: Demo video exists
- **Pass:** A clean recording of AT-W4-10 exists, under 3 minutes, with audible speech output

### AT-W4-12: Deployed URL functional on demo device over venue WiFi
- **Pass:** Full demo route completed using the Vercel URL on venue WiFi

---

## 16. Known Limitations to Disclose

Disclose these proactively in the pitch. Do not wait to be asked.

**Latency:** ~3-5 seconds frame-to-speech. At normal walking speed, the user has moved 4-7 metres between frame capture and audio output. VisionGuide is designed for deliberate, cautious movement — not normal walking pace. Users should continue using their primary mobility aid.

**1 fps capture rate:** The system takes one snapshot per second. Fast-moving obstacles (a running person, a swinging door) may not be captured in the frame that shows the hazard.

**Cloud dependency:** Requires an active internet connection with sufficient bandwidth. Offline operation is not supported.

**No floor maps:** The system has no knowledge of the building's layout. It can only see what the camera currently shows. It cannot plan a multi-step route.

**Hallucination risk:** Claude Vision is a probabilistic model. It will occasionally report incorrect directions or miss obstacles. It is a navigation supplement, not a replacement for a white cane or guide dog.

**Android Chrome only:** iOS Safari and non-Chrome browsers are not supported in this MVP due to Web Speech API inconsistencies.

**Single-user:** The system is designed for one user on one device. No multi-user or shared session support.
