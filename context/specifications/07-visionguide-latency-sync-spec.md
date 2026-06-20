# VisionGuide — Latency, Staleness & Speech Sync Spec

## Purpose

User-reported issues, all tracing back to the per-frame Claude round-trip
(~4-5s) sitting on the critical path of every spoken update:

1. Directions sometimes reference an object that was in view on an old frame
   but isn't there anymore.
2. Once the destination leaves the camera frame, the app has no memory of
   where it was and can't guide the user back toward it.
3. The app feels high-latency overall, and arrival recognition in particular
   lags by several seconds after the user has actually arrived.
4. The on-screen "Navigation" text updates faster than the matching speech,
   so the two are visibly out of sync.
5. Speech alerts sometimes get spoken too close together / cut into each
   other.

None of these require touching the camera capture itself (`src/modules/camera.js`
already captures a small 640x480 @ 0.7-quality JPEG — image size isn't the
bottleneck, the Claude API round-trip is).

---

## Scope

### Changes required
- `src/modules/loop.js` — stale-frame guard extended to scan/explore phases, goal-sighting recording, per-phase model selection, `onStart`-based speak callbacks at every call site
- `src/modules/goalMemory.js` — new module
- `src/api/claude.js` — `callClaude` takes a `model` param; `buildUserMessage` includes the goal-memory hint
- `src/modules/goalTracker.js` — high-confidence fast-path arrival confirmation
- `src/modules/speech.js` — `speak()` takes an `onStart` callback; interrupt path no longer cuts in with zero gap; faster default TTS rate
- `src/constants.js` — `SCAN_MODEL`, `NAVIGATE_MODEL`, `GOAL_FAST_CONFIRM_CONFIDENCE`
- `src/prompts/system.js` — shorter `navigation_direction` word cap, new rule for using the goal-memory hint

### Explicitly out of scope
- `src/modules/camera.js` — frame resolution/quality unchanged; not the bottleneck.
- `src/modules/obstacles.js` — obstacle routing/cooldown logic unchanged. Obstacles continue to be routed regardless of frame staleness (a hazard is still actionable even on a slightly late frame); only `navigation_direction`/goal data is staleness-gated.
- `GOAL_CONFIRM_FRAMES`/`GOAL_CONFIDENCE_THRESHOLD` defaults — unchanged. The fast-path is additive, not a replacement.
- No changes to `App.jsx` — `handleSpeak` still just does `setLastSpoken(text)`; it's invoked at a different time, not a different way.
- No user-facing TTS rate/voice configurability — `TTS_CONFIG.rate` is a hardcoded constant change, not a new settings surface (see PRD "Configurable TTS Voice and Speed", still deferred).

---

## 1. Stale-frame guard for scan/explore (`src/modules/loop.js`)

`navigate` phase already drops `navigation_direction`/goal data when
`Date.now() - capturedAt > STALE_FRAME_MS` (4.5s). `scan`/`explore` had no
equivalent check, so a direction computed from an already-stale frame could
still be spoken — the most direct cause of directions referencing objects
that are no longer there.

```js
if (phase === 'scan' || phase === 'explore') {
  const isStale = Date.now() - capturedAt > STALE_FRAME_MS;
  const foundGoal = !isStale && result.navigation_direction && result.goal_confidence >= SCAN_MIN_CONFIDENCE;

  if (foundGoal) {
    // ... existing phase transition to 'navigate', unchanged
  }

  if (result.obstacles?.length > 0) {
    routeObstacles(result.obstacles); // still routed regardless of staleness
  }

  if (phase === 'explore' && result.navigation_direction && !isStale) {
    speak(result.navigation_direction, false, () => callbacks.onSpeak(result.navigation_direction));
    callbacks.onContextUpdate(result.navigation_direction);
  }
  return;
}
```

`isStale` gates both the scan→navigate transition and the explore-phase
guidance speak; obstacle routing is unaffected, consistent with how
navigate phase already treats obstacles vs. navigation data.

---

## 2. Destination memory (`src/modules/goalMemory.js` — new)

