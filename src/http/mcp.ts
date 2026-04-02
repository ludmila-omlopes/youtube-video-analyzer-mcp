import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createBullMqLongAnalysisJobsFromEnv } from "../app/bullmq-long-analysis-jobs.js";
import { createCloudSessionStore } from "../app/cloud-session-store.js";
import { createPublicRemoteVideoAnalysisService } from "../app/create-public-remote-service.js";
import type { LongAnalysisJobs } from "../app/long-analysis-jobs.js";
import { createPrincipalScopedLongAnalysisJobs } from "../app/principal-scoped-long-analysis-jobs.js";
import { createPrincipalScopedSessionStore } from "../app/principal-scoped-session-store.js";
import { createPrincipalScopedService } from "../app/principal-scoped-service.js";
import { createRemoteAccessStoreFromEnv, type RemoteAccessStore } from "../app/remote-access-store.js";
import type { AnalysisSessionStore } from "../app/session-store.js";
import type { VideoAnalysisServiceLike } from "../app/video-analysis-service.js";
import type { AuthPrincipal } from "../lib/auth/principal.js";
import { createServer } from "../server.js";

export type McpHttpHandlerOptions = {
  service?: VideoAnalysisServiceLike;
  createService?: () => VideoAnalysisServiceLike | Promise<VideoAnalysisServiceLike>;
  longAnalysisJobs?: LongAnalysisJobs | null;
  sessionStore?: AnalysisSessionStore;
  remoteAccessStore?: RemoteAccessStore;
};

export type McpHttpRequestContext = {
  principal?: AuthPrincipal | null;
};

export function createMcpHttpHandler(options: McpHttpHandlerOptions = {}) {
  const baseLongAnalysisJobs = options.longAnalysisJobs ?? createBullMqLongAnalysisJobsFromEnv();
  const baseSessionStore = options.sessionStore ?? createCloudSessionStore();
  const remoteAccessStore = options.remoteAccessStore ?? createRemoteAccessStoreFromEnv();

  return async function handleMcpHttpRequest(
    request: Request,
    context: McpHttpRequestContext = {}
  ): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    if (context.principal) {
      await remoteAccessStore.upsertAccount(context.principal);
    }

    const baseService =
      options.service ??
      (await options.createService?.()) ??
      createPublicRemoteVideoAnalysisService({
        sessionStore: context.principal
          ? createPrincipalScopedSessionStore(baseSessionStore, context.principal, remoteAccessStore)
          : baseSessionStore,
      });
    const service = context.principal
      ? createPrincipalScopedService(baseService, context.principal, remoteAccessStore)
      : baseService;
    const longAnalysisJobs =
      context.principal && baseLongAnalysisJobs
        ? createPrincipalScopedLongAnalysisJobs(baseLongAnalysisJobs, context.principal, remoteAccessStore)
        : baseLongAnalysisJobs;
    const server = createServer({
      service,
      runtimeMode: "cloud",
      longAnalysisJobs,
    });

    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
      await transport.close();
    }
  };
}

export const handleMcpHttpRequest = createMcpHttpHandler();
