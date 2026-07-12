// src/modules/cvTracker.js

import { CV_EVICTION_FRAMES } from '../constants.js';

// Previous frame's tracks. Internal shape adds missedFrames (consecutive
// unmatched frames) to the public tracked-object shape.
let tracked = [];
let nextId = 1;

// A detection whose best IoU against existing tracks is below this is a new object (spec 12).
const IOU_MATCH_THRESHOLD = 0.3;

/**
 * Match raw detections to existing tracks by IoU (greedy, best score first,
 * same label only), assign fresh ascending IDs to unmatched detections, and
 * evict tracks unmatched for CV_EVICTION_FRAMES consecutive frames. Unevicted
 * unmatched tracks linger with their last-seen box so brief detector flicker
 * doesn't drop them from the world model.
 *
 * @param {Array<{label: string, confidence: number, boundingBox: object}>} rawDetections
 *        Normalized 0-1 bounding boxes.
 * @returns {Array<{id, label, boundingBox, confidence, framesVisible, position}>}
 */
export function update(rawDetections) {
  const pairs = [];
  tracked.forEach((obj, ti) => {
    rawDetections.forEach((det, di) => {
      if (obj.label !== det.label) return;
      const score = iou(obj.boundingBox, det.boundingBox);
      if (score >= IOU_MATCH_THRESHOLD) pairs.push({ ti, di, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const matchedTracked = new Set();
  const matchedDetections = new Set();
  const next = [];

  for (const { ti, di } of pairs) {
    if (matchedTracked.has(ti) || matchedDetections.has(di)) continue;
    matchedTracked.add(ti);
    matchedDetections.add(di);
    const obj = tracked[ti];
    const det = rawDetections[di];
    next.push({
      id: obj.id,
      label: obj.label,
      boundingBox: det.boundingBox,
      // Running average over matched frames — framesVisible is the sample count
      confidence: (obj.confidence * obj.framesVisible + det.confidence) / (obj.framesVisible + 1),
      framesVisible: obj.framesVisible + 1,
      position: positionOf(det.boundingBox),
      missedFrames: 0,
    });
  }

  rawDetections.forEach((det, di) => {
    if (matchedDetections.has(di)) return;
    next.push({
      id: nextId++,
      label: det.label,
      boundingBox: det.boundingBox,
      confidence: det.confidence,
      framesVisible: 1,
      position: positionOf(det.boundingBox),
      missedFrames: 0,
    });
  });

  tracked.forEach((obj, ti) => {
    if (matchedTracked.has(ti)) return;
    const missedFrames = obj.missedFrames + 1;
    if (missedFrames >= CV_EVICTION_FRAMES) return; // evicted — ghost prevention
    next.push({ ...obj, missedFrames });
  });

  tracked = next;
  return tracked.map(obj => ({
    id: obj.id,
    label: obj.label,
    boundingBox: obj.boundingBox,
    confidence: obj.confidence,
    framesVisible: obj.framesVisible,
    position: obj.position,
  }));
}

function iou(a, b) {
  const x1 = Math.max(a.originX, b.originX);
  const y1 = Math.max(a.originY, b.originY);
  const x2 = Math.min(a.originX + a.width, b.originX + b.width);
  const y2 = Math.min(a.originY + a.height, b.originY + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function positionOf(boundingBox) {
  const centroidX = boundingBox.originX + boundingBox.width / 2;
  if (centroidX < 0.33) return 'left';
  if (centroidX > 0.67) return 'right';
  return 'center';
}

/**
 * Clear all tracks and restart IDs. Call at the start of each CV session so
 * tracks from a previous navigation session can't leak into a new one.
 */
export function reset() {
  tracked = [];
  nextId = 1;
}
