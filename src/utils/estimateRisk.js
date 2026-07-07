// src/utils/estimateRisk.js

import { CV_RISK_CONFIDENCE_MIN, CV_PROXIMITY_THRESHOLD } from '../constants.js';

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

  // Not confident or not yet confirmed across frames — no signal at all
  if (confidence < CV_RISK_CONFIDENCE_MIN || framesVisible <= 1) return 'none';

  if (label === 'person') {
    const isClose = boundingBox.height > CV_PROXIMITY_THRESHOLD;
    if (isClose && confidence > CV_RISK_CONFIDENCE_MIN && framesVisible > 3) return 'high';
    return 'medium';
  }

  const centroidX = boundingBox.originX + boundingBox.width / 2;
  const isCenter = centroidX >= 0.33 && centroidX <= 0.67;
  if (FURNITURE_LABELS.includes(label) && isCenter) return 'medium';

  return 'low';
}
