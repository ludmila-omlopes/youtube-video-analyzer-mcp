import assert from "node:assert/strict";

import { buildAudioAnalysisPrompt, buildFollowUpPrompt, buildPrompt } from "../lib/gemini.js";
import { defaultAnalysisSchema, defaultAudioAnalysisSchema } from "../lib/schemas.js";

export async function run(): Promise<void> {
  const prompt = buildPrompt();
  assert.match(prompt, /Identify the dominant spoken or on-screen language/i);
  assert.match(prompt, /Write every natural-language field value in that detected language/i);
  assert.doesNotMatch(prompt, /Brazilian Portuguese/i);

  const followUpPrompt = buildFollowUpPrompt("Continue");
  assert.match(followUpPrompt, /Continue using the dominant language of the video/i);

  const audioPrompt = buildAudioAnalysisPrompt();
  assert.match(audioPrompt, /using only the audio track/i);
  assert.match(audioPrompt, /Ignore visual-only evidence/i);
  assert.match(audioPrompt, /timestamped transcript segments/i);

  const properties = defaultAnalysisSchema.properties as Record<string, unknown>;
  assert.ok(Object.hasOwn(properties, "detectedLanguage"));
  assert.deepEqual(defaultAnalysisSchema.required[0], "detectedLanguage");

  const audioProperties = defaultAudioAnalysisSchema.properties as Record<string, unknown>;
  assert.ok(Object.hasOwn(audioProperties, "transcriptSegments"));
}