```js
const GOAL_MEMORY_MS = 30_000;

let lastSighting = null; // { direction, capturedAt }

export function recordGoalSighting(direction, capturedAt = Date.now()) {
  if (!direction) return;
  lastSighting = { direction, capturedAt };
}

export function getGoalMemoryHint() {
  if (!lastSighting || Date.now() - lastSighting.capturedAt > GOAL_MEMORY_MS) return '';
  return `Destination last seen: ${lastSighting.direction}. If not visible now, guide the user back toward that direction.`;
}

export function resetGoalMemory() {
  lastSighting = null;
}
```

- `loop.js` (`navigate` phase): after a tick where `result.goal_found` is
  true with `result.goal_confidence >= SCAN_MIN_CONFIDENCE`, calls
  `recordGoalSighting(result.navigation_direction)`. `resetGoalMemory()` is
  called in `startLoop()` alongside `resetObstacles()`/`resetGoalTracker()`/
  `resetLandmarks()`.
- `api/claude.js` (`buildUserMessage`): splices `getGoalMemoryHint()` into
  the prompt text, same pattern as `getLandmarkContext()`.
- `prompts/system.js` (`buildSystemPrompt('navigation')`): new rule —
  "If a 'Destination last seen' hint is provided and the goal is not visible
  in this frame, route the user back toward that last-known direction
  rather than treating the goal as lost."
- Sightings expire after `GOAL_MEMORY_MS` (30s) — old enough to survive a
  brief look-away, not so old it guides the user toward a now-irrelevant
  direction if they've moved on.

---

## 3. Faster navigate-phase model + arrival fast-path

### Model selection (`constants.js`, `api/claude.js`, `loop.js`)

```js
// constants.js
export const SCAN_MODEL     = 'claude-sonnet-4-6';
export const NAVIGATE_MODEL = 'claude-haiku-4-5-20251001';
```

`callClaude(systemPrompt, messages, signal, model = 'claude-sonnet-4-6')` —
now takes the model as a parameter instead of hardcoding Sonnet. `loop.js`
passes `phase === 'navigate' ? NAVIGATE_MODEL : SCAN_MODEL`.

Rationale: `scan`/`explore` need Sonnet's stronger signage-reading to find
the goal in the first place; once found, `navigate` phase polls at up to
1fps doing lower-stakes "keep going / obstacle ahead" judgments where
Haiku's lower latency matters more than marginal accuracy.

### Arrival fast-path (`goalTracker.js`)

```js
export function trackGoal(goalFound, goalConfidence) {
  if (goalFound === true && goalConfidence >= GOAL_CONFIDENCE_THRESHOLD) {
    if (goalConfidence >= GOAL_FAST_CONFIRM_CONFIDENCE) {
      consecutiveFoundCount = 0;
      return true; // skip the 2nd confirm frame on a very confident first read
    }
    consecutiveFoundCount++;
    return consecutiveFoundCount >= GOAL_CONFIRM_FRAMES;
  }
  consecutiveFoundCount = 0;
  return false;
}
```

`GOAL_FAST_CONFIRM_CONFIDENCE = 0.95`. The existing 2-frame confirmation
(`GOAL_CONFIRM_FRAMES = 2`) remains the fallback for confidence in
`[GOAL_CONFIDENCE_THRESHOLD, GOAL_FAST_CONFIRM_CONFIDENCE)` — ambiguous
reads still get the false-positive guard; unambiguous ones announce arrival
roughly one round-trip sooner.

---

## 4. Text/speech sync (`speech.js`, `loop.js`)

