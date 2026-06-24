// src/components/NavigatingView.jsx
// Google-Maps-style navigating screen (11-visionguide-clarity-redesign-spec.md §Screens.3).
// Background is the spec-10 analyzed still frame (lastFrame), NOT the live feed.

import { colors, fonts } from '../theme.js';

export default function NavigatingView({ goal, lastSpoken, frame, onStop }) {
  return (
    <div style={styles.screen}>
      {/* Background: the exact frame analyzed for the current instruction. */}
      {frame ? (
        <img
          src={`data:image/jpeg;base64,${frame}`}
          alt="Camera frame analyzed for this instruction"
          style={styles.frame}
        />
      ) : null}

      {/* Readability scrims */}
      <div style={styles.scrimTop} aria-hidden="true" />
      <div style={styles.scrimBottom} aria-hidden="true" />

      {/* LIVE badge */}
      <div style={styles.liveBadge} aria-hidden="true">
        <span style={styles.liveDot} />
        <span style={styles.liveText}>Live</span>
      </div>

      {/* Top instruction banner — the aria-live region carrying the spoken instruction. */}
      <div style={styles.bannerWrap}>
        <div
          style={styles.banner}
          aria-live="assertive"
          aria-atomic="true"
        >
          <span style={styles.bannerIcon} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 20V5M12 5l-7 7M12 5l7 7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <div style={styles.bannerText}>{lastSpoken || 'Starting…'}</div>
            {goal ? <div style={styles.bannerSub}>→ {goal}</div> : null}
          </div>
        </div>
      </div>

      {/* Docked Stop action */}
      <div style={styles.stopWrap}>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop navigation"
          style={styles.stopButton}
        >
          Stop navigation
        </button>
      </div>
    </div>
  );
}

const styles = {
  screen: {
    position: 'relative',
    flex: 1,
    minHeight: '100vh',
    background: colors.dark,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  frame: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  scrimTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: '230px',
    background: 'linear-gradient(180deg, rgba(8,12,22,.82), transparent)',
  },
  scrimBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '180px',
    background: 'linear-gradient(0deg, rgba(8,12,22,.9), transparent)',
  },
  liveBadge: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(8,12,22,.6)',
    padding: '6px 11px',
    borderRadius: '20px',
  },
  liveDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: '#36E0B0',
  },
  liveText: {
    font: `700 10px/1 ${fonts.body}`,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: colors.white,
  },
  bannerWrap: {
    position: 'relative',
    padding: '54px 16px 0',
  },
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '13px',
    background: colors.emerald,
    borderRadius: '18px',
    padding: '16px 15px',
    boxShadow: '0 12px 26px -10px rgba(0,0,0,.6)',
  },
  bannerIcon: {
    width: '46px',
    height: '46px',
    flex: 'none',
    borderRadius: '13px',
    background: 'rgba(255,255,255,.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: {
    font: `700 20px/1.25 ${fonts.body}`,
    color: colors.white,
    marginBottom: '3px',
  },
  bannerSub: {
    font: `700 13px/1.2 ${fonts.body}`,
    color: colors.white, // full white on emerald = 4.52:1 (the 85% variant failed AA)
  },
  stopWrap: {
    marginTop: 'auto',
    position: 'relative',
    padding: '0 16px 22px',
  },
  stopButton: {
    width: '100%',
    minHeight: '60px',
    border: 'none',
    borderRadius: '30px',
    background: colors.stop,
    color: colors.white,
    font: `800 18px/1 ${fonts.display}`,
    cursor: 'pointer',
    boxShadow: '0 12px 26px -10px rgba(0,0,0,.6)',
  },
};
