// src/components/DetectionOverlay.jsx
// Demo-only bounding-box overlay (13-visionguide-detection-overlay-spec.md).
// Purely cosmetic — aria-hidden, no effect on hazard alerts or navigation.

import { colors, fonts } from '../theme.js';

const RISK_COLOR = {
  high: colors.stop,
  medium: colors.warnIcon,
};

export default function DetectionOverlay({ detections }) {
  if (!detections || detections.length === 0) return null;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      style={styles.svg}
      aria-hidden="true"
    >
      {detections.map(({ obj, risk }) => {
        const { originX, originY, width, height } = obj.boundingBox;
        const x = originX * 100;
        const y = originY * 100;
        const color = RISK_COLOR[risk];
        // Chip sized to the label text and anchored at the box's own top-left
        // corner (not above it), so it can never render off-canvas.
        const chipWidth = obj.label.length * 2.6 + 2;
        const chipHeight = 4.2;

        return (
          <g key={obj.id}>
            <rect x={x} y={y} width={width * 100} height={height * 100} fill="none" stroke={color} strokeWidth="0.6" />
            <rect x={x} y={y} width={chipWidth} height={chipHeight} fill={color} />
            <text x={x + 1} y={y + chipHeight - 1.1} style={styles.label}>{obj.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

const styles = {
  svg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  label: {
    font: `700 3.2px ${fonts.body}`,
    fill: colors.white,
  },
};
