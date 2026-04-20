import process from "node:process";
import { fileURLToPath } from "node:url";

import { main } from "./mcp-server-main.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
