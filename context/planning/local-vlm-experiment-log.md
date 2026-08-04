# Local VLM Experiment Log

Hackathon-scope exploration, not a numbered spec. No expectation or intent to
replace the current cloud architecture — this is purely "how well or badly
does a local model do," out of curiosity. Fill in results after each test;
do not pre-fill with assumed data.

## Purpose

Check whether a locally-hosted vision-language model, running via Ollama on
the developer's Mac, can produce output remotely comparable in quality to
the cloud Claude models VisionGuide currently uses (`claude-sonnet-4-6` for
scan/explore, `claude-haiku-4-5-20251001` for navigate — see
`src/constants.js`).

## Models under test

- `gemma3:12b` (Ollama, Q4_K_M — `vision` capability confirmed via `ollama show`)
- `qwen3.5:9b` (Ollama, Q4_K_M — `vision`, `tools`, `thinking` capabilities confirmed via `ollama show`)

## Step 1 method — no app code changes

Send the real navigate-phase system prompt (`buildSystemPrompt('navigate')`,
`src/prompts/system.js`) plus one real captured frame (base64 JPEG, same
format the app already produces) to Ollama's OpenAI-compatible endpoint
(`http://localhost:11434/v1/chat/completions`), one model at a time, and
compare against what the same frame produces from the live Claude API.

