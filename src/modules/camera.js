import { speak } from './speech.js';

const MAX_FRAME_EDGE = 640; // cap on the longer edge of a captured frame, to keep JPEG payload size/cost in check
const JPEG_QUALITY = 0.7;
const FROZEN_FRAME_THRESHOLD = 3; // 3 consecutive identical frames = frozen

let wakeLock = null;
let visibilityHandler = null;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
// Tracks the videoWidth/videoHeight the canvas was last sized for, so getFrame()
// only resizes the canvas when the negotiated stream's dimensions actually change.
let sizedForWidth = 0;
let sizedForHeight = 0;

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
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
      },
    });
  } catch (err) {
    speak('Camera access is required. Please allow camera in browser settings.');
    throw err;
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  // Best-effort: prefer an ultra-wide back lens if the device exposes one as a
  // distinct enumerable camera. Heuristic and unreliable across devices/browsers —
  // silently keeps the original stream if no such lens is found or the switch fails.
  stream = await tryUpgradeToUltraWide(videoEl, stream);

  // Request WakeLock
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    speak('Please keep the screen on manually during navigation.');
  }

  // Re-acquire WakeLock when the app comes back to the foreground —
  // the system releases WakeLock automatically when the tab is backgrounded.
  visibilityHandler = async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch { /* silent — WakeLock is best-effort */ }
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  return stream;
}

/**
 * Best-effort attempt to switch to an ultra-wide back camera, if the device
 * exposes one as a distinct enumerable device with a recognizable label.
 * Device labels are only populated once permission has been granted, so this
 * must run after the initial getUserMedia call. Returns the original stream
 * unchanged on any failure or if no ultra-wide candidate is found.
 * @param {HTMLVideoElement} videoEl
 * @param {MediaStream} stream - currently active stream
 * @returns {Promise<MediaStream>}
 */
async function tryUpgradeToUltraWide(videoEl, stream) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const currentId = stream.getVideoTracks()[0]?.getSettings().deviceId;
    const ultraWide = devices.find(d =>
      d.kind === 'videoinput' &&
      d.deviceId !== currentId &&
      /ultra.?\s?wide|0\.5x/i.test(d.label)
    );
    if (!ultraWide) return stream;

    const wideStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: ultraWide.deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
      },
    });
    stream.getTracks().forEach(t => t.stop());
    videoEl.srcObject = wideStream;
    await videoEl.play();
    return wideStream;
  } catch {
    return stream; // best-effort only — keep the original stream on any failure
  }
}

/**
 * Stop camera stream, release WakeLock, and remove the visibility listener.
 * @param {MediaStream} stream
 */
export async function stopCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());

  // Detach the module-level singleton synchronously before the async release
  // call below, so a remount's initCamera (which may run during this unawaited
  // gap, e.g. from App.jsx's synchronous unmount cleanup) can safely acquire a
  // fresh WakeLock without racing this stale one's release.
  const lockToRelease = wakeLock;
  wakeLock = null;
  try { await lockToRelease?.release(); } catch { /* ignore */ }

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }

  resetFrozenFrameDetector();
}

/**
 * Re-initialize camera stream on frozen frame detection.
 * @param {HTMLVideoElement} videoEl
 * @param {MediaStream} currentStream
 * @returns {Promise<MediaStream>} new stream
 */
export async function reinitCamera(videoEl, currentStream) {
  console.warn('Frozen frame detected — re-initializing camera stream');
  await stopCamera(currentStream);
  return initCamera(videoEl);
}

/**
 * Capture current video frame as base64 JPEG.
 * Returns null if video is not ready.
 * @param {HTMLVideoElement} videoEl
 * @returns {string | null} base64 JPEG without data: prefix
 */
export function getFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;

  const { videoWidth, videoHeight } = videoEl;
  if (videoWidth !== sizedForWidth || videoHeight !== sizedForHeight) {
    // Scale down to fit MAX_FRAME_EDGE on the longer edge, preserving the
    // stream's actual aspect ratio — never upscale, never stretch/crop.
    const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(videoWidth, videoHeight));
    canvas.width = Math.round(videoWidth * scale);
    canvas.height = Math.round(videoHeight * scale);
    sizedForWidth = videoWidth;
    sizedForHeight = videoHeight;
  }

  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1];  // Strip 'data:image/jpeg;base64,' prefix
}

// --- Frozen frame detection ---
// Compares the current frame to the previous one. If identical for
// FROZEN_FRAME_THRESHOLD consecutive cycles, the stream is considered frozen.
let lastFrameData = null;
let frozenFrameCount = 0;

/**
 * Check if the current frame is identical to the previous one.
 * Resets count on any change.
 * @param {string} frame - base64 JPEG string
 * @returns {boolean} true if stream appears frozen
 */
export function checkFrozenFrame(frame) {
  if (frame === lastFrameData) {
    frozenFrameCount++;
  } else {
    frozenFrameCount = 0;
    lastFrameData = frame;
  }
  return frozenFrameCount >= FROZEN_FRAME_THRESHOLD;
}

export function resetFrozenFrameDetector() {
  lastFrameData = null;
  frozenFrameCount = 0;
}
