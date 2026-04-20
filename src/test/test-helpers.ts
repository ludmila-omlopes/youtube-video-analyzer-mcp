import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function createConnectedInMemoryClient(server: McpServer): Promise<Client> {
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    {
      capabilities: {
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
    }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export async function createConnectedHttpClient(
  handler: (request: Request) => Promise<Response>,
  url = "https://example.test/mcp"
): Promise<Client> {
  const client = new Client(
    { name: "test-http-client", version: "1.0.0" },
    {
      capabilities: {
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
    }
  );

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return handler(request);
    },
  });

  await client.connect(transport);
  return client;
}

export const testLogger = {
  requestId: "test-request",
  tool: "test-tool",
  child: () => testLogger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
