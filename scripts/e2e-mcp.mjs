import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: process.env,
  stderr: "pipe",
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    process.stderr.write(String(chunk));
  });
}

const client = new Client({ name: "youtube-analyzer-e2e", version: "0.1.0" });

async function main() {
  await client.connect(transport);

  const result = await client.callTool(
    {
      name: "analyze_long_youtube_video",
      arguments: {
        youtubeUrl: "https://youtu.be/z_e0BUag1V4?si=MXUp-MfOCkrebluR",
        strategy: "auto",
        preferCache: true,
      },
    },
    CallToolResultSchema,
    {
      timeout: 600_000,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: 45 * 60_000,
      onprogress: (progress) => {
        console.log(`PROGRESS ${progress.progress}/${progress.total ?? "?"} ${progress.message ?? ""}`.trim());
      },
    }
  );

  console.log("RESULT_JSON_START");
  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
  console.log("RESULT_JSON_END");

  await client.close();
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  try {
    await client.close();
  } catch {}
  process.exit(1);
});

