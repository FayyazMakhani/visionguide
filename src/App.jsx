import { useState, useRef, useCallback, useEffect, Component } from 'react';
import GoalInput from './components/GoalInput.jsx';
import StartStopButton from './components/StartStopButton.jsx';
import StatusDisplay from './components/StatusDisplay.jsx';
import CameraPreview from './components/CameraPreview.jsx';
import { initCamera, stopCamera } from './modules/camera.js';
import { startLoop, stopLoop } from './modules/loop.js';
import { startRecognition } from './modules/recognition.js';
import { speak } from './modules/speech.js';
import { resetGoalTracker } from './modules/goalTracker.js';

// Standard React error boundary. On error, speaks and shows a reload button.
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

// Root component. Owns all state. Wires state to modules and components only — no business logic here.
function App() {
  const [goal, setGoal] = useState('');               // User's navigation destination
  const [status, setStatus] = useState('idle');        // 'idle' | 'listening' | 'navigating' | 'arrived'
  const [lastSpoken, setLastSpoken] = useState('');    // Last TTS string, shown on screen
  const [context, setContext] = useState([]);          // Last 2 navigation_direction strings

  const videoRef = useRef(null);
  const cameraRef = useRef(null);   // MediaStream from initCamera
  const stateRef = useRef({ goal, context });
  useEffect(() => {
    stateRef.current = { goal, context };
  }, [goal, context]);

  const handleMicClick = useCallback(() => {
    setStatus('listening');
    speak('Listening...');
    startRecognition(
      (result) => {
        setGoal(result);
        setStatus('idle');
        speak(`I heard: ${result}. Tap Start to begin.`);
      },
      () => {
        setStatus('idle');
        speak("Didn't catch that. Please try again or type your destination.");
      }
    );
  }, []);

  const handleStart = useCallback(async () => {
    if (!goal) return;
    resetGoalTracker();
    setContext([]);
    setStatus('navigating');

    // Safety prompt (mandatory): plays every session, before the navigation loop begins, cannot be skipped
    speak('VisionGuide is a navigation aid only. Keep using your cane or other mobility aid.');

    try {
      cameraRef.current = await initCamera(videoRef.current);
    } catch {
      setStatus('idle');
      return;
    }

    startLoop(videoRef.current, stateRef, {
      onSpeak: setLastSpoken,
      onContextUpdate: (direction) => setContext(prev => [...prev.slice(-1), direction]),
      onArrival: () => setStatus('arrived'),
    });
  }, [goal]);

  const handleStop = useCallback(() => {
    stopLoop();
    stopCamera(cameraRef.current);
    cameraRef.current = null;
    setStatus('idle');
  }, []);

  return (
    <ErrorBoundary>
      <CameraPreview videoRef={videoRef} />
      <GoalInput
        goal={goal}
        onGoalChange={setGoal}
        disabled={status === 'navigating'}
        onMicClick={handleMicClick}
        isListening={status === 'listening'}
      />
      <StartStopButton
        status={status}
        onStart={handleStart}
        onStop={handleStop}
        disabled={!goal}
      />
      <StatusDisplay status={status} lastSpoken={lastSpoken} />
    </ErrorBoundary>
  );
}

export default App;
