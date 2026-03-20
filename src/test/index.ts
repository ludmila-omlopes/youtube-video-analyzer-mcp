import { run as runChunkPlannerTests } from "./chunk-planner.test.js";
import { run as runGeminiStructuredOutputTests } from "./gemini-structured-output.test.js";
import { run as runGeminiLanguagePromptTests } from "./gemini-language-prompts.test.js";
import { run as runGeminiVideoPartTests } from "./gemini-video-parts.test.js";
import { run as runTaskStoreTests } from "./task-store.test.js";
import { run as runYouTubeTests } from "./youtube.test.js";

const suites = [
  ["chunk-planner", runChunkPlannerTests],
  ["gemini-structured-output", runGeminiStructuredOutputTests],
  ["gemini-language-prompts", runGeminiLanguagePromptTests],
  ["gemini-video-parts", runGeminiVideoPartTests],
  ["task-store", runTaskStoreTests],
  ["youtube", runYouTubeTests],
] as const;

async function main(): Promise<void> {
  for (const [name, run] of suites) {
    await run();
    console.log(`PASS ${name}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
