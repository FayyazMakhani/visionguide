// src/modules/cvContextBuilder.js

import * as cvWorldModel from './cvWorldModel.js';
import { estimateRisk } from '../utils/estimateRisk.js';
import { CV_CONTEXT_STALENESS_MS } from '../constants.js';

// Low-risk/unconfirmed objects add prompt noise without aiding navigation —
// cap the summary to the few objects that actually matter (spec 12).
const MAX_CONTEXT_OBJECTS = 3;

/**
 * Medium/high-risk tracked objects (spec 12's hazard-worthy subset), sorted
 * high-risk-first then closest-first within each risk tier. Shared by build()
 * below and by the demo detection overlay (spec 13, loop.js/App.jsx).
 *
 * @returns {Array<{obj: object, risk: 'high'|'medium'}>} empty when the
 *          snapshot is missing/stale or nothing qualifies.
 */
export function getQualifyingObjects() {
  const snapshot = cvWorldModel.getSnapshot();
  if (!snapshot || Date.now() - snapshot.frameTimestamp > CV_CONTEXT_STALENESS_MS) return [];

  return snapshot.objects
    .map(obj => ({ obj, risk: estimateRisk(obj) }))
    .filter(({ risk }) => risk === 'high' || risk === 'medium')
    .sort((a, b) => {
      if (a.risk !== b.risk) return a.risk === 'high' ? -1 : 1;
      return b.obj.boundingBox.height - a.obj.boundingBox.height; // closer first
    });
}

/**
 * Compact CV scene summary for the Claude prompt, called once per slow-loop
 * tick from loop.js. Example: "CV: person center (high risk), chair right
 * (medium risk)".
 *
 * @returns {string|null} null when nothing qualifies — the Claude prompt then
 *                        carries no CV line (zero token cost).
 */
export function build() {
  const qualifying = getQualifyingObjects().slice(0, MAX_CONTEXT_OBJECTS);
  if (qualifying.length === 0) return null;

  const parts = qualifying.map(({ obj, risk }) => `${obj.label} ${obj.position} (${risk} risk)`);
  return `CV: ${parts.join(', ')}`;
}
