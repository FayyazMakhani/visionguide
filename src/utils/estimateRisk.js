// src/utils/estimateRisk.js

import { CV_RISK_CONFIDENCE_MIN, CV_FURNITURE_CONFIDENCE_MIN, CV_PROXIMITY_THRESHOLD, CV_BOTTOM_PROXIMITY_THRESHOLD } from '../constants.js';

// COCO labels treated as large furniture for the medium-risk rule.
const FURNITURE_LABELS = ['chair', 'couch', 'dining table'];

/**
 * Pure risk estimate for one tracked object (spec 12). Label-aware: a person
 * always outranks equivalently-sized furniture — a distant person (small box)
 * still beats a close potted plant (large box).
 *
 * @param {object} obj
 * @param {string} obj.label                  - MediaPipe COCO category name
 * @param {object} obj.boundingBox            - Normalized 0-1 { originX, originY, width, height }
 * @param {number} obj.confidence             - Smoothed detection confidence
 * @param {number} obj.framesVisible          - Consecutive matched frames
 * @param {*}      [obj.depthEstimate]        - Seam for a future depth model — accepted but ignored today
 * @returns {'high'|'medium'|'low'|'none'}
 */
export function estimateRisk({ label, boundingBox, confidence, framesVisible, depthEstimate = null }) {
  void depthEstimate; // reserved seam (spec 12 "out of scope: depth estimation")

  // Not yet confirmed across frames — no signal regardless of label
  if (framesVisible <= 1) return 'none';

  if (label === 'person') {
    if (confidence < CV_RISK_CONFIDENCE_MIN) return 'none';
    const isClose = boundingBox.height > CV_PROXIMITY_THRESHOLD;
    if (isClose && confidence > CV_RISK_CONFIDENCE_MIN && framesVisible > 3) return 'high';
    return 'medium';
  }

  // Furniture gets a lower confidence floor than person: the detector scores
  // chairs/tables markedly lower than people even when clearly in frame
  // (~0.6-0.8 for a prominent chair), so the 0.7 person floor was silently
  // discarding every chair. A close, centered piece is a real path hazard —
  // escalate it to high, same as a close person.
  const centroidX = boundingBox.originX + boundingBox.width / 2;
  const isCenter = centroidX >= 0.33 && centroidX <= 0.67;
  if (FURNITURE_LABELS.includes(label) && isCenter && confidence >= CV_FURNITURE_CONFIDENCE_MIN) {
    // Close either by size (fills the frame) or by position (box reaches the
    // bottom of the frame) — the latter catches a piece you're right on top of,
    // which slips low and clips small even as you're about to hit it.
    const bottomEdge = boundingBox.originY + boundingBox.height;
    const isClose =
      boundingBox.height > CV_PROXIMITY_THRESHOLD || bottomEdge > CV_BOTTOM_PROXIMITY_THRESHOLD;
    return isClose ? 'high' : 'medium';
  }

  return 'low';
}
