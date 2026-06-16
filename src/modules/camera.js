import { speak } from './speech.js';

const FRAME_WIDTH  = 640;
const FRAME_HEIGHT = 480;
const JPEG_QUALITY = 0.7;

let wakeLock = null;
const canvas = document.createElement('canvas');
canvas.width  = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;
const ctx = canvas.getContext('2d');

/**
 * Initialize camera stream and attach to video element.
 * Requests WakeLock. Speaks error if camera denied.
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<MediaStream>}
 * @throws {Error} if camera permission denied
 */
export async function initCamera(videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: FRAME_WIDTH },
        height: { ideal: FRAME_HEIGHT },
      },
    });
  } catch (err) {
    speak('Camera access is required. Please allow camera in browser settings.');
    throw err;
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  // Request WakeLock
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    speak('Please keep the screen on manually during navigation.');
  }

  return stream;
}

/**
 * Stop camera stream and release WakeLock.
 * @param {MediaStream} stream
 */
export async function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

/**
 * Capture current video frame as base64 JPEG.
 * Returns null if video is not ready.
 * @param {HTMLVideoElement} videoEl
 * @returns {string | null} base64 JPEG without data: prefix
 */
export function getFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  ctx.drawImage(videoEl, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1];  // Strip 'data:image/jpeg;base64,' prefix
}

/**
 * Detect frozen frame by comparing base64 strings.
 * Call every few seconds in the loop if needed.
 */
let lastFrameHash = null;
export function isFrameFrozen(frame) {
  if (frame === lastFrameHash) return true;
  lastFrameHash = frame;
  return false;
}
