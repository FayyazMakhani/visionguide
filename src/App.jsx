// src/App.jsx

import { useState, useRef, useEffect, useCallback, Component } from 'react';
import { initCamera, stopCamera } from './modules/camera.js';
import { DEMO_MODE } from './constants.js';
import { startLoop, stopLoop } from './modules/loop.js';
import { speak, cancel, resetSpeech } from './modules/speech.js';
import GoalInput from './components/GoalInput.jsx';
import StartStopButton from './components/StartStopButton.jsx';
import StatusDisplay from './components/StatusDisplay.jsx';
import CameraPreview from './components/CameraPreview.jsx';
import Onboarding from './components/Onboarding.jsx';

// Standard React error boundary (setup spec §13.4). On error, speaks and shows a reload button.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
    speak('Something went wrong. Please reload.');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert">
          <p>Something went wrong. Please reload.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // --- State ---
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState('idle');
  // 'idle' | 'listening' | 'navigating' | 'arrived'
  const [lastSpoken, setLastSpoken] = useState('');
  const [context, setContext] = useState([]);
  const [showOnboarding, setShowOnboarding] = useState(
    !sessionStorage.getItem('vg_visited')
  );
  // Demo-only: presenter toggles the live camera feed as a background. Off by default.
  const [showCameraPreview, setShowCameraPreview] = useState(false);

  // --- Refs ---
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Keep loopStateRef in sync with state so the interval reads fresh values
  const loopStateRef = useRef({ goal, context });
  useEffect(() => {
    loopStateRef.current = { goal, context };
  }, [goal, context]);

  // --- Callbacks for the loop ---
  const handleSpeak = useCallback((text) => {
    setLastSpoken(text);
  }, []);

  const handleContextUpdate = useCallback((direction) => {
    setContext(prev => [...prev.slice(-1), direction]); // Keep last 2
  }, []);

  const handleArrival = useCallback(() => {
    setStatus('arrived');
  }, []);

  const handleError = useCallback((errorMsg) => {
    console.error('Navigation error:', errorMsg);
    // Loop continues — errors are handled inside loop.js with "Still scanning"
  }, []);

  const handleOnboardingDismiss = useCallback(() => {
    sessionStorage.setItem('vg_visited', '1');
    setShowOnboarding(false);
    // Speak the onboarding summary for screen reader users
    speak('Welcome to VisionGuide. Type or speak your destination, then tap Start Navigation.');
  }, []);

  // --- Start navigation ---
  const handleStart = useCallback(async () => {
    if (!goal.trim()) return;
    if (status === 'navigating') return;

    // Initialize camera if not already running
    if (!streamRef.current) {
      try {
        streamRef.current = await initCamera(videoRef.current);
      } catch {
        setLastSpoken('Camera access denied. Please allow camera and try again.');
        return;
      }
    }

    const startNavigating = () => {
      setStatus('navigating');
      setContext([]);
      // Most common demo failure is holding the phone at the wrong angle — say so before the loop starts
      speak('Hold your phone at chest height, pointing forward.');
      setTimeout(() => {
        startLoop(videoRef.current, streamRef, loopStateRef, {
          onSpeak: handleSpeak,
          onContextUpdate: handleContextUpdate,
          onArrival: handleArrival,
          onError: handleError,
        });
      }, 2500); // Wait for holding instruction to finish
    };

    // Safety disclaimer — only spoken on the first navigation start of the day
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('vg_safety_date') === today) {
      startNavigating();
    } else {
      const safetyUtterance = new SpeechSynthesisUtterance(
        'VisionGuide is a navigation aid only. Keep using your cane or other mobility aid.'
      );
      safetyUtterance.onend = () => {
        localStorage.setItem('vg_safety_date', today);
        startNavigating();
      };
      window.speechSynthesis.speak(safetyUtterance);
    }

  }, [goal, status, handleSpeak, handleContextUpdate, handleArrival, handleError]);

  // --- Stop navigation ---
  const handleStop = useCallback(() => {
    stopLoop();
    resetSpeech();
    setStatus('idle');
    setLastSpoken('');
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      stopLoop();
      cancel();
      if (streamRef.current) {
        stopCamera(streamRef.current);
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <ErrorBoundary>
      {showOnboarding && <Onboarding onDismiss={handleOnboardingDismiss} />}
      <div style={showCameraPreview ? { ...styles.container, background: 'transparent' } : styles.container}>
        <CameraPreview videoRef={videoRef} visible={showCameraPreview} />
        {showCameraPreview && <div style={styles.demoScrim} aria-hidden="true" />}

        {DEMO_MODE && (
          <button
            type="button"
            onClick={() => setShowCameraPreview(v => !v)}
            aria-label="Toggle camera preview background"
            aria-pressed={showCameraPreview}
            style={{ ...styles.demoToggle, color: showCameraPreview ? '#22c55e' : '#ef4444' }}
          >
            {showCameraPreview ? 'Hide camera' : 'Show camera'}
          </button>
        )}

        <div style={showCameraPreview ? { ...styles.content, position: 'relative', zIndex: 1 } : styles.content}>
          <h1 style={styles.title}>VisionGuide</h1>

          <GoalInput
            goal={goal}
            onGoalChange={setGoal}
            disabled={status === 'navigating'}
            isListening={status === 'listening'}
            onStatusChange={setStatus}
          />

          <StartStopButton
            status={status}
            onStart={handleStart}
            onStop={handleStop}
            disabled={!goal.trim() || status === 'listening'}
          />

          <StatusDisplay
            status={status}
            lastSpoken={lastSpoken}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f0f',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  content: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  // Demo-only: darkens the live camera feed so the UI text stays legible over it.
  demoScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 15, 15, 0.55)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  // Demo-only: presenter control to show/hide the camera feed during a pitch.
  demoToggle: {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: 2,
    width: '120px',          // fixed so the box doesn't resize between "Show"/"Hide"
    textAlign: 'center',
    padding: '8px 0',
    fontSize: '14px',
    fontWeight: 600,
    background: 'rgba(40, 40, 40, 0.85)',
    border: '2px solid',     // border color follows the text color (currentColor)
    borderRadius: '8px',
    cursor: 'pointer',
  },
  title: {
    color: '#ffffff',
    fontSize: '28px',
    fontWeight: '700',
    margin: 0,
    letterSpacing: '-0.02em',
  },
};
