import { run as runServerAudioToolTests } from "./server-audio-tool.test.js";
import { run as runServerCapabilitiesToolTests } from "./server-capabilities-tool.test.js";
import { run as runServerDeadlineTests } from "./server-deadline.test.js";
import { run as runServerFollowUpToolTests } from "./server-follow-up-tool.test.js";
import { run as runServerFrameToolTests } from "./server-frame-tool.test.js";
import { run as runServerLongJobToolTests } from "./server-long-job-tools.test.js";
import { run as runServerLongToolTests } from "./server-long-tool.test.js";
import { run as runServerMetadataToolTests } from "./server-metadata-tool.test.js";
import { run as runServerShortToolTests } from "./server-short-tool.test.js";
import { run as runTaskStoreTests } from "./task-store.test.js";

const suites = [
  ["server-audio-tool", runServerAudioToolTests],
  ["server-capabilities-tool", runServerCapabilitiesToolTests],
  ["server-deadline", runServerDeadlineTests],
  ["server-follow-up-tool", runServerFollowUpToolTests],
  ["server-frame-tool", runServerFrameToolTests],
  ["server-long-job-tools", runServerLongJobToolTests],
  ["server-long-tool", runServerLongToolTests],
  ["server-metadata-tool", runServerMetadataToolTests],
  ["server-short-tool", runServerShortToolTests],
  ["task-store", runTaskStoreTests],
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
