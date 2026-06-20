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

  return () => recognition.abort();
}
