import process from "node:process";

import { Redis } from "ioredis";

import { getPrincipalKey, type AuthPrincipal } from "../lib/auth/principal.js";
import {
  mergeRemoteAccountOnUpsert,
  normalizeRemoteAccountFromStorage,
  type RemoteAccount,
} from "./remote-account.js";

export type { RemoteAccount, RemoteAccountPlan, RemoteAccountStatus } from "./remote-account.js";

const ACCOUNT_KEY_PREFIX = "remote-access:account:";
const JOB_OWNER_KEY_PREFIX = "remote-access:job-owner:";
const SESSION_OWNER_KEY_PREFIX = "remote-access:session-owner:";

export interface RemoteAccessStore {
  upsertAccount(principal: AuthPrincipal): Promise<RemoteAccount>;
  getAccount(accountId: string): Promise<RemoteAccount | null>;
  adjustAccountCredits(accountId: string, delta: number): Promise<RemoteAccount | null>;
  setJobOwner(jobId: string, accountId: string): Promise<void>;
  getJobOwner(jobId: string): Promise<string | null>;
  deleteJobOwner?(jobId: string): Promise<void>;
  setSessionOwner(sessionId: string, accountId: string): Promise<void>;
  getSessionOwner(sessionId: string): Promise<string | null>;
  deleteSessionOwner?(sessionId: string): Promise<void>;
}

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

function readJsonUnknown(value: string | null): unknown | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as unknown;
}

export class InMemoryRemoteAccessStore implements RemoteAccessStore {
  private readonly accounts = new Map<string, RemoteAccount>();
  private readonly jobOwners = new Map<string, string>();
  private readonly sessionOwners = new Map<string, string>();

  async upsertAccount(principal: AuthPrincipal): Promise<RemoteAccount> {
    const accountId = getPrincipalKey(principal);
    const now = new Date().toISOString();
    const previous = this.accounts.get(accountId) ?? null;
    const existing = previous ? normalizeRemoteAccountFromStorage(previous, accountId) : null;
    const account = mergeRemoteAccountOnUpsert(existing, principal, now);

    this.accounts.set(accountId, account);
    return account;
  }

  async getAccount(accountId: string): Promise<RemoteAccount | null> {
    const previous = this.accounts.get(accountId) ?? null;
    return previous ? normalizeRemoteAccountFromStorage(previous, accountId) : null;
  }

  async adjustAccountCredits(accountId: string, delta: number): Promise<RemoteAccount | null> {
    const previous = this.accounts.get(accountId) ?? null;
    const existing = previous ? normalizeRemoteAccountFromStorage(previous, accountId) : null;
    if (!existing) {
      return null;
    }

    if (existing.status === "suspended" && delta < 0) {
      return null;
    }

    const nextBalance = existing.creditBalance + delta;
    if (nextBalance < 0) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: RemoteAccount = {
      ...existing,
      creditBalance: nextBalance,
      updatedAt: now,
      lastSeenAt: now,
    };

    this.accounts.set(accountId, updated);
    return updated;
  }

  async setJobOwner(jobId: string, accountId: string): Promise<void> {
    this.jobOwners.set(jobId, accountId);
  }

  async getJobOwner(jobId: string): Promise<string | null> {
    return this.jobOwners.get(jobId) ?? null;
  }

  async deleteJobOwner(jobId: string): Promise<void> {
    this.jobOwners.delete(jobId);
  }

  async setSessionOwner(sessionId: string, accountId: string): Promise<void> {
    this.sessionOwners.set(sessionId, accountId);
  }

  async getSessionOwner(sessionId: string): Promise<string | null> {
    return this.sessionOwners.get(sessionId) ?? null;
  }

  async deleteSessionOwner(sessionId: string): Promise<void> {
    this.sessionOwners.delete(sessionId);
  }
}

export class RedisRemoteAccessStore implements RemoteAccessStore {
  constructor(private readonly redis: Redis) {}

  async upsertAccount(principal: AuthPrincipal): Promise<RemoteAccount> {
    const accountId = getPrincipalKey(principal);
    const key = `${ACCOUNT_KEY_PREFIX}${accountId}`;
    const raw = readJsonUnknown(await this.redis.get(key));
    const now = new Date().toISOString();
    const existing = raw ? normalizeRemoteAccountFromStorage(raw, accountId) : null;
    const account = mergeRemoteAccountOnUpsert(existing, principal, now);

    await this.redis.set(key, JSON.stringify(account));
    return account;
  }

  async getAccount(accountId: string): Promise<RemoteAccount | null> {
    const raw = readJsonUnknown(await this.redis.get(`${ACCOUNT_KEY_PREFIX}${accountId}`));
    return raw ? normalizeRemoteAccountFromStorage(raw, accountId) : null;
  }

  async adjustAccountCredits(accountId: string, delta: number): Promise<RemoteAccount | null> {
    const key = `${ACCOUNT_KEY_PREFIX}${accountId}`;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await this.redis.watch(key);
      const raw = readJsonUnknown(await this.redis.get(key));
      const existing = raw ? normalizeRemoteAccountFromStorage(raw, accountId) : null;

      if (!existing) {
        await this.redis.unwatch();
        return null;
      }

      if (existing.status === "suspended" && delta < 0) {
        await this.redis.unwatch();
        return null;
      }

      const nextBalance = existing.creditBalance + delta;
      if (nextBalance < 0) {
        await this.redis.unwatch();
        return null;
      }

      const now = new Date().toISOString();
      const updated: RemoteAccount = {
        ...existing,
        creditBalance: nextBalance,
        updatedAt: now,
        lastSeenAt: now,
      };

      const execResult = await this.redis.multi().set(key, JSON.stringify(updated)).exec();
      if (execResult === null) {
        continue;
      }

      return updated;
    }

    return null;
  }

  async setJobOwner(jobId: string, accountId: string): Promise<void> {
    await this.redis.set(`${JOB_OWNER_KEY_PREFIX}${jobId}`, accountId);
  }

  async getJobOwner(jobId: string): Promise<string | null> {
    return await this.redis.get(`${JOB_OWNER_KEY_PREFIX}${jobId}`);
  }

  async deleteJobOwner(jobId: string): Promise<void> {
    await this.redis.del(`${JOB_OWNER_KEY_PREFIX}${jobId}`);
  }

  async setSessionOwner(sessionId: string, accountId: string): Promise<void> {
    await this.redis.set(`${SESSION_OWNER_KEY_PREFIX}${sessionId}`, accountId);
  }

  async getSessionOwner(sessionId: string): Promise<string | null> {
    return await this.redis.get(`${SESSION_OWNER_KEY_PREFIX}${sessionId}`);
  }

  async deleteSessionOwner(sessionId: string): Promise<void> {
    await this.redis.del(`${SESSION_OWNER_KEY_PREFIX}${sessionId}`);
  }
}

let sharedRemoteAccessStore: RemoteAccessStore | null = null;

export function createRemoteAccessStoreFromEnv(env: NodeJS.ProcessEnv = process.env): RemoteAccessStore {
  if (sharedRemoteAccessStore) {
    return sharedRemoteAccessStore;
  }

  const redisUrl = getRedisUrl(env);
  sharedRemoteAccessStore = redisUrl
    ? new RedisRemoteAccessStore(createRedisConnection(redisUrl))
    : new InMemoryRemoteAccessStore();

  return sharedRemoteAccessStore;
}
