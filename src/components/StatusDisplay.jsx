// src/components/StatusDisplay.jsx
// Small aria-live announcement strip for the Set-destination screen — surfaces
// errors/prompts like "Camera access denied". The navigating instruction banner
// and analyzed-frame preview now live in NavigatingView.

import { colors, fonts } from '../theme.js';

export default function StatusDisplay({ lastSpoken }) {
  if (!lastSpoken) return null;

  return (
    <p
      aria-live="assertive"
      aria-atomic="true"
      style={styles.text}
    >
      {lastSpoken}
    </p>
  );
}

const styles = {
  text: {
    font: `700 15px/1.5 ${fonts.body}`,
    color: colors.inkMuted,
    margin: 0,
  },
};
