const LABELS = {
  idle: 'Start Navigation',
  arrived: 'Start Navigation',
  navigating: 'Stop',
  listening: 'Listening...',
};

export default function StartStopButton({ status, onStart, onStop, disabled }) {
  const label = LABELS[status];
  const isNavigating = status === 'navigating';
  const isListening = status === 'listening';

  return (
    <button
      type="button"
      aria-label={label}
      disabled={isListening || disabled}
      onClick={isNavigating ? onStop : onStart}
      style={{ minHeight: '56px', fontSize: '24px' }}
    >
      {label}
    </button>
  );
}
