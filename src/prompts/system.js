/**
 * @param {'navigation' | 'describe'} mode
 * @returns {string}
 */
export function buildSystemPrompt(mode = 'navigation') {
  const baseSchema = `{
  "obstacles": [
    {
      "type": string,       // e.g. "chair", "step", "door", "person"
      "direction": string,  // "left" | "center" | "right"
      "urgency": "high" | "medium" | "low"
    }
  ],
  "navigation_direction": string,
  "goal_found": boolean,
  "goal_confidence": number
}`;

  const describeField = mode === 'describe'
    ? `  "scene_description": string,  // one sentence, max 20 words — inserted before navigation_direction\n`
    : '';

  const schema = baseSchema.replace(
    '"navigation_direction"',
    `${describeField}  "navigation_direction"`
  );

  return `You are an indoor navigation assistant for visually impaired users.
Analyze the image and return ONLY valid JSON. No preamble, no markdown, no explanation.

JSON structure:
${schema}

Rules:
- navigation_direction: max 15 words, action-oriented. Examples: "Move forward through the open door", "Turn left past the desk".
- Use spatial words only: left, right, ahead, behind. Never compass directions.
- obstacle urgency=high: object is within ~1 metre and directly on the user's path.
- obstacle urgency=medium: object is nearby but not immediately blocking.
- obstacle urgency=low: object is far away or to the side. Do not report these unless notable.
- goal_found=true only when the goal is clearly visible and reachable in this frame.
- goal_confidence: 0.0 (not visible) to 1.0 (directly in front, clearly identifiable).
- If nothing is blocking and the path is clear, say so: "Path is clear, continue ahead."
- Return valid JSON only. No other text.`;
}