Checking for:
- Valid JSON matching the app's expected schema (`obstacles`,
  `navigation_direction`, `goal_found`, `goal_confidence`) — `claude.js`'s
  parser only strips a ` ```json ` fence, nothing else, so any extra text
  around the JSON breaks it.
- Whether `qwen3.5:9b`'s `thinking` capability leaks reasoning text before/
  around the JSON output.
- Rough plausibility of `navigation_direction`/`obstacles` content — a gut
  check, not a rigorous eval.
- Response latency, one model loaded at a time (Mac memory constraint).

## Test setup

- Mac: Apple M4, 16GB RAM. Non-essential apps closed (Terminal + VS Code only) before each run.
- Test frames: real iPhone photos in `src/assets/localmodel_test_img/` (`test_img.jpeg`, `blocked.jpeg`, `sign.jpeg`, `deadend_1.jpeg`, `deadend_2.jpeg`), each downscaled to 640px longer edge / JPEG q0.7 via `sips` to exactly match `camera.js`'s `MAX_FRAME_EDGE`/`JPEG_QUALITY` before sending.
- Full, real `buildSystemPrompt('navigation')` text sent verbatim (not a paraphrase) via a throwaway Node script (`fetch` to Ollama's OpenAI-compatible endpoint), not committed to the repo.
- One model loaded at a time; `ollama stop <model>` run between tests to free memory before loading the next.

## Results

| # | Model | Frame/scenario | Valid JSON? | Latency | Notes |
|---|---|---|---|---|---|
| 1 | `qwen3.5:9b` | desk/door scene, goal "the door" | No — empty content | 141s | `thinking` mode burned the full response budget on internal chain-of-thought and never got to writing the answer. A follow-up run with a trivial one-field schema *did* return valid JSON, but the reasoning trace revealed the model was pattern-matching to guessed benchmark-dataset answers ("this looks like a CLEVR-Ref+/Habitat sample, the typical answer is...") rather than describing the actual photo, and the field value itself (`"turn_left_60"`) didn't even match the app's expected free-text direction format. |
| 2 | `gemma3:12b` | desk/door scene, goal "the door" | Yes (fenced in ` ```json `, which `claude.js`'s existing fence-stripping already handles) | 40.5s | Correctly identified the visible door and said "Move forward toward the door."; obstacles listed were plausible (chair right/medium, computer equipment right/low) given the desk setup in frame. Only output issue: `goal_confidence: 0.9`/`goal_found: true` is arguably premature per the prompt's "immediately at hand, not merely visible" rule — the door is visible but not yet reached in this frame. Everything else schema-conformant. |
| 3 | `gemma3:12b` | `blocked.jpeg` — flat wall filling nearly the whole frame, goal "the elevator" (not visible) | Yes, schema-valid, but **wrong**: `path_blocked: false`, `navigation_direction: "Path is clear, continue ahead."` | 26.9s | Real failure, not just a format nit — this is exactly the dangerous case `buildSystemPrompt`'s `path_blocked` rule exists to prevent (routing the user into a wall). Frame does have a sliver of carpet floor visible at the bottom-right corner suggesting a turn, which the correct response would have been to route toward, not claim "clear ahead." |
| 4 | `gemma3:12b` | `sign.jpeg` — door with "MECHANICAL" placard, goal "the mechanical room" (matching) | Yes | 11.0s | Correct: `goal_found: true`, `goal_confidence: 0.95`, "Proceed forward toward the mechanical room." Sign is close/prominent, matches the closeness-before-arrival rule. |
| 5 | `gemma3:12b` | `sign.jpeg`, goal "the bathroom" (mismatched — same frame as #4) | Yes | 10.8s | Correct: `goal_found: false`, did not false-positive on the presence of *a* door/sign just because one was in frame — matched the signage-matching rule's intent. |
| 6 | `gemma3:12b` | `deadend_1.jpeg` — closet interior, wire shelving both sides, solid back wall, no doorway, goal "the elevator" (not visible) | Yes, schema-valid, but **wrong**: `path_blocked: false`, `navigation_direction: "Path is clear, continue ahead."` | 32.8s | Same failure as #3. Did notice the wire racks (listed as low-urgency obstacles left/right) but didn't connect "enclosed space, no opening" to `path_blocked`. This is the exact "back of an enclosed space (closet...)" case the prompt names explicitly. |
| 7 | `gemma3:12b` | `deadend_2.jpeg` — same closet, slightly different angle, goal "the elevator" | Yes, schema-valid, but **wrong**: `path_blocked: false`, `navigation_direction: "Path is clear, continue ahead."` | 10.5s | Same failure again — 3rd consecutive miss on this rule across 3 different dead-end frames (an angled hallway wall + 2 closet angles). |

**Latency caveat, and why:** `ollama ps` confirmed `gemma3:12b` ran at 100% GPU (Metal, not a CPU fallback) throughout — so the 10.5-40.5s range isn't a misconfiguration to fix, it's what this specific hardware actually does with this model. Two compounding reasons:
1. **Memory headroom.** The model is 8.9GB resident against 16GB total system RAM. After macOS and the Ollama server's own overhead, there's very little slack left for the KV cache, which plausibly forces more conservative/slower memory access patterns than a machine with 32GB+ would need.
2. **Image prefill cost.** Vision models tokenize the input image into a large number of "image tokens" that all have to be processed before the model writes its first output token — this prefill cost is why even the shortest-output tests (#4, #5, #7: short JSON, no obstacles) still took 10-11s, not near-zero. The output-length variation on top of that (test #2's 2-obstacle response vs. #7's empty-obstacles response) accounts for the rest of the spread within the 10-40s range.

For comparison, Claude's cloud API runs on dedicated data-center inference hardware provisioned for exactly this workload — an unshared, non-consumer setup — which is the more fundamental reason for the gap, not just this Mac's spec sheet.

## Decision

`qwen3.5:9b` is a no-go as tested — the `thinking` mode makes it too slow and too unreliable (confabulated reasoning) for this schema without extra work (disabling thinking / forcing a much larger max-token budget), and neither was attempted here since `gemma3:12b` already looked more promising.

`gemma3:12b` across 7 tests (1 desk scene, 3 dead-end/blocked-path variations, 2 sign scenarios, all schema-valid):
- Format: 7/7 schema-valid JSON.
- Signage matching (true-positive and true-negative): 2/2 correct — the most nuanced rule in the prompt, and it held up both ways.
- Path-blocked detection: **0/3** — consistently wrong across a slanted hallway wall and two different closet-interior angles, always defaulting to "Path is clear, continue ahead." instead of `path_blocked: true`. Not a fluke — a repeatable failure on the single most safety-critical rule in the prompt (it exists specifically to stop the app from routing someone into a wall or dead end).
- Latency: 10.5-40.5s, consistently 5-30x the cloud API's 1-3s, confirmed GPU-bound rather than misconfigured (see above).

**Net for this hackathon experiment:** `gemma3:12b` is a clear no-go for actually driving navigation as-is — the one rule it fails is the one where failure has real safety consequences, and the failure was consistent, not incidental. Format-following and signage-matching being solid is a genuinely interesting result on its own (it says the model *can* follow this prompt's structure and its hardest disambiguation rule), so a worthwhile follow-up if this gets picked up again later would be narrowing in on why `path_blocked` specifically fails — e.g. whether a more explicit/example-driven rule for this one field closes the gap — rather than writing off the model wholesale. Not pursuing that further today; this was purely an exploratory experiment with no intent to ship it.
