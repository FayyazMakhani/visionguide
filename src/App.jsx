// src/App.jsx

import { useState, useRef, useEffect, useCallback, Component } from 'react';
import { initCamera, stopCamera } from './modules/camera.js';
import { startLoop, stopLoop, rejectGoal } from './modules/loop.js';
import { extractDestination } from './modules/destination.js';
import { isRecognitionAvailable, startRecognition, startCommandListener } from './modules/recognition.js';
import { speak, cancel, resetSpeech } from './modules/speech.js';
import GoalInput from './components/GoalInput.jsx';
import StartStopButton from './components/StartStopButton.jsx';
import StatusDisplay from './components/StatusDisplay.jsx';
import CameraPreview from './components/CameraPreview.jsx';
import Onboarding from './components/Onboarding.jsx';

// Voice command, said any time mid-navigation, to reject the current direction/room
// and resume searching elsewhere — see handleRejectGoal in loop.js.
const REJECT_GOAL_PHRASES = ['not here', 'go back', 'wrong room', 'wrong place', 'keep looking', 'try again', "this isn't it"];

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
  const [lastFrame, setLastFrame] = useState(null);
  // Shown on every mount — the dismiss tap is the user gesture mobile
  // browsers require before they'll allow speechSynthesis/recognition to run.
  const [showOnboarding, setShowOnboarding] = useState(true);

  // --- Refs ---
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraInitInFlightRef = useRef(false);
  const startTimeoutRef = useRef(null);
  const recognitionStopRef = useRef(null);
  const commandListenerStopRef = useRef(null);

  // Keep loopStateRef in sync with state so the interval reads fresh values
  const loopStateRef = useRef({ goal, context });
  useEffect(() => {
    loopStateRef.current = { goal, context };
  }, [goal, context]);

  // --- Callbacks for the loop ---
  const handleSpeak = useCallback((text) => {
    setLastSpoken(text);
  }, []);

  const handleContextUpdate = useCallback((direction, frame) => {
    setContext(prev => [...prev.slice(-1), direction]); // Keep last 2
    setLastFrame(frame);
  }, []);

  const handleFrameCaptured = useCallback((frame) => {
    setLastFrame(frame);
  }, []);

  const handleError = useCallback((errorMsg) => {
    console.error('Navigation error:', errorMsg);
    // Loop continues — errors are handled inside loop.js with "Still scanning"
  }, []);

  // --- Shared teardown: release camera/wakelock + recognition, used by
  // handleStop and by the loop's own end-of-session callbacks (arrival/give-up) ---
  const teardownMedia = useCallback(async () => {
    if (startTimeoutRef.current !== null) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    recognitionStopRef.current?.();
    commandListenerStopRef.current?.();
    commandListenerStopRef.current = null;
    resetSpeech();
    if (streamRef.current) {
      const stream = streamRef.current;
      streamRef.current = null;
      await stopCamera(stream);
    }
  }, []);

  const handleArrival = useCallback(() => {
    teardownMedia().then(() => setStatus('arrived'));
  }, [teardownMedia]);

  // Loop gave up (explore phase timed out without finding the goal) —
  // the session has ended just as much as an explicit Stop, so release
  // camera/mic the same way.
  const handleGiveUp = useCallback(() => {
    teardownMedia().then(() => setStatus('idle'));
  }, [teardownMedia]);

  // --- Begin camera + navigation loop for a resolved destination ---
  const beginNavigation = useCallback(async (cleanedGoal) => {
    setGoal(cleanedGoal);
    loopStateRef.current = { ...loopStateRef.current, goal: cleanedGoal };

    // Initialize camera if not already running. Guard against a concurrent
    // call (e.g. double-tap) racing past this check before either assigns
    // streamRef — without the lock, the loser's stream would be silently
    // overwritten and orphaned with no way to ever stop it.
    if (!streamRef.current) {
      if (cameraInitInFlightRef.current) return;
      cameraInitInFlightRef.current = true;
      let stream;
      try {
        stream = await initCamera(videoRef.current);
      } catch {
        cameraInitInFlightRef.current = false;
        setLastSpoken('Camera access denied. Please allow camera and try again.');
        return;
      }
      cameraInitInFlightRef.current = false;
      if (streamRef.current) {
        stopCamera(stream); // orphaned by a concurrent call — release it
      } else {
        streamRef.current = stream;
      }
    }

    const startNavigating = () => {
      setStatus('navigating');
      setContext([]);
      setLastFrame(null);
      // Most common demo failure is holding the phone at the wrong angle — say so before the loop starts
      speak('Hold your phone at chest height, pointing forward.');
      startTimeoutRef.current = setTimeout(() => {
        startTimeoutRef.current = null;
        startLoop(videoRef.current, streamRef, loopStateRef, {
          onSpeak: handleSpeak,
          onContextUpdate: handleContextUpdate,
          onFrameCaptured: handleFrameCaptured,
          onArrival: handleArrival,
          onGiveUp: handleGiveUp,
          onError: handleError,
        });
        commandListenerStopRef.current = startCommandListener(REJECT_GOAL_PHRASES, rejectGoal);
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

  }, [handleSpeak, handleContextUpdate, handleFrameCaptured, handleArrival, handleGiveUp, handleError]);

  // --- Start navigation (manual Start button) ---
  const handleStart = useCallback(async () => {
    if (!goal.trim()) return;
    if (status === 'navigating') return;

    const { destination: cleanedGoal } = await extractDestination(goal);
    beginNavigation(cleanedGoal);
  }, [goal, status, beginNavigation]);

  // --- Auto-listen for a destination on launch ---
  const MAX_AUTO_RETRIES = 2;
  const listenForDestinationRef = useRef(null);
  const listenForDestination = useCallback((retryCount = 0) => {
    setStatus('listening');
    speak(retryCount === 0
      ? 'Listening for your destination.'
      : "I didn't hear you. Listening again.");

    const retryOrGiveUp = () => {
      setStatus('idle');
      if (retryCount < MAX_AUTO_RETRIES) {
        listenForDestinationRef.current(retryCount + 1);
      } else {
        speak('Please type your destination or tap the mic to try again.');
      }
    };

    let autoListenSettled = false;
    const watchdog = setTimeout(() => {
      if (autoListenSettled) return;
      autoListenSettled = true;
      recognitionStopRef.current?.();
      retryOrGiveUp();
    }, 10000);

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
          },
          cancel // barge-in: stop the "Did you say X?" prompt as soon as the user answers
        );
      },
      () => {
        // Watchdog may have already handled this (it aborts recognition,
        // which itself triggers this same onError) — don't double-speak.
        if (autoListenSettled) return;
        autoListenSettled = true;
        clearTimeout(watchdog);
        retryOrGiveUp();
      },
      cancel // barge-in: stop the "Listening for your destination" prompt as soon as the user speaks
    );
  }, [beginNavigation]);

  useEffect(() => {
    listenForDestinationRef.current = listenForDestination;
  }, [listenForDestination]);

  useEffect(() => {
    return () => recognitionStopRef.current?.();
  }, []); // mount only

  const handleOnboardingDismiss = useCallback(() => {
    sessionStorage.setItem('vg_visited', '1');
    setShowOnboarding(false);
    // This tap is the user gesture that unlocks speechSynthesis/recognition on
    // mobile Chrome — auto-listen must start from here, not from mount.
    if (!isRecognitionAvailable()) {
      speak('Voice recognition is not available. Please type your destination.');
      return;
    }
    listenForDestination();
  }, [listenForDestination]);

  // --- Stop navigation ---
  const handleStop = useCallback(async () => {
    stopLoop();
    await teardownMedia();
    setStatus('idle');
    setLastSpoken('');
    setLastFrame(null);
  }, [teardownMedia]);

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
        const stream = streamRef.current;
        streamRef.current = null;
        stopCamera(stream); // not awaited — cleanup effects are synchronous
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
            frame={lastFrame}
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
