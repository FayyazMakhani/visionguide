import { getLandmarkContext } from '../modules/landmarks.js';
import { getGoalMemoryHint } from '../modules/goalMemory.js';
import { getSpatialMemoryHint } from '../modules/spatialMemory.js';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

if (!API_KEY) {
  throw new Error('VITE_ANTHROPIC_API_KEY is not set.');
}

/**
 * @param {string} systemPrompt
 * @param {Array} messages       - Anthropic messages array
 * @param {AbortSignal} [signal] - Aborts the in-flight request (e.g. on Stop)
 * @param {string} [model]       - Anthropic model id; defaults to Sonnet
 * @returns {Promise<object>}    - Parsed JSON from Claude
 * @throws {Error}               - 'network_failure' | 'rate_limited' | 'api_error_<status>' | DOMException 'AbortError'
 */
export async function callClaude(systemPrompt, messages, signal, model = 'claude-sonnet-4-6') {
  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,  // 300 risks truncating multi-obstacle JSON mid-stream; 500 provides headroom
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }),
      signal,
    });
  } catch (networkErr) {
    // Propagate abort as-is — it's an intentional cancellation (e.g. Stop), not a network failure
    if (networkErr.name === 'AbortError') throw networkErr;
    console.warn('Network error:', networkErr.message);
    throw new Error('network_failure', { cause: networkErr });
  }

  if (response.status === 429) {
    console.warn('Rate limited by Anthropic API');
    throw new Error('rate_limited');
  }

  if (!response.ok) {
    console.warn('Anthropic API error:', response.status);
    throw new Error(`api_error_${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  // Claude sometimes wraps the JSON in a ```json ... ``` code fence despite
  // the system prompt asking for raw JSON — strip it before parsing.
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Truncated or malformed JSON — log for debugging, return safe default so loop continues
    console.warn('JSON parse failed. Raw response:', text);
    return {
      obstacles: [],
      navigation_direction: '',
      goal_found: false,
      goal_confidence: 0,
    };
  }
}

/**
 * @param {string} goal          - User's destination string
 * @param {string[]} context     - Last 2 navigation_direction strings
 * @param {string} base64Frame   - JPEG base64 string (no data: prefix)
 * @param {string} [scanSummary] - One-line summary of the 4-direction scan results
 * @param {string} [cvContext]   - On-device CV scene line (spec 12), e.g.
 *                                 "CV: person center (high risk)"; null when nothing qualifies
 * @returns {object}             - Anthropic user message object
 */
export function buildUserMessage(goal, context, base64Frame, scanSummary, cvContext) {
  const contextText = context.length > 0
    ? `Prior directions: ${context.join(' → ')}`
    : 'No prior context.';

  const landmarkText = getLandmarkContext();
  const goalMemoryHint = getGoalMemoryHint();
  const spatialMemoryHint = getSpatialMemoryHint();

  const textParts = [
    cvContext,        // null when no qualifying CV objects — dropped by .filter(Boolean)
    `Goal: ${goal}`,
    contextText,
    scanSummary,
    landmarkText,
    goalMemoryHint,
    spatialMemoryHint,
    'Analyze this frame.',
  ].filter(Boolean).join('\n');

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: textParts,
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Frame,
        },
      },
    ],
  };
}

/**
 * @param {string} rawGoal - raw user utterance/typed text
 * @returns {object}        - Anthropic user message object (text-only, no image)
 */
export function buildDestinationMessage(rawGoal) {
  return {
    role: 'user',
    content: [{ type: 'text', text: rawGoal }],
  };
}
