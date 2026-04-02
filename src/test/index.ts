import { run as runChunkPlannerTests } from "./chunk-planner.test.js";
import { run as runCloudSessionStoreTests } from "./cloud-session-store.test.js";
import { run as runGeminiStructuredOutputTests } from "./gemini-structured-output.test.js";
import { run as runGeminiLanguagePromptTests } from "./gemini-language-prompts.test.js";
import { run as runGeminiVideoPartTests } from "./gemini-video-parts.test.js";
import { run as runHostedDevTests } from "./hosted-dev.test.js";
import { run as runHttpAuthTests } from "./http-auth.test.js";
import { run as runHttpMcpTests } from "./http-mcp.test.js";
import { run as runOAuthValidationTests } from "./oauth-validation.test.js";
import { run as runPrincipalScopedLongAnalysisJobsTests } from "./principal-scoped-long-analysis-jobs.test.js";
import { run as runPrincipalScopedServiceTests } from "./principal-scoped-service.test.js";
import { run as runPrincipalScopedSessionStoreTests } from "./principal-scoped-session-store.test.js";
import { run as runPublicRemoteServiceTests } from "./public-remote-service.test.js";
import { run as runQueueDashboardTests } from "./queue-dashboard.test.js";
import { run as runRemoteAccessStoreTests } from "./remote-access-store.test.js";
import { run as runRemoteAccountTests } from "./remote-account.test.js";
import { run as runServerAudioToolTests } from "./server-audio-tool.test.js";
import { run as runServerAsyncLongToolTests } from "./server-async-long-tool.test.js";
import { run as runServerFollowUpToolTests } from "./server-follow-up-tool.test.js";
import { run as runServerLongToolTests } from "./server-long-tool.test.js";
import { run as runServerMetadataToolTests } from "./server-metadata-tool.test.js";
import { run as runServerShortToolTests } from "./server-short-tool.test.js";
import { run as runSessionStoreTests } from "./session-store.test.js";
import { run as runTaskStoreTests } from "./task-store.test.js";
import { run as runVideoAnalysisServiceTests } from "./video-analysis-service.test.js";
import { run as runYouTubeMetadataTests } from "./youtube-metadata.test.js";
import { run as runYouTubeTests } from "./youtube.test.js";

const suites = [
  ["chunk-planner", runChunkPlannerTests],
  ["cloud-session-store", runCloudSessionStoreTests],
  ["gemini-structured-output", runGeminiStructuredOutputTests],
  ["gemini-language-prompts", runGeminiLanguagePromptTests],
  ["gemini-video-parts", runGeminiVideoPartTests],
  ["hosted-dev", runHostedDevTests],
  ["http-auth", runHttpAuthTests],
  ["http-mcp", runHttpMcpTests],
  ["oauth-validation", runOAuthValidationTests],
  ["principal-scoped-long-analysis-jobs", runPrincipalScopedLongAnalysisJobsTests],
  ["principal-scoped-service", runPrincipalScopedServiceTests],
  ["principal-scoped-session-store", runPrincipalScopedSessionStoreTests],
  ["public-remote-service", runPublicRemoteServiceTests],
  ["queue-dashboard", runQueueDashboardTests],
  ["remote-account", runRemoteAccountTests],
  ["remote-access-store", runRemoteAccessStoreTests],
  ["server-audio-tool", runServerAudioToolTests],
  ["server-async-long-tool", runServerAsyncLongToolTests],
  ["server-follow-up-tool", runServerFollowUpToolTests],
  ["server-long-tool", runServerLongToolTests],
  ["server-metadata-tool", runServerMetadataToolTests],
  ["server-short-tool", runServerShortToolTests],
  ["session-store", runSessionStoreTests],
  ["task-store", runTaskStoreTests],
  ["video-analysis-service", runVideoAnalysisServiceTests],
  ["youtube-metadata", runYouTubeMetadataTests],
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
