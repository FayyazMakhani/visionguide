const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const isRecognitionAvailable = () => SpeechRecognition !== null;

/**
 * @param {function} onResult       - Called with recognized string
 * @param {function} onError        - Called with error message string
 * @param {function} [onSpeechStart] - Called as soon as speech is detected (before
 *                                     a result is available) — use this for barge-in,
 *                                     e.g. cutting off a TTS prompt the user is talking over.
 * @returns {function} stop() function
 */
export function startRecognition(onResult, onError, onSpeechStart) {
  if (!SpeechRecognition) {
    onError('Speech recognition not available');
    return () => {};
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let settled = false;

  if (onSpeechStart) recognition.onspeechstart = onSpeechStart;

  recognition.onresult = (event) => {
    settled = true;
    const result = event.results[0][0].transcript.trim();
    onResult(result);
  };

  recognition.onerror = (event) => {
    settled = true;
    onError(event.error);
  };

  recognition.onend = () => {
    // Guarantee onError fires if recognition ended without ever producing a
    // result (e.g. it silently failed to capture anything) so callers always
    // get a terminal signal instead of waiting forever.
    if (!settled) {
      settled = true;
      onError('no-speech-detected');
    }
  };

  try {
    recognition.start();
  } catch (err) {
    settled = true;
    onError(err.message || 'start-failed');
  }

  // Idempotent and crash-safe: callers may now invoke this more than once
  // (e.g. App.jsx's session teardown runs on every Stop/Arrival/give-up, not
  // just unmount) or after the recognition has already ended naturally.
  // Chrome no-ops abort() on an ended recognition; WebKit (the engine behind
  // Chrome on iOS) throws InvalidStateError instead.
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try { recognition.abort(); } catch { /* already ended */ }
  };
}

/**
 * Listen continuously for one of a fixed set of trigger phrases (e.g. "not
 * here") for as long as the caller keeps it running — unlike startRecognition,
 * which resolves once with a single transcript. Browsers commonly stop a
 * "continuous" recognizer after a pause anyway, so this restarts it until
 * stop() is called.
 *
 * @param {string[]} phrases  - lowercase phrases to match via substring
 * @param {function} onMatch  - called (with no args) when a phrase matches
 * @returns {function} stop()
 */
export function startCommandListener(phrases, onMatch) {
  if (!SpeechRecognition) return () => {};

  let stopped = false;
  let recognition = null;

  function startOne() {
    if (stopped) return;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
      if (phrases.some((p) => last.includes(p))) onMatch();
    };
    recognition.onerror = () => { /* transient (no-speech, network) — onend restarts */ };
    recognition.onend = () => {
      if (!stopped) startOne();
    };

    try { recognition.start(); } catch { /* already running */ }
  }

  startOne();

  return () => {
    stopped = true;
    try { recognition?.abort(); } catch { /* already ended */ }
  };
}
