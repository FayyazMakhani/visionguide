// src/components/StatusDisplay.jsx

const STATUS_LABELS = {
  idle: 'Ready',
  listening: 'Listening...',
  navigating: 'Navigating',
  arrived: 'Arrived',
};

export default function StatusDisplay({ status, lastSpoken, frame }) {
  return (
    // aria-live="assertive" ensures TalkBack announces all changes without user interaction
    <div
      aria-live="assertive"
      aria-atomic="true"
      style={styles.wrapper}
    >
      <div style={styles.statusLine}>
        <span style={{
          ...styles.dot,
          background: status === 'navigating' ? '#22c55e'
            : status === 'arrived' ? '#1a4fd6'
            : status === 'listening' ? '#b84c00'
            : '#555',
        }} />
        <span style={styles.statusText}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      {/* Visual-only aid for sighted observers (companion/demo/debugging) — not
          announced to the primary blind/low-vision user, hence outside the
          aria-live region above. */}
      {frame ? (
        <img
          src={`data:image/jpeg;base64,${frame}`}
          alt="Camera frame analyzed for this instruction"
          style={styles.frame}
        />
      ) : null}

      {lastSpoken ? (
        <p style={styles.lastSpoken}>
          {lastSpoken}
        </p>
      ) : null}
    </div>
  );
}

const styles = {
  wrapper: {
    padding: '16px',
    background: '#1a1a1a',
    borderRadius: '10px',
    border: '1px solid #333',
    minHeight: '80px',
  },
  statusLine: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    color: '#aaa',
    fontSize: '13px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  lastSpoken: {
    color: '#ffffff',
    fontSize: '18px',
    lineHeight: '1.5',
    margin: 0,
  },
  frame: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    borderRadius: '8px',
    marginBottom: '8px',
  },
};
