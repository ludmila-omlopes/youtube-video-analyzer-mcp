import assert from "node:assert/strict";

import { buildFollowUpPrompt, buildPrompt } from "../lib/gemini.js";
import { defaultAnalysisSchema } from "../lib/schemas.js";

export async function run(): Promise<void> {
  const prompt = buildPrompt();
  assert.match(prompt, /Identify the dominant spoken or on-screen language/i);
  assert.match(prompt, /Write every natural-language field value in that detected language/i);
  assert.doesNotMatch(prompt, /Brazilian Portuguese/i);

  const followUpPrompt = buildFollowUpPrompt("Continue");
  assert.match(followUpPrompt, /Continue using the dominant language of the video/i);

  const properties = defaultAnalysisSchema.properties as Record<string, unknown>;
  assert.ok(Object.hasOwn(properties, "detectedLanguage"));
  assert.deepEqual(defaultAnalysisSchema.required[0], "detectedLanguage");
}
