# VisionGuide — Auto-Listen-on-Launch Spec

## Purpose

Today the user must dismiss an onboarding modal, then manually tap a mic button (or type) to set a destination, then tap "Start Navigation" — three required interactions before the app does anything useful, on an app whose primary users may not be able to see any of those controls to begin with.

This spec makes voice capture the default entry point: the app starts listening for a destination the moment it loads, confirms what it heard out loud, and goes straight into the existing camera/scan/navigate flow — no onboarding modal, no mic tap, no Start tap required on the voice path.

The one new risk this introduces: a misheard destination (background noise, partial utterance) auto-starting navigation toward the wrong place, with no human catching it first. A fixed minimum-transcript-length check was considered and rejected — length has no relationship to whether a transcript is *correct*, only to whether it's long. Instead this spec reuses the destination-extraction Claude call already in place (`06-visionguide-destination-extraction-spec.md`) and has it flag transcripts it had to guess at, gating only the uncertain ones behind a spoken yes/no confirmation. Clear transcripts skip straight to "Heading to X" and auto-start, same as a confident manual Start tap today.

---

## Scope

### Changes required
- `src/prompts/system.js` — `buildDestinationExtractionPrompt()` gains an `ambiguous` boolean in its returned schema
- `src/modules/destination.js` — `extractDestination()` return type changes from `string` to `{ destination, ambiguous }`
- `src/App.jsx`:
  - `showOnboarding` initial state hardcoded to `false` (modal never shown)
  - `handleStart`'s post-extraction body (camera init, safety disclaimer, `startLoop`) factored into a new `beginNavigation(cleanedGoal)` callback, reused by both the manual Start button and the new auto-listen flow
  - new `listenForDestination()` callback + mount-only `useEffect` that starts `SpeechRecognition` on load, handles the ambiguous-confirmation branch, and calls `beginNavigation`

### Explicitly out of scope
- `Onboarding.jsx`, its `handleOnboardingDismiss` handler, and the `sessionStorage.vg_visited` logic are left in the codebase untouched — only the trigger that displays it is removed. Nothing reads or writes `vg_visited` differently.
- `GoalInput.jsx`'s manual mic button and text field are unchanged — they remain available for retrying or correcting a destination after the initial auto-listen attempt (e.g. if recognition failed, or the destination was wrong).
- `StartStopButton.jsx`, `StatusDisplay.jsx`, `loop.js`, `speech.js`, `recognition.js` — unchanged. The existing "Hold your phone at chest height..." instruction and the scan/explore phase speech already serve as the "start scanning and exploring" cue once `beginNavigation` runs; no new spoken strings are needed there.
- The manual Start-button path (typed destination, tap Start) is unaffected by the new `ambiguous` flag — it's read by the auto-listen flow only. Typing a destination and tapping Start behaves exactly as before `06-visionguide-destination-extraction-spec.md` already specified, no added confirmation step.
- No change to the once-per-calendar-day safety disclaimer gate — `beginNavigation` still defers to the same `localStorage.vg_safety_date` check, regardless of whether it was reached via auto-listen or a manual Start tap.

---

## Modified Prompt (`prompts/system.js`)

### `buildDestinationExtractionPrompt()`

Schema gains one field:

```
Return ONLY valid JSON, no preamble, no markdown:
{
  "destination": string,
  "ambiguous": boolean
}
```

New rule added to the existing rule list:
```
- ambiguous: true if the transcript sounds like noise, a stray fragment, or is otherwise too
  unclear to confidently resolve to a specific place without heavy guessing. false if the
  destination is stated directly or can be confidently inferred.
```
All existing rules (infer implied place, return unchanged if already clean, never return empty) are unchanged.

---

## Modified Module: `modules/destination.js`

### `extractDestination(rawGoal)`

Return shape changes from a bare string to an object:

```js
export async function extractDestination(rawGoal) {
  const trimmed = rawGoal.trim();
  if (!trimmed) return { destination: trimmed, ambiguous: false };

  try {
    const result = await callClaude(
      buildDestinationExtractionPrompt(),
      [buildDestinationMessage(trimmed)]
    );
    const destination = typeof result.destination === 'string' ? result.destination.trim() : '';
    return { destination: destination || trimmed, ambiguous: Boolean(result.ambiguous) };
  } catch (err) {
    console.warn('Destination extraction failed, using raw input:', err.message);
    return { destination: trimmed, ambiguous: false };
  }
}
```

