import { run as runServerAudioToolTests } from "./server-audio-tool.test.js";
import { run as runServerAsyncLongToolTests } from "./server-async-long-tool.test.js";
import { run as runServerFollowUpToolTests } from "./server-follow-up-tool.test.js";
import { run as runServerLongToolTests } from "./server-long-tool.test.js";
import { run as runServerMetadataToolTests } from "./server-metadata-tool.test.js";
import { run as runServerShortToolTests } from "./server-short-tool.test.js";
import { run as runTaskStoreTests } from "./task-store.test.js";

const suites = [
  ["server-audio-tool", runServerAudioToolTests],
  ["server-async-long-tool", runServerAsyncLongToolTests],
  ["server-follow-up-tool", runServerFollowUpToolTests],
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
