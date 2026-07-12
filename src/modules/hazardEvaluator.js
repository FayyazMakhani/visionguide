// src/modules/hazardEvaluator.js

import * as cvWorldModel from './cvWorldModel.js';
import { estimateRisk } from '../utils/estimateRisk.js';
import { routeObstacles } from './obstacles.js';
import { CV_MEDIUM_LOOP_MS, CV_CONTEXT_STALENESS_MS, CV_ALERT_COOLDOWN_MS } from '../constants.js';

// CV alerts defer to active speech: no alert while an utterance is playing, or
// within this window after speech was last observed playing — a CV alert never
// cuts into Claude's navigation guidance mid-sentence (spec 12, AT-CV-06).
// Sampled once per medium-loop tick, so the window is accurate to ±CV_MEDIUM_LOOP_MS,
// erring toward waiting slightly longer — the safe direction. Also defers while
// `pending` — an utterance already handed to the native queue but whose `onstart`
// hasn't fired yet — since a CV alert here would cancel it via speak(alert, true)
// and speech.js's 10s dedup would then silently drop an identical retry.
const SPEECH_IDLE_MS = 2000;

let intervalId = null;
let lastSpeakingObservedAt = 0;
let lastAlertAtByLabel = new Map();

/**
 * Start the medium loop (~3fps). Safe to call if already running.
 */
export function start() {
  if (intervalId !== null) return;
  lastAlertAtByLabel = new Map();
  // Treat session start as "just finished speaking" so the safety prompt /
  // scan instruction queued right before startLoop can't be trampled.
  lastSpeakingObservedAt = Date.now();
  intervalId = setInterval(tick, CV_MEDIUM_LOOP_MS);
}

/**
 * Stop the medium loop. Safe to call if not running.
 */
export function stop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function tick() {
  const now = Date.now();

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    lastSpeakingObservedAt = now;
    return;
  }
  if (now - lastSpeakingObservedAt < SPEECH_IDLE_MS) return;

  const snapshot = cvWorldModel.getSnapshot();
  if (!snapshot || now - snapshot.frameTimestamp > CV_CONTEXT_STALENESS_MS) return;

  const highRisk = snapshot.objects
    .filter(obj => estimateRisk(obj) === 'high')
    .sort((a, b) => b.boundingBox.height - a.boundingBox.height); // closer first

  for (const obj of highRisk) {
    const lastAt = lastAlertAtByLabel.get(obj.label) ?? 0;
    if (now - lastAt < CV_ALERT_COOLDOWN_MS) continue;
    lastAlertAtByLabel.set(obj.label, now);

    // routeObstacles applies its own same-type+direction high-alert cooldown
    // (4000ms) on top of ours — stacking errs toward fewer alerts, which is fine.
    routeObstacles([{
      type: obj.label,
      direction: obj.position === 'center' ? 'ahead' : obj.position,
      urgency: 'high',
    }]);
    return; // one alert per tick, mirroring routeObstacles' single-high policy
  }
}
