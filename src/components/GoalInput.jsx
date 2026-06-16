import { isRecognitionAvailable } from '../modules/recognition.js';

export default function GoalInput({ goal, onGoalChange, disabled, onMicClick, isListening }) {
  return (
    <div>
      <input
        type="text"
        aria-label="Navigation destination"
        autoFocus
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
        disabled={disabled}
        style={{ minHeight: '56px', fontSize: '18px' }}
      />
      {isRecognitionAvailable() && (
        <button
          type="button"
          aria-label="Speak your destination"
          onClick={onMicClick}
          disabled={disabled}
          style={{ minHeight: '56px', minWidth: '56px', fontSize: '18px' }}
        >
          {isListening ? 'Listening...' : '🎤'}
        </button>
      )}
    </div>
  );
}