Fallback behavior is unchanged in spirit — empty input and API failures both skip the ambiguity check entirely (`ambiguous: false`) and proceed with the raw/trimmed input, exactly as `06-visionguide-destination-extraction-spec.md` already specified for the string-only version.

---

## Modified: `App.jsx`

### a. Onboarding suppressed, not removed

```js
const [showOnboarding, setShowOnboarding] = useState(false);
```
(was `useState(!sessionStorage.getItem('vg_visited'))`). `Onboarding` import, `handleOnboardingDismiss`, and the `{showOnboarding && <Onboarding ... />}` JSX are untouched.

### b. `beginNavigation` extracted from `handleStart`

```js
const beginNavigation = useCallback(async (cleanedGoal) => {
  setGoal(cleanedGoal);
  loopStateRef.current = { ...loopStateRef.current, goal: cleanedGoal };

  if (!streamRef.current) {
    try {
      streamRef.current = await initCamera(videoRef.current);
    } catch {
      setLastSpoken('Camera access denied. Please allow camera and try again.');
      return;
    }
  }

  const startNavigating = () => {
    setStatus('navigating');
    setContext([]);
    speak('Hold your phone at chest height, pointing forward.');
    startTimeoutRef.current = setTimeout(() => {
      startTimeoutRef.current = null;
      startLoop(videoRef.current, streamRef, loopStateRef, {
        onSpeak: handleSpeak,
        onContextUpdate: handleContextUpdate,
        onArrival: handleArrival,
        onError: handleError,
      });
    }, 2500);
  };

  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem('vg_safety_date') === today) {
    startNavigating();
  } else {
    const safetyUtterance = new SpeechSynthesisUtterance(
      'VisionGuide is a navigation aid only. Keep using your cane or other mobility aid.'
    );
    safetyUtterance.onend = () => {
      localStorage.setItem('vg_safety_date', today);
      startNavigating();
    };
    window.speechSynthesis.speak(safetyUtterance);
  }
}, [handleSpeak, handleContextUpdate, handleArrival, handleError]);
```

This is the body of the old `handleStart` from "Initialize camera if not already running" onward, moved verbatim — no behavioral change.

### c. `handleStart` now just extracts, then delegates

```js
const handleStart = useCallback(async () => {
  if (!goal.trim()) return;
  if (status === 'navigating') return;
  const { destination: cleanedGoal } = await extractDestination(goal);
  beginNavigation(cleanedGoal);
}, [goal, status, beginNavigation]);
```
Still wired to `StartStopButton`'s `onStart`. Ignores the new `ambiguous` flag entirely — the manual path keeps today's no-confirmation behavior.

### d. New auto-listen flow

```js
const recognitionStopRef = useRef(null);

const listenForDestination = useCallback(() => {
  setStatus('listening');
  speak('Listening for your destination.');
  recognitionStopRef.current = startRecognition(
    async (transcript) => {
      setGoal(transcript);
      const { destination: cleanedGoal, ambiguous } = await extractDestination(transcript);
      setGoal(cleanedGoal);

      if (!ambiguous) {
        setStatus('idle');
        speak(`Heading to ${cleanedGoal}.`);
        beginNavigation(cleanedGoal);
        return;
      }

      setStatus('listening');
      speak(`Did you say ${cleanedGoal}? Say yes or no.`);
      recognitionStopRef.current = startRecognition(
        (answer) => {
          setStatus('idle');
          if (answer.trim().toLowerCase().includes('yes')) {
            speak(`Heading to ${cleanedGoal}.`);
            beginNavigation(cleanedGoal);
          } else {
            speak('Okay, let’s try again.');
            listenForDestination();
          }
        },
        () => {
          setStatus('idle');
          speak('Please type your destination or tap the mic to try again.');
        }
      );
    },
    () => {
      setStatus('idle');
      speak("Didn't catch that. Please type your destination or tap the mic to try again.");
    }
  );
}, [beginNavigation]);

useEffect(() => {
  if (!isRecognitionAvailable()) {
    speak('Voice recognition is not available. Please type your destination.');
    return;
  }
  listenForDestination();
  return () => recognitionStopRef.current?.();
}, []); // mount only — intentionally not in the listenForDestination dep chain
```

