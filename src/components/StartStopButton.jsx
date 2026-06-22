// src/components/StartStopButton.jsx
// Used on the Set-destination screen. Stop and New-destination actions live in
// NavigatingView / ArrivedView respectively (11-visionguide-clarity-redesign-spec.md).

import { colors, fonts } from '../theme.js';

export default function StartStopButton({ status, onStart, disabled }) {
  const isListening = status === 'listening';
  const label = isListening ? 'Listening…' : 'Start navigation';
  const inactive = disabled || isListening;

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={inactive}
      aria-label="Start navigation"
      style={{
        ...styles.button,
        opacity: inactive ? 0.45 : 1,
        cursor: inactive ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
      {!isListening && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

const styles = {
  button: {
    width: '100%',
    minHeight: '64px',
    border: 'none',
    borderRadius: '32px',
    background: colors.emerald,
    color: colors.white,
    font: `800 18px/1 ${fonts.display}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '9px',
    boxShadow: '0 12px 24px -8px rgba(6,133,122,.55)',
  },
};
