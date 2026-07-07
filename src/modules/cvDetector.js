// src/modules/cvDetector.js

import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import * as cvTracker from './cvTracker.js';
import * as cvWorldModel from './cvWorldModel.js';
import { CV_CONFIDENCE_THRESHOLD } from '../constants.js';

// Self-hosted MediaPipe assets (public/) — version-matched to the installed
// npm package, no CDN dependency at runtime. See spec 12 plan, Task 1.
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/efficientdet_lite0.tflite';
const DETECT_MIN_INTERVAL_MS = 66; // floor detections to ~15fps — detectForVideo is synchronous on the main thread

let detector = null;
let videoEl = null;
let rafId = null;
let running = false;
let lastVideoTime = -1;
let lastDetectAt = 0;
let warnedFrameError = false;
// Bumped on stop() so an init() still awaiting the model download knows its
// session already ended and closes the late-created detector instead of
// resurrecting a stopped CV layer.
let generation = 0;

/**
 * Create the MediaPipe ObjectDetector against the shared camera <video>
 * element (no second camera stream). Failure is non-fatal to navigation —
 * loop.js catches and warns; Claude vision continues unaffected.
 * @param {HTMLVideoElement} el
 */
export async function init(el) {
  videoEl = el;
  if (detector) return;
  const gen = generation;

  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  let created;
  try {
    created = await ObjectDetector.createFromOptions(vision, detectorOptions('GPU'));
  } catch {
    // Some WebViews/older devices lack the GPU delegate — CPU still hits ~10fps
    created = await ObjectDetector.createFromOptions(vision, detectorOptions('CPU'));
  }

  if (gen !== generation) {
    created.close(); // stopped while the model was loading
    return;
  }
  detector = created;
  console.log('CV detector ready'); // AT-CV-01 checks for this exact string
}

function detectorOptions(delegate) {
  return {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    maxResults: 5,
    scoreThreshold: CV_CONFIDENCE_THRESHOLD,
  };
}

/**
 * Start the fast loop (rAF, ~15fps effective — throttled naturally by
 * inference time). Safe to call before init() resolves; frames no-op until
 * the detector is ready.
 */
export function start() {
  if (running) return;
  running = true;
  cvTracker.reset();
  cvWorldModel.reset();
  lastVideoTime = -1;
  lastDetectAt = 0;
  warnedFrameError = false;
  rafId = requestAnimationFrame(onFrame);
}

function onFrame() {
  if (!running) return;
  rafId = requestAnimationFrame(onFrame);

  if (!detector || !videoEl || videoEl.readyState < 2) return;
  if (videoEl.currentTime === lastVideoTime) return; // same camera frame — skip

  const nowMs = performance.now();
  if (nowMs - lastDetectAt < DETECT_MIN_INTERVAL_MS) return;
  lastDetectAt = nowMs;

  lastVideoTime = videoEl.currentTime;

  // A recurring per-frame error at 15Hz would otherwise spam the console hard
  // enough to cost main-thread time; the staleness guards already make
  // consumers degrade safely, so one warning per session is enough.
  try {
    const result = detector.detectForVideo(videoEl, performance.now());
    const tracked = cvTracker.update(normalizeDetections(result.detections));
    cvWorldModel.update(tracked, Date.now());
  } catch (err) {
    if (!warnedFrameError) {
      console.warn('CV frame detection failed:', err.message);
      warnedFrameError = true;
    }
    return;
  }
}

// MediaPipe boundingBoxes are in pixels; the rest of the CV layer works in
// 0-1 fractions of the frame (position buckets, CV_PROXIMITY_THRESHOLD).
function normalizeDetections(detections) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return [];
  return detections.map(d => ({
    label: d.categories[0]?.categoryName ?? 'object',
    confidence: d.categories[0]?.score ?? 0,
    boundingBox: {
      originX: d.boundingBox.originX / w,
      originY: d.boundingBox.originY / h,
      width: d.boundingBox.width / w,
      height: d.boundingBox.height / h,
    },
  }));
}

/**
 * Cancel the rAF loop and close the detector. Safe to call if not running,
 * or while init() is still in flight.
 */
export function stop() {
  generation++;
  running = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (detector) {
    detector.close();
    detector = null;
  }
  videoEl = null;
}
