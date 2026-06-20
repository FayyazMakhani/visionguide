# VisionGuide — Destination Extraction Spec

## Purpose

When a user gives a navigation command, the app previously used the entire raw phrase as the destination. For a command like "take me to the bathroom", every navigation message echoed the full sentence back, e.g. "I'll guide you through the building to find take me to the bathroom" instead of "...find the bathroom".

The fix cannot be a fixed set of command templates ("take me to X", "go to X") — users may phrase the destination any way at all, including indirect descriptions of a need rather than a place ("I need to wash my hands", "there's a meeting in room 204, get me there", "where's the nearest exit"). This requires language understanding, not pattern matching, so the destination is resolved via a Claude text-only call rather than a regex.

---

## Scope

### Changes required
- `src/prompts/system.js` — new `buildDestinationExtractionPrompt()`
- `src/api/claude.js` — new `buildDestinationMessage(rawGoal)`
- `src/modules/destination.js` — new module, `extractDestination(rawGoal)`
- `src/App.jsx` — `handleStart` calls `extractDestination` once before navigation starts

### Explicitly out of scope
- `GoalInput.jsx` is unchanged — it still stores and displays the user's raw input (typed or spoken) until Start is tapped. No per-keystroke or per-voice-result extraction.
- `loop.js`, `goalTracker.js`, `prompts/system.js`'s existing `buildScanPrompt`/`buildExplorePrompt`, and `api/claude.js`'s `buildUserMessage` are unchanged — they already consume `goal` from `App.jsx` state and automatically receive the cleaned value once it's set there.
- No new loading/status UI for the extraction call.
- No backend/proxy changes — extraction reuses the existing direct-from-browser Claude call pattern already used for vision frames.

---

## New Prompt (`prompts/system.js`)

### `buildDestinationExtractionPrompt()`

```
You extract a navigation destination from what a visually impaired user said or typed.
The input may be a direct command ("take me to the bathroom"), a question ("where's the
nearest exit?"), or an indirect description of a need ("I need to wash my hands", "there's
a meeting in room 204, get me there").

Return ONLY valid JSON, no preamble, no markdown:
{
  "destination": string
}

Rules:
- destination should be a short noun phrase naming the place, e.g. "the bathroom", "room 204", "the nearest exit".
- Infer the implied place for indirect descriptions (e.g. "wash my hands" -> "the bathroom" or "a sink").
- If the input is already just a destination with no extra phrasing, return it unchanged.
- If no destination can be identified at all, return the original input unchanged in destination.
- Never return an empty string.
```

---

## New Message Builder (`api/claude.js`)

### `buildDestinationMessage(rawGoal)`

A text-only Anthropic user message (no image block), used in place of `buildUserMessage` for this one extraction call:

```js
export function buildDestinationMessage(rawGoal) {
  return {
    role: 'user',
    content: [{ type: 'text', text: rawGoal }],
  };
}
```

`callClaude(systemPrompt, messages)` required no changes — it has no image-specific logic in the request body, and already parses the response as JSON.

---

## New Module: `modules/destination.js`

### `extractDestination(rawGoal)`

```js
export async function extractDestination(rawGoal) {
  const trimmed = rawGoal.trim();
  if (!trimmed) return trimmed;

  try {
    const result = await callClaude(
      buildDestinationExtractionPrompt(),
      [buildDestinationMessage(trimmed)]
    );
    const destination = typeof result.destination === 'string' ? result.destination.trim() : '';
    return destination || trimmed;
  } catch (err) {
    console.warn('Destination extraction failed, using raw input:', err.message);
    return trimmed;
  }
}
```

### Fallback behavior
- Empty/whitespace-only input returns immediately without calling Claude.
- Network/rate-limit/API errors are caught and the trimmed raw input is returned unchanged — navigation still proceeds, just without cleanup.
- `callClaude`'s existing JSON-parse-failure fallback returns a vision-shaped default object with no `destination` field; this is treated as "extraction failed" and falls back to the raw input.

---

## Modified: `App.jsx`

`handleStart` now extracts once, before camera init and the navigation start sequence:

```js
const handleStart = useCallback(async () => {
  if (!goal.trim()) return;
  if (status === 'navigating') return;

  const cleanedGoal = await extractDestination(goal);
  if (cleanedGoal !== goal) {
    setGoal(cleanedGoal);
    loopStateRef.current = { ...loopStateRef.current, goal: cleanedGoal };
  }

  // Initialize camera if not already running
  ...
```

`loopStateRef.current` is updated explicitly (in addition to `setGoal`) because the deferred `startLoop` call inside `startNavigating`'s `setTimeout` reads `loopStateRef` directly — the explicit update removes any dependency on the `useEffect` sync timing.

---

## Edge Cases

| Input | Result |
|---|---|
| `"take me to the bathroom"` | `"the bathroom"` |
| `"I need to wash my hands"` | inferred place, e.g. `"the bathroom"` |
| `"where's the nearest exit?"` | `"the nearest exit"` |
| `"room 204"` (already clean) | unchanged |
| `""` / whitespace-only | unchanged, never calls Claude (guarded by existing `!goal.trim()` check in `handleStart`) |
| Extraction API failure (network/429/5xx) | falls back to raw trimmed input, navigation still starts |
| Malformed JSON from Claude | falls back to raw trimmed input via `callClaude`'s existing parse-failure handling |

---

## Acceptance Tests

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-DEST-01 | Destination field contains "take me to the bathroom" | Tap Start | Scan/explore/arrival speech references "the bathroom", not the full command |
| AT-DEST-02 | Destination field contains an indirect description, e.g. "I need to wash my hands" | Tap Start | Speech references an inferred place (e.g. "the bathroom"), not the literal sentence |
| AT-DEST-03 | Destination field contains a plain destination, e.g. "room 204" | Tap Start | Destination is unchanged, no regression vs. pre-existing behavior |
| AT-DEST-04 | Destination extraction call fails (simulate network failure/offline) | Tap Start | Navigation still starts, using the raw typed/spoken text; no crash, no extracted-destination cleanup, console warning logged |
| AT-DEST-05 | Destination field is empty | Tap Start | No-op, exactly as before (existing `!goal.trim()` guard); extraction is never called |

---

## Definition of Done

- All AT-DEST-01–05 pass
- `npm run build` and `npm run lint` pass clean
- No regression to the existing scan → explore → navigate loop or its speech strings (`05-visionguide-scan-phase-spec.md` acceptance tests still pass)
- `GoalInput.jsx`'s raw-input display/voice-feedback behavior is unchanged
