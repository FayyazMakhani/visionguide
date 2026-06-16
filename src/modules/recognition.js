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
