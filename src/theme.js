// Clarity design tokens (11-visionguide-clarity-redesign-spec.md).
// Shared constants so the screens use one palette — not a CSS framework,
// consistent with the repo's inline-styles convention.

export const colors = {
  ink: '#0E1A17',          // primary text
  inkMuted: '#516660',     // secondary text
  inkFaint: '#8a958f',     // labels / eyebrows
  emerald: '#06857A',      // primary brand / actions
  emeraldTint: '#E2F4F0',  // light fills
  accent: '#11A892',
  surface: '#FFFFFF',      // light screen background
  page: '#FFFFFF',         // app/body background
  dark: '#0d1426',         // navigating background (behind frame)
  stop: '#D63B3B',         // stop action
  warnBg: '#FFF1E2',
  warnBorder: '#FFD9AE',
  warnIcon: '#C25A00',
  warnText: '#9A4A00',
  white: '#FFFFFF',
};

export const fonts = {
  display: "'Public Sans', system-ui, sans-serif",        // headings, buttons, numbers
  body: "'Atkinson Hyperlegible', system-ui, sans-serif", // body, input, instruction text
};
