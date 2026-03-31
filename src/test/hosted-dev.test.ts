import assert from "node:assert/strict";

import {
  getHostedServerConfig,
  getPublicOriginFromHeaders,
  resolveRoute,
} from "../dev/hosted.js";

export async function run(): Promise<void> {
  assert.deepEqual(getHostedServerConfig(), {
    host: "127.0.0.1",
    port: 3010,
  });
  assert.deepEqual(getHostedServerConfig({ PORT: "10000" }), {
    host: "0.0.0.0",
    port: 10000,
  });
  assert.equal(
    getPublicOriginFromHeaders(
      {
        host: "0.0.0.0:10000",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "youtube-analyzer.onrender.com",
      },
      "0.0.0.0:10000"
    ),
    "https://youtube-analyzer.onrender.com"
  );

  const rootRoute = resolveRoute("/", "GET");
  assert.equal(rootRoute instanceof Response, false);

  const rootResponse = await (rootRoute as (request: Request) => Promise<Response>)(
    new Request("http://127.0.0.1:3010/")
  );
  const payload = (await rootResponse.json()) as { ok: boolean; mcpUrl: string; settingsUrl?: string; authSignInUrl?: string };

  assert.equal(payload.ok, true);
  assert.equal(payload.mcpUrl, "http://127.0.0.1:3010/api/mcp");
  assert.equal("settingsUrl" in payload, false);
  assert.equal("authSignInUrl" in payload, false);

  const proxiedRootResponse = await (rootRoute as (request: Request) => Promise<Response>)(
    new Request("https://youtube-analyzer.onrender.com/")
  );
  const proxiedPayload = (await proxiedRootResponse.json()) as { ok: boolean; mcpUrl: string };

  assert.equal(proxiedPayload.ok, true);
  assert.equal(proxiedPayload.mcpUrl, "https://youtube-analyzer.onrender.com/api/mcp");

  const mcpGetRoute = resolveRoute("/api/mcp", "GET");
  assert.equal(mcpGetRoute instanceof Response, false);

  const healthRoute = resolveRoute("/healthz", "GET");
  assert.equal(healthRoute instanceof Response, false);

  const healthResponse = await (healthRoute as (request: Request) => Promise<Response>)(
    new Request("http://127.0.0.1:3010/healthz")
  );
  const healthPayload = (await healthResponse.json()) as { ok: boolean };

  assert.equal(healthResponse.status, 200);
  assert.equal(healthPayload.ok, true);

  const authRoute = resolveRoute("/api/auth/signin", "GET");
  assert.equal(authRoute instanceof Response, true);
  assert.equal((authRoute as Response).status, 404);

  const settingsRoute = resolveRoute("/api/settings", "GET");
  assert.equal(settingsRoute instanceof Response, true);
  assert.equal((settingsRoute as Response).status, 404);
}
