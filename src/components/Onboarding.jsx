// src/components/Onboarding.jsx

import { colors, fonts } from '../theme.js';

const STEPS = [
  'Type or speak where you want to go',
  'Tap Start Navigation',
  'Hold your phone in front of you at chest height',
  'Follow the spoken directions',
];

export default function Onboarding({ onDismiss }) {
  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to VisionGuide"
    >
      <div style={styles.card}>
        <h2 style={styles.title}>Welcome to VisionGuide</h2>
        <p style={styles.body}>
          VisionGuide uses your camera to see your surroundings and speaks directions to help you
          navigate indoors.
        </p>

        <ol style={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={i} style={styles.step}>
              <span style={styles.num} aria-hidden="true">{i + 1}</span>
              <span style={styles.stepText}>{step}</span>
            </li>
          ))}
        </ol>

        <div style={styles.warning}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={styles.warnIcon} aria-hidden="true">
            <path d="M12 3l9 16H3L12 3z" stroke={colors.warnIcon} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M12 9v4.5M12 16.3v.2" stroke={colors.warnIcon} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span style={styles.warnText}>Keep using your white cane or mobility aid at all times.</span>
        </div>

        <button
          onClick={onDismiss}
          autoFocus
          style={styles.button}
          aria-label="Got it, start using VisionGuide"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(14,26,23,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '24px',
  },
  card: {
    background: colors.surface,
    borderRadius: '20px',
    padding: '28px 24px',
    maxWidth: '400px',
    width: '100%',
    boxShadow: '0 24px 60px -20px rgba(0,0,0,.45)',
  },
  title: {
    font: `900 25px/1.1 ${fonts.display}`,
    letterSpacing: '-.02em',
    color: colors.ink,
    margin: '0 0 8px',
  },
  body: {
    font: `400 14px/1.5 ${fonts.body}`,
    color: colors.inkMuted,
    margin: '0 0 18px',
  },
  steps: {
    listStyle: 'none',
    margin: '0 0 20px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '11px',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '11px',
  },
  num: {
    flex: 'none',
    width: '24px',
    height: '24px',
    borderRadius: '7px',
    background: colors.emeraldTint,
    color: colors.emerald,
    font: `800 13px/24px ${fonts.display}`,
    textAlign: 'center',
  },
  stepText: {
    font: `700 14px/1.3 ${fonts.body}`,
    color: colors.ink,
  },
  warning: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    background: colors.warnBg,
    border: `1px solid ${colors.warnBorder}`,
    borderRadius: '12px',
    padding: '12px 13px',
    marginBottom: '18px',
  },
  warnIcon: {
    flex: 'none',
    marginTop: '1px',
  },
  warnText: {
    font: `700 13px/1.45 ${fonts.body}`,
    color: colors.warnText,
  },
  button: {
    width: '100%',
    minHeight: '60px',
    border: 'none',
    borderRadius: '30px',
    background: colors.emerald,
    color: colors.white,
    font: `800 17px/1 ${fonts.display}`,
    cursor: 'pointer',
    boxShadow: '0 10px 22px -8px rgba(6,133,122,.55)',
  },
};
