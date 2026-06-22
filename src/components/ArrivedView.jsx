// src/components/ArrivedView.jsx
// Arrival screen (11-visionguide-clarity-redesign-spec.md §Screens.4).

import { colors, fonts } from '../theme.js';

export default function ArrivedView({ goal, onNewDestination }) {
  return (
    <div style={styles.screen}>
      <div style={styles.center}>
        <div style={styles.ring}>
          <div style={styles.disc}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 13l4.5 4.5L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div style={styles.eyebrow}>You've arrived</div>
        {goal ? <div style={styles.dest}>{goal}</div> : null}
        <p style={styles.message}>You've reached your destination.</p>
      </div>

      <div style={styles.actionWrap}>
        <button
          type="button"
          onClick={onNewDestination}
          aria-label="Choose a new destination"
          style={styles.button}
        >
          + New destination
        </button>
      </div>
    </div>
  );
}

const styles = {
  screen: {
    flex: 1,
    minHeight: '100vh',
    background: colors.surface,
    display: 'flex',
    flexDirection: 'column',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '24px',
  },
  ring: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    background: colors.emeraldTint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '30px',
  },
  disc: {
    width: '84px',
    height: '84px',
    borderRadius: '50%',
    background: colors.emerald,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    font: `700 13px/1 ${fonts.body}`,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: colors.emerald,
    marginBottom: '12px',
  },
  dest: {
    font: `900 34px/1.05 ${fonts.display}`,
    letterSpacing: '-.02em',
    color: colors.ink,
    marginBottom: '14px',
  },
  message: {
    font: `400 15px/1.5 ${fonts.body}`,
    color: colors.inkMuted,
    maxWidth: '240px',
    margin: 0,
  },
  actionWrap: {
    padding: '18px',
  },
  button: {
    width: '100%',
    minHeight: '62px',
    border: 'none',
    borderRadius: '31px',
    background: colors.emerald,
    color: colors.white,
    font: `800 17px/1 ${fonts.display}`,
    cursor: 'pointer',
  },
};
