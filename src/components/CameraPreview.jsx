// Renders the video element that keeps the camera stream alive.
// By default it is hidden — the user (a visually impaired person) never needs to see it.
// When `visible` is true (demo toggle on), it becomes a full-screen background so a
// sighted demo audience can see the feed Claude Vision is analysing. Kept aria-hidden always.
export default function CameraPreview({ videoRef, visible }) {
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-hidden="true"
      style={visible ? visibleStyle : hiddenStyle}
    />
  );
}

// width/height clamped so the intrinsic-resolution video can't overflow the
// viewport horizontally (which would mis-anchor the fixed demo toggle button).
// Frame capture is unaffected — getFrame() draws from the video's intrinsic size.
const hiddenStyle = { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' };

const visibleStyle = {
  position: 'fixed',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  zIndex: 0,
  pointerEvents: 'none',
  backgroundColor: '#0f0f0f', // match the dark theme before the camera stream starts
};
