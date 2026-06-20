import { callClaude, buildDestinationMessage } from '../api/claude.js';
import { buildDestinationExtractionPrompt } from '../prompts/system.js';

/**
 * Extract just the destination from an arbitrary user utterance via Claude.
 * Falls back to the trimmed raw input if extraction fails or returns nothing usable.
 * @param {string} rawGoal
 * @returns {Promise<{destination: string, ambiguous: boolean}>}
 */
export async function extractDestination(rawGoal) {
  const trimmed = rawGoal.trim();
  if (!trimmed) return { destination: trimmed, ambiguous: false };

  try {
    const result = await callClaude(
      buildDestinationExtractionPrompt(),
      [buildDestinationMessage(trimmed)]
    );
    const destination = typeof result.destination === 'string' ? result.destination.trim() : '';
    return { destination: destination || trimmed, ambiguous: Boolean(result.ambiguous) };
  } catch (err) {
    console.warn('Destination extraction failed, using raw input:', err.message);
    return { destination: trimmed, ambiguous: false };
  }
}
