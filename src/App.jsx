// src/App.jsx

import { useState, useRef, useEffect, useCallback, Component } from 'react';
import { initCamera, stopCamera } from './modules/camera.js';
import { startLoop, stopLoop } from './modules/loop.js';
import { extractDestination } from './modules/destination.js';
import { isRecognitionAvailable, startRecognition } from './modules/recognition.js';
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
  const [showOnboarding, setShowOnboarding] = useState(false);

  // --- Refs ---
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const startTimeoutRef = useRef(null);
  const recognitionStopRef = useRef(null);

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

  // --- Begin camera + navigation loop for a resolved destination ---
  const beginNavigation = useCallback(async (cleanedGoal) => {
    setGoal(cleanedGoal);
    loopStateRef.current = { ...loopStateRef.current, goal: cleanedGoal };

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
      startTimeoutRef.current = setTimeout(() => {
        startTimeoutRef.current = null;
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

  }, [handleSpeak, handleContextUpdate, handleArrival, handleError]);

  // --- Start navigation (manual Start button) ---
  const handleStart = useCallback(async () => {
    if (!goal.trim()) return;
    if (status === 'navigating') return;

    const { destination: cleanedGoal } = await extractDestination(goal);
    beginNavigation(cleanedGoal);
  }, [goal, status, beginNavigation]);

  // --- Auto-listen for a destination on launch ---
  const listenForDestinationRef = useRef(null);
  const listenForDestination = useCallback(() => {
    setStatus('listening');
    speak('Listening for your destination.');

    let autoListenSettled = false;
    const watchdog = setTimeout(() => {
      if (autoListenSettled) return;
      autoListenSettled = true;
      recognitionStopRef.current?.();
      setStatus('idle');
      speak("I didn't hear a response. Please tap the microphone button to try again.");
    }, 4000);

    recognitionStopRef.current = startRecognition(
      async (transcript) => {
        autoListenSettled = true;
        clearTimeout(watchdog);
        setGoal(transcript);
        const { destination: cleanedGoal, ambiguous } = await extractDestination(transcript);
        setGoal(cleanedGoal);

        if (!ambiguous) {
          setStatus('idle');
          speak(`Heading to ${cleanedGoal}.`);
          beginNavigation(cleanedGoal);
          return;
        }

        // Uncertain transcript — confirm before doing anything irreversible (camera init, navigation)
        setStatus('listening');
        speak(`Did you say ${cleanedGoal}? Say yes or no.`);
        recognitionStopRef.current = startRecognition(
          (answer) => {
            setStatus('idle');
            if (answer.trim().toLowerCase().includes('yes')) {
              speak(`Heading to ${cleanedGoal}.`);
              beginNavigation(cleanedGoal);
            } else {
              speak('Okay, let’s try again.');
              listenForDestinationRef.current();
            }
          },
          () => {
            setStatus('idle');
            speak('Please type your destination or tap the mic to try again.');
          }
        );
      },
      () => {
        autoListenSettled = true;
        clearTimeout(watchdog);
        setStatus('idle');
        speak("Didn't catch that. Please type your destination or tap the mic to try again.");
      }
    );
  }, [beginNavigation]);

  useEffect(() => {
    listenForDestinationRef.current = listenForDestination;
  }, [listenForDestination]);

  useEffect(() => {
    if (!isRecognitionAvailable()) {
      speak('Voice recognition is not available. Please type your destination.');
      return;
    }
    listenForDestinationRef.current();
    return () => recognitionStopRef.current?.();
  }, []); // mount only

  // --- Stop navigation ---
  const handleStop = useCallback(async () => {
    if (startTimeoutRef.current !== null) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    stopLoop();
    resetSpeech();
    if (streamRef.current) {
      await stopCamera(streamRef.current);
      streamRef.current = null;
    }
    setStatus('idle');
    setLastSpoken('');
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (startTimeoutRef.current !== null) {
        clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
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
      <div style={styles.container}>
        <CameraPreview videoRef={videoRef} />

        <div style={styles.content}>
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
  title: {
    color: '#ffffff',
    fontSize: '28px',
    fontWeight: '700',
    margin: 0,
    letterSpacing: '-0.02em',
  },
};