`isRecognitionAvailable`/`startRecognition` are newly imported into `App.jsx` from `./modules/recognition.js` (same module `GoalInput.jsx` already uses for its manual mic button).

---

## Edge Cases

| Input | Result |
|---|---|
| Clear destination, e.g. "the elevator" | `ambiguous: false` → "Heading to the elevator." → navigation starts immediately, no confirmation |
| Noisy/garbled transcript Claude can't confidently resolve | `ambiguous: true` → "Did you say [best guess]? Say yes or no." → waits for yes/no |
| User says "yes" to confirmation | "Heading to [destination]." → navigation starts |
| User says "no" (or anything without "yes") | "Okay, let's try again." → re-enters `listenForDestination()` |
| No speech / recognition error on the confirmation listen | "Please type your destination or tap the mic to try again." → status `idle`, manual controls available |
| No speech / recognition error on the initial listen | "Didn't catch that..." → status `idle`, manual controls available |
| `SpeechRecognition` unavailable in this browser | "Voice recognition is not available. Please type your destination." → no auto-listen attempted, manual text input/Start button work exactly as before |
| User types a destination and taps Start (manual path) | Unchanged from `06-visionguide-destination-extraction-spec.md` — no spoken confirmation, no ambiguity branch, `ambiguous` flag is fetched but ignored |
| Destination extraction API failure (network/429/5xx) during auto-listen | `ambiguous` defaults to `false`, raw trimmed transcript is used as the destination, navigation still auto-starts — same fail-open behavior as the manual path |

---

## Acceptance Tests

| ID | Setup | Action | Expected |
|---|---|---|---|
| AT-LISTEN-01 | Fresh page load, mic permission already granted | — (no interaction) | Onboarding modal does not appear; app speaks "Listening for your destination." within one render cycle of mount |
| AT-LISTEN-02 | App just spoke "Listening for your destination." | Speak a clear destination, e.g. "the elevator" | App speaks "Heading to the elevator.", camera permission is requested, safety disclaimer (if due) and scan-phase flow proceed exactly as a manual Start tap would |
| AT-LISTEN-03 | App just spoke "Listening for your destination." | Speak a noisy/ambiguous phrase (mumbled, partial sentence, heavy background noise) | App asks "Did you say [X]? Say yes or no." instead of starting navigation |
| AT-LISTEN-04 | App is mid-confirmation ("Did you say...") | Say "yes" | App speaks "Heading to [X]." and navigation starts |
| AT-LISTEN-05 | App is mid-confirmation ("Did you say...") | Say "no" | App speaks "Okay, let's try again." and re-enters listening for a fresh destination |
| AT-LISTEN-06 | App just spoke "Listening for your destination." | Say nothing until recognition times out, or deny mic permission | App speaks the didn't-catch-that fallback, returns to `idle`, manual text input and mic button remain usable |
| AT-LISTEN-07 | Non-Chrome browser without `SpeechRecognition` | Load the app | App speaks "Voice recognition is not available. Please type your destination." and no recognition is attempted; typing + tapping Start works unchanged |
| AT-LISTEN-08 | Any state | Type a destination directly and tap Start (ignore voice entirely) | Behaves exactly as `06-visionguide-destination-extraction-spec.md` already specifies — no "Heading to X" announcement, no ambiguity confirmation |
| AT-LISTEN-09 | Auto-listen captured a destination | — | `GoalInput`'s text field reflects the final cleaned destination (not the raw transcript) once navigation starts, same as the manual path after extraction |

---

## Definition of Done

- All AT-LISTEN-01–09 pass
- `npm run build` and `npm run lint` pass clean
- No regression to `06-visionguide-destination-extraction-spec.md`'s AT-DEST-01–05 (manual path unaffected by the new `ambiguous` field)
- No regression to the existing scan → explore → navigate loop, its speech strings, or the once-per-day safety disclaimer gate
- `Onboarding.jsx` file and its dismiss logic remain present and unchanged in the codebase, just never rendered
