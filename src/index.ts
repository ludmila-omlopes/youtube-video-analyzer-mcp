import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./mcp-server-main.js";

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
