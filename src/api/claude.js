const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

if (!API_KEY) {
  throw new Error('VITE_ANTHROPIC_API_KEY is not set.');
}

/**
 * @param {string} systemPrompt
 * @param {Array} messages       - Anthropic messages array
 * @returns {Promise<object>}    - Parsed JSON from Claude
 * @throws {Error}               - On network failure or non-200 response
 */
export async function callClaude(systemPrompt, messages) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,  // 300 risks truncating multi-obstacle JSON mid-stream; 500 provides headroom
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  try {
    return JSON.parse(text);
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
 * @returns {object}             - Anthropic user message object
 */
export function buildUserMessage(goal, context, base64Frame) {
  const contextText = context.length > 0
    ? `Prior directions: ${context.join(' → ')}`
    : 'No prior context.';

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Goal: ${goal}\n${contextText}\nAnalyze this frame.`,
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
