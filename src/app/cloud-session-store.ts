import process from "node:process";

import { Redis } from "ioredis";

import type { AnalysisSession } from "../lib/types.js";
import { InMemoryAnalysisSessionStore, type AnalysisSessionStore } from "./session-store.js";

const SESSION_KEY_PREFIX = "remote-session:";

export type CloudSessionStoreDriver = "memory" | "redis";

type SessionStoreKeyValueClient = Pick<Redis, "get" | "set" | "del">;

function getRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl) {
    return redisUrl;
  }

  const redisHost = env.REDIS_HOST?.trim();
  if (!redisHost) {
    return null;
  }

  const redisPort = env.REDIS_PORT?.trim() || "6379";
  return `redis://${redisHost}:${redisPort}`;
}

function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: 1 });
}

function getSessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function readSession(value: string | null): AnalysisSession | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as AnalysisSession;
}

export function resolveCloudSessionStoreDriver(
  env: NodeJS.ProcessEnv = process.env
): CloudSessionStoreDriver {
  const configuredDriver = env.SESSION_STORE_DRIVER?.trim().toLowerCase();
  if (!configuredDriver) {
    return getRedisUrl(env) ? "redis" : "memory";
  }

  if (configuredDriver === "memory" || configuredDriver === "redis") {
    return configuredDriver;
  }

  throw new Error(
    `Unsupported SESSION_STORE_DRIVER "${configuredDriver}". Expected "memory" or "redis".`
  );
}

export class RedisAnalysisSessionStore implements AnalysisSessionStore {
  constructor(private readonly client: SessionStoreKeyValueClient) {}

  async get(sessionId: string): Promise<AnalysisSession | null> {
    return readSession(await this.client.get(getSessionKey(sessionId)));
  }

  async set(session: AnalysisSession): Promise<void> {
    await this.client.set(getSessionKey(session.sessionId), JSON.stringify(session));
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.del(getSessionKey(sessionId));
  }
}

let sharedCloudSessionStore: AnalysisSessionStore | null = null;

export function createCloudSessionStore(env: NodeJS.ProcessEnv = process.env): AnalysisSessionStore {
  if (sharedCloudSessionStore) {
    return sharedCloudSessionStore;
  }

  const driver = resolveCloudSessionStoreDriver(env);
  if (driver === "memory") {
    sharedCloudSessionStore = new InMemoryAnalysisSessionStore();
    return sharedCloudSessionStore;
  }

  const redisUrl = getRedisUrl(env);
  if (!redisUrl) {
    throw new Error('SESSION_STORE_DRIVER is "redis" but REDIS_URL or REDIS_HOST is not configured.');
  }

  sharedCloudSessionStore = new RedisAnalysisSessionStore(createRedisConnection(redisUrl));
  return sharedCloudSessionStore;
}
