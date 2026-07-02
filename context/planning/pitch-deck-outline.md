# VisionGuide Pitch Deck — Outline

Per Week 4 spec §13. Design rules: black background / white text, max 4 points per slide,
minimum 24px font for projection. Build the actual deck (slides) from this outline.

## Slide 1 — Problem
- 285 million people are visually impaired worldwide
- GPS does not work indoors
- Existing solutions require building-specific infrastructure (BLE beacons, pre-mapped floor plans)
- No scalable, infrastructure-free solution exists

## Slide 2 — Solution
- VisionGuide: AI-powered indoor navigation using only a smartphone camera
- Real-time spoken directions, obstacle alerts, goal detection
- Works in any building, on first visit, with no pre-installation

## Slide 3 — How It Works
- Simple two-step architecture diagram: Browser → Claude Vision API
- 1 fps frame capture → Claude analyzes scene → spoken direction
- Key stat: ~3 second latency, $0.003 per API call

## Slide 4 — Demo
- Play demo video OR run live demo
- Call out: obstacle detection alert, navigation direction, arrival announcement

## Slide 5 — Architecture
- Vite + React PWA
- Direct browser → Anthropic API (no backend)
- Web Speech API for TTS and voice input
- Chrome on Android
- [ ] Export the architecture diagram SVG from the PRD HTML for this slide

## Slide 6 — Limitations & Roadmap
- Honest: ~3-5s latency, 1fps, supplement not replacement for mobility aids
- Roadmap: multi-floor navigation, offline on-device model, iOS support, BLE landmark anchoring

## Slide 7 — Team
- [fill in: names, roles]
