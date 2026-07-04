# VisionGuide

VisionGuide is a mobile-first, voice-first navigation assistant for blind and low-vision users. It combines the phone camera, microphone, and Claude-powered vision understanding to provide spoken guidance for indoor navigation.

## What VisionGuide does

VisionGuide helps a user navigate an environment by:

- listening for a destination through voice or text input
- auto-listening for a destination when the app opens
- scanning the surroundings with the camera and AI
- speaking short, actionable navigation instructions
- warning about obstacles and blocked paths
- supporting stop, arrival, and retry flows

The experience is designed to be simple and hands-free: the user can start a session, point the phone forward, and follow spoken guidance while keeping their hands free.

## Core features

- Voice-first destination entry with speech recognition and text fallback
- Camera-based scene understanding using Claude Vision through the Anthropic API
- Guided scan, explore, and navigate phases for indoor wayfinding
- Spoken guidance with obstacle and path-blocking awareness
- Frame preview support so a sighted observer can see what the AI is analyzing
- Onboarding, safety messaging, and graceful stop/arrival handling

## Tech stack

- React 19 with Vite
- JavaScript and JSX
- Web APIs for camera access, speech recognition, speech synthesis, and device motion
- Anthropic Claude API for destination extraction and navigation reasoning
- ESLint and Vite build tooling

## Repository structure

- src/App.jsx — main app state and navigation flow
- src/components/ — UI views such as onboarding, destination entry, status, navigating, and arrival screens
- src/modules/ — camera, speech, loop, destination extraction, recognition, gyroscope, landmarks, memory, and obstacle handling
- src/api/claude.js — Claude API integration and prompt message construction
- src/prompts/system.js — system prompts for destination extraction and navigation reasoning
- context/ — product specs, implementation notes, workflow rules, and progress tracking
- public/ — static assets

## Running locally

1. Install dependencies:
   `npm install`
2. Create a local environment file with your Anthropic API key:
   `VITE_ANTHROPIC_API_KEY=your_key_here`
3. Start the development server:
   `npm run dev`
4. Open the local Vite URL in a browser and allow camera and microphone permissions.

## Build

To create a production build, run:

`npm run build`

## Notes

VisionGuide is an assistive prototype and should be used alongside a cane or other mobility aid. A valid Anthropic API key is required for the AI navigation features.
