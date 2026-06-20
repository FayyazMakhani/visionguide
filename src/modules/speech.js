// TTS_CONFIG — all utterance parameters defined here.
// To add configurable TTS, write to this object. No other code changes needed.
export const TTS_CONFIG = {
  rate: 1.15,
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

// Queued (non-interrupting) utterances are spaced apart so commands don't
// run into each other — the browser's native queue plays them back-to-back
// with no gap otherwise.
const QUEUE_PAUSE_MS = 400;
let speechQueue = [];
let isProcessingQueue = false;

function processQueue() {
  if (isProcessingQueue || speechQueue.length === 0) return;
  isProcessingQueue = true;
  const utterance = speechQueue.shift();
  utterance.onend = () => {
    isProcessingQueue = false;
    setTimeout(processQueue, QUEUE_PAUSE_MS);
  };
  window.speechSynthesis.speak(utterance);
}

/**
 * Speak text via TTS.
 * @param {string} text
 * @param {boolean} interrupt    - If true, cancel current speech first
 * @param {function} [onStart]   - Called when this utterance actually starts playing
 *                                 (not when it's enqueued) — use this to sync UI text to audio.
 */
export function speak(text, interrupt = false, onStart) {
  if (!text || !text.trim()) return;

  // Deduplication: don't repeat the same direction within 10 seconds
  const now = Date.now();
  if (
    !interrupt &&
    text === lastSpokenText &&
    now - lastSpokenAt < DEDUP_WINDOW_MS
  ) return;

  const utterance = createUtterance(text);
  if (onStart) utterance.onstart = onStart;

  if (interrupt) {
    // If something is actively playing, give it the same gap a natural queue
    // transition would get instead of cutting straight into the next utterance —
    // a zero-gap interrupt is what makes back-to-back alerts feel like they collide.
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
  speechQueue = [];
  isProcessingQueue = false;
  window.speechSynthesis.cancel();
  // Android workaround: if speech is still active after cancel(), force-flush with a silent fast utterance
  if (window.speechSynthesis.speaking) {
    const flush = new SpeechSynthesisUtterance(' ');
    flush.volume = 0;
    flush.rate = 10;
    window.speechSynthesis.speak(flush);
  }
}

/**
 * Cancel speech and clear deduplication state.
 * Use between sessions so a direction spoken at the end of one session
 * doesn't suppress the same direction at the start of the next.
 */
export function resetSpeech() {
  cancel();
  lastSpokenText = '';
  lastSpokenAt = 0;
}
