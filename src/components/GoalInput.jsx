// src/components/GoalInput.jsx

import { useEffect, useRef } from 'react';
import { isRecognitionAvailable, startRecognition } from '../modules/recognition.js';
import { speak } from '../modules/speech.js';

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
      <label
        htmlFor="goal-input"
        style={styles.label}
      >
        Where do you want to go?
      </label>

      <div style={styles.row}>
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
            opacity: disabled ? 0.5 : 1,
          }}
        />

        {isRecognitionAvailable() && (
          <button
            onClick={handleMicClick}
            disabled={disabled}
            aria-label={isListening ? 'Stop listening' : 'Speak your destination'}
            style={{
              ...styles.micButton,
              background: isListening ? '#b84c00' : '#1a4fd6',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {isListening ? '■' : '🎤'}
          </button>
        )}
      </div>

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
    gap: '8px',
  },
  label: {
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: '500',
  },
  row: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    fontSize: '18px',
    border: '1px solid #444',
    borderRadius: '8px',
    background: '#1a1a1a',
    color: '#ffffff',
    outline: 'none',
    minHeight: '56px',
  },
  micButton: {
    width: '56px',
    height: '56px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  hint: {
    color: '#999999',
    fontSize: '13px',
  },
};
