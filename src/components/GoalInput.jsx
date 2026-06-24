// src/components/GoalInput.jsx

import { useEffect, useRef } from 'react';
import { isRecognitionAvailable, startRecognition } from '../modules/recognition.js';
import { speak } from '../modules/speech.js';
import { colors, fonts } from '../theme.js';

export default function GoalInput({ goal, onGoalChange, disabled, isListening, onStatusChange }) {
  const inputRef = useRef(null);
  const stopRecognitionRef = useRef(null);

  // Focus input on mount for screen reader / keyboard access
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Abort any in-flight recognition if this component unmounts mid-listen.
  useEffect(() => {
    return () => stopRecognitionRef.current?.();
  }, []);

  // Abort any in-flight recognition as soon as this control is disabled
  // (navigation has started) — without this, recognition started here is
  // entirely disconnected from App.jsx's session lifecycle, so it could
  // otherwise still be capturing audio for the entire navigation session.
  useEffect(() => {
    if (disabled) stopRecognitionRef.current?.();
  }, [disabled]);

  const handleMicClick = () => {
    if (isListening) {
      // Cancel active recognition
      stopRecognitionRef.current?.();
      onStatusChange('idle');
      return;
    }

    onStatusChange('listening');
    speak('Listening');

    stopRecognitionRef.current = startRecognition(
      (result) => {
        onGoalChange(result);
        speak(`I heard: ${result}. Tap Start to begin.`);
        onStatusChange('idle');
      },
      (error) => {
        console.warn('Recognition error:', error);
        speak("Didn't catch that. Please try again or type your destination.");
        onStatusChange('idle');
      }
    );
  };

  return (
    <div style={styles.wrapper}>
      <label htmlFor="goal-input" style={styles.label}>Destination</label>

      <input
        id="goal-input"
        ref={inputRef}
        type="text"
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
        placeholder="e.g. the elevator, room 204, the exit"
        disabled={disabled}
        aria-label="Navigation destination"
        aria-describedby="goal-hint"
        style={{
          ...styles.input,
          borderColor: isListening ? colors.stop : colors.emerald,
          opacity: disabled ? 0.5 : 1,
        }}
      />

      {isRecognitionAvailable() && (
        <button
          type="button"
          onClick={handleMicClick}
          disabled={disabled}
          aria-label={isListening ? 'Stop listening' : 'Speak your destination'}
          style={{
            ...styles.speakButton,
            borderColor: isListening ? colors.stop : colors.emerald,
            color: isListening ? colors.stop : colors.emerald,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M6 11a6 6 0 0012 0M12 17v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {isListening ? 'Stop listening' : 'Speak instead'}
        </button>
      )}

      <span id="goal-hint" style={styles.hint}>
        {isListening ? 'Listening — speak your destination now' : 'Type or speak where you want to go'}
      </span>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  label: {
    font: `700 11px/1 ${fonts.body}`,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: colors.inkMuted, // inkFaint fails WCAG AA (3.1:1) for this small label; inkMuted passes
  },
  input: {
    width: '100%',
    padding: '16px',
    font: `700 20px/1 ${fonts.body}`,
    border: `1.5px solid ${colors.emerald}`,
    borderRadius: '14px',
    background: colors.surface,
    color: colors.ink,
    outline: 'none',
    minHeight: '58px',
    boxSizing: 'border-box',
  },
  speakButton: {
    width: '100%',
    minHeight: '58px',
    borderRadius: '14px',
    border: `1.5px solid ${colors.emerald}`,
    background: colors.surface,
    color: colors.emerald,
    font: `800 16px/1 ${fonts.display}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    cursor: 'pointer',
  },
  hint: {
    font: `400 13px/1.4 ${fonts.body}`,
    color: colors.inkMuted,
  },
};