`speak(text, interrupt = false, onStart)` — when provided, `onStart` is
attached as `utterance.onstart`, firing only when the browser actually
begins playing that utterance (not when it's enqueued).

Every `loop.js` call site changed from:
```js
speak(text);
callbacks.onSpeak(text);
```
to:
```js
speak(text, interrupt, () => callbacks.onSpeak(text));
```
so the on-screen text (`StatusDisplay`'s `lastSpoken`, driven by
`callbacks.onSpeak`) updates exactly when the matching audio starts, not
before. `callbacks.onContextUpdate` (feeds the next prompt's context) is
unaffected — it still fires synchronously, since the model's context
doesn't need to wait on TTS playback.

---

## 5. Interrupt-path alert spacing (`speech.js`)

Normal (non-interrupt) queueing already waits for an utterance to finish +
`QUEUE_PAUSE_MS` (400ms) before playing the next. The `interrupt=true` path
(used for high-urgency obstacles and the arrival announcement) previously
called `cancel()` then `processQueue()` immediately — zero gap, which made
back-to-back alerts feel like they collided.

```js
if (interrupt) {
  const wasSpeaking = window.speechSynthesis.speaking;
  cancel();
  speechQueue.push(utterance);
  if (wasSpeaking) {
    isProcessingQueue = true;
    setTimeout(() => {
      isProcessingQueue = false;
      processQueue();
    }, QUEUE_PAUSE_MS);
  } else {
    processQueue();
  }
} else {
  speechQueue.push(utterance);
  processQueue();
}
```

If nothing was playing, the interrupting utterance still starts
immediately (no reason to delay the first/only alert) — the pause only
applies when cutting off active speech.

---

## 6. Shorter, faster speech (`prompts/system.js`, `speech.js`)

Doesn't touch API round-trip latency, but reduces how long each utterance
occupies the queue — fewer interrupt collisions, less time for displayed
text to drift ahead of audio before the next update.

- `buildSystemPrompt`'s rules: `navigation_direction` word cap `15` → `8-10`.
- `TTS_CONFIG.rate`: `1.05` → `1.15`.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Destination briefly leaves frame (<30s), then comes back into view | Guidance references the last-known direction while out of view; re-acquires normally once visible again |
| Destination leaves frame and user keeps walking for >30s | Goal-memory hint expires; behaves as before (no hint), Claude must re-find it from scratch |
| Scan/explore frame is stale (>4.5s old) and would have reported the goal found | Goal/direction data dropped for that frame, no phase transition; obstacles in the frame are still routed |
| Goal confidence lands exactly at `GOAL_FAST_CONFIRM_CONFIDENCE` (0.95) | Fast-path triggers (>= comparison), arrival confirmed on first frame |
| Goal confidence is e.g. 0.85 (above threshold, below fast-path) | Falls back to existing 2-frame confirmation, unchanged |
| High-urgency obstacle interrupts mid-navigation-direction speech | New utterance plays after a `QUEUE_PAUSE_MS` gap instead of cutting in instantly |
| High-urgency obstacle fires when nothing else is speaking | Plays immediately, no added delay |
| Network/API failure on a `navigate`-phase tick | Unaffected by model change — `claude.js`'s existing error-path handling (`network_failure`/`rate_limited`/`api_error_*`) is untouched |

---

## Acceptance Tests

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-LAT-01 | Scan or explore phase, simulate a slow API response (>4.5s) | Observe spoken output | No navigation_direction spoken for that stale frame; any obstacles in it are still announced |
| AT-LAT-02 | Navigate phase, destination visible | Turn camera away from destination, then back within ~10s | Guidance keeps pointing toward the last-known direction while away; re-acquires once visible again |
| AT-LAT-03 | Navigate phase, destination visible | Turn camera away for >30s | After 30s, no last-known hint is used; behavior matches pre-fix (Claude re-finds from scratch) |
| AT-LAT-04 | Navigate phase running | Reach the destination with a clearly unambiguous, close-up view | "Arrived" is announced after one confirming frame, not two |
| AT-LAT-05 | Navigate phase running | Reach the destination with an ambiguous/partial view (confidence between threshold and fast-path) | Existing 2-frame confirmation still applies, no false-positive regression |
| AT-LAT-06 | Any phase, speech playing | Watch `StatusDisplay` text vs. audio | Text updates in lockstep with audio start, not before |
| AT-LAT-07 | Navigate phase, a direction is mid-speech | A high-urgency obstacle appears | Obstacle alert interrupts after a short pause, not an instant cut-in |
| AT-LAT-08 | Any phase | Nothing is currently speaking | A new high-urgency alert plays immediately, no added delay |

---

## Definition of Done

- All AT-LAT-01–08 pass on-device.
- `npm run build` and `npm run lint` pass clean.
- No regression to existing scan → explore → navigate loop behavior or
  obstacle handling (`05-visionguide-scan-phase-spec.md` acceptance tests
  still pass).
- `06-visionguide-destination-extraction-spec.md` behavior (raw-phrase
  cleanup) unaffected — `extractDestination` is unchanged.
