import "dotenv/config";

import type { IncomingHttpHeaders } from "node:http";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { handleMcpHttpRequest } from "../http/mcp.js";

type RouteHandler = (request: Request) => Promise<Response>;

export function getHostedServerConfig(
  env: NodeJS.ProcessEnv = process.env
): { host: string; port: number } {
  const rawPort = env.PORT || env.HOSTED_DEV_PORT || "3010";
  const parsedPort = Number(rawPort);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3010;
  const host = env.HOSTED_DEV_HOST || env.HOST || (env.PORT ? "0.0.0.0" : "127.0.0.1");

  return { host, port };
}

const { host: HOST, port: PORT } = getHostedServerConfig();

function pickHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function pickForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export function getPublicOriginFromHeaders(
  headers: IncomingHttpHeaders,
  fallbackHost: string
): string {
  const forwardedProto = pickForwardedValue(pickHeaderValue(headers["x-forwarded-proto"]));
  const forwardedHost = pickForwardedValue(pickHeaderValue(headers["x-forwarded-host"]));
  const host = forwardedHost || pickHeaderValue(headers.host) || fallbackHost;
  const protocol = forwardedProto || "http";

  return `${protocol}://${host}`;
}

function getOrigin(request: IncomingMessage): string {
  return getPublicOriginFromHeaders(request.headers, `${HOST}:${PORT}`);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

function toWebRequest(request: IncomingMessage, body: Buffer | undefined): Request {
  const url = new URL(request.url || "/", getOrigin(request));
  const method = request.method || "GET";
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" || !body ? undefined : new Uint8Array(body),
  });
}

async function writeWebResponse(response: Response, serverResponse: ServerResponse): Promise<void> {
  serverResponse.statusCode = response.status;
  serverResponse.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    serverResponse.setHeader(key, key === "set-cookie" ? response.headers.getSetCookie() : value);
  });

  if (!response.body) {
    serverResponse.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  serverResponse.end(body);
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: allowed.join(", "),
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function healthCheck(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getMcpUrl(request: Request): string {
  const url = new URL(request.url);
  url.pathname = "/api/mcp";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveRoute(pathname: string, method: string): RouteHandler | Response {
  if (pathname === "/api/mcp") {
    if (method === "GET") {
      return handleMcpHttpRequest;
    }

    if (method === "POST") {
      return handleMcpHttpRequest;
    }

    if (method === "DELETE") {
      return handleMcpHttpRequest;
    }

    return methodNotAllowed(["GET", "POST", "DELETE"]);
  }

  if (pathname === "/healthz") {
    if (method === "GET") {
      return async () => healthCheck();
    }

    return methodNotAllowed(["GET"]);
  }

  if (pathname === "/" || pathname === "") {
    return async (request) =>
      new Response(
        JSON.stringify({
          ok: true,
          mcpUrl: getMcpUrl(request),
        }),
        {
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
  }

  return notFound();
}

async function handleNodeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody(request);
    const webRequest = toWebRequest(request, body);
    const resolved = resolveRoute(new URL(webRequest.url).pathname, webRequest.method);
    const webResponse = resolved instanceof Response ? resolved : await resolved(webRequest);
    await writeWebResponse(webResponse, response);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    response.statusCode = 500;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(message);
  }
}

export function createHostedDevServer() {
  return createHttpServer((request, response) => {
    void handleNodeRequest(request, response);
  });
}

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}, closing hosted HTTP server`);
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }

      process.exit();
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createHostedDevServer();
  installShutdownHandlers(server);
  server.listen(PORT, HOST, () => {
    console.log(`Hosted local server listening on http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/api/mcp`);
  });
}
