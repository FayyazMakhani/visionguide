# VisionGuide

## Overview

VisionGuide is a mobile-first, voice-first indoor navigation assistant for blind and low-vision users. The user states a destination out loud, points the phone forward, and receives short spoken guidance - assembled from the phone camera and Claude Vision - to reach it. It needs no building infrastructure (no beacons, floor plans, or pre-mapping) and runs entirely in the browser, calling the Anthropic API directly.

## Goals

1. Let a user navigate to a named destination in an unfamiliar indoor space without physical assistance.
2. Deliver spoken guidance and obstacle alerts quickly enough to act on (frame-to-speech under ~3s at p50).
3. Stay safe and honest: a supplement to a cane or guide dog, never a replacement, and never guess a path the camera cannot see.
4. Work on a standard phone with zero building infrastructure.
5. Remain fully operable hands-free and screen-reader-first (TalkBack / VoiceOver).

## Core User Flow

1. User opens the app; it auto-listens and speaks "Listening for your destination."
2. User speaks a destination in plain language ("the elevator", "I need to wash my hands").
3. Claude resolves the phrase to a clean destination; the app confirms it if the input was ambiguous.
4. On the first navigation of the day, the app speaks the safety disclaimer (keep using your cane).
5. The camera starts and a guided 4-direction scan looks for the destination or the most open path.
6. If the destination is not found, explore phase guides the user toward open space and signage.
7. Once the destination is visible, navigate phase gives short turn-by-turn spoken directions.
8. Throughout, an on-device CV layer fires fast hazard alerts for close obstacles and people.
9. On arrival (confirmed across two frames), the app announces "You have arrived at [goal]" and stops.
10. Stop is available at any time; the next Start always begins again at the scan phase.

## Features

### Voice Destination Entry
- Auto-listen on launch, plus a manual microphone button and a text fallback.
- Claude-based destination extraction from arbitrary phrasing, with an ambiguity check for noisy input.

### Guided Scan and Explore
- Gyroscope-gated 4-stop scan (ahead, right, behind, left) to find the goal or the most open direction.
- Explore phase keeps the user moving toward hallways and signage when the goal is not yet visible.

### Navigation Guidance
- Short (8-10 word), grounded, action-oriented directions from Claude Vision.
- Forward-only spatial language (never "behind"), dead-end and closed-door handling, and destination memory when the goal is briefly out of frame.

### Obstacle and Hazard Awareness
- Claude-reported obstacle urgency tiers: high interrupts speech, medium queues, low is logged only.
- Parallel on-device MediaPipe CV layer (~15 fps) for low-latency hazard alerts between Claude calls.

### Spoken Output and Accessibility
- Web Speech synthesis with an interrupt/queue model kept in sync with on-screen text.
- Screen-reader-first UI, WCAG AA contrast targets, large tap targets, and an analyzed-frame preview for sighted observers.

## Scope

### In Scope
- Single-session, single-destination indoor navigation on Chrome and Safari (Android and iOS).
- Voice and text destination entry; guided scan, explore, and navigate phases; obstacle and CV hazard alerts.
- Client-only architecture: the browser calls the Anthropic API directly; static file hosting only.

### Out Of Scope
- Multi-floor navigation, persistent cross-session memory, and user accounts or history.
- Pre-mapped floor plans, Bluetooth/NFC beacons, or any building-side infrastructure.
- Offline operation, haptic feedback, and on-demand scene description (deferred but architected).

## Success Criteria

- A user reaches a named destination without physical assistance in at least 80% of demo sessions.
- Frame-to-speech latency at or under 3s (p50); an obstacle is announced within ~4s of entering the frame.
- No crash or silent failure across a 5-10 minute session.
- Directions are non-repetitive (at most one identical repeat per 60s).
- The app is fully operable via screen reader without sighted assistance.
