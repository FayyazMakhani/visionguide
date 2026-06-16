// TTS_CONFIG — all utterance parameters defined here.
// To add configurable TTS, write to this object. No other code changes needed.
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

/**
 * Speak text via TTS.
 * @param {string} text
 * @param {boolean} interrupt - If true, cancel current speech first
 */
export function speak(text, interrupt = false) {
  if (!text || !text.trim()) return;

  // Deduplication: don't repeat the same direction within 10 seconds
  const now = Date.now();
  if (
    !interrupt &&
    text === lastSpokenText &&
    now - lastSpokenAt < DEDUP_WINDOW_MS
  ) return;

  if (interrupt) {
    cancel();
  }

  const utterance = createUtterance(text);
  window.speechSynthesis.speak(utterance);

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
  window.speechSynthesis.cancel();
  // Android workaround: if speech is still active after cancel(), force-flush with a silent fast utterance
  if (window.speechSynthesis.speaking) {
    const flush = new SpeechSynthesisUtterance(' ');
    flush.volume = 0;
    flush.rate = 10;
    window.speechSynthesis.speak(flush);
  }
}
