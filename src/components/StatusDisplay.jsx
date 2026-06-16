// Display-only status and last-spoken text. Announced via aria-live for TalkBack.
export default function StatusDisplay({ status, lastSpoken }) {
  return (
    <div aria-live="assertive">
      <p style={{ fontSize: '24px' }}>{status}</p>
      <p style={{ fontSize: '18px' }}>{lastSpoken}</p>
    </div>
  );
}
