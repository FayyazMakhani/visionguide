// Renders the video element that keeps the camera stream alive.
// Hidden from view — the user never needs to see it.
export default function CameraPreview({ videoRef }) {
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
    />
  );
}
