import process from "node:process";

import { getPrincipalKey, type AuthPrincipal } from "../lib/auth/principal.js";

export type RemoteAccountPlan = "free";

export type RemoteAccountStatus = "active" | "suspended";

export type RemoteAccount = {
  accountId: string;
  subject: string;
  issuer: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  plan: RemoteAccountPlan;
  status: RemoteAccountStatus;
  creditBalance: number;
};

export function getRemoteAccountInitialCredits(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REMOTE_ACCOUNT_INITIAL_CREDITS?.trim();
  if (!raw) {
    return 100;
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 100;
  }

  return Math.floor(n);
}

function parseStoredCreditBalance(raw: Record<string, unknown>): number {
  if (typeof raw.creditBalance === "number" && Number.isFinite(raw.creditBalance) && raw.creditBalance >= 0) {
    return Math.floor(raw.creditBalance);
  }

  return getRemoteAccountInitialCredits();
}

export function normalizeRemoteAccountFromStorage(raw: unknown, accountIdHint: string): RemoteAccount | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const r = raw as Record<string, unknown>;
  if (typeof r.accountId === "string" && r.accountId !== accountIdHint) {
    return null;
  }
  const accountId = accountIdHint;

  const subject = typeof r.subject === "string" ? r.subject : "";
  const issuer = typeof r.issuer === "string" ? r.issuer : "";
  const createdAt = typeof r.createdAt === "string" && r.createdAt.length > 0 ? r.createdAt : null;
  const updatedAt = typeof r.updatedAt === "string" && r.updatedAt.length > 0 ? r.updatedAt : createdAt;
  const lastSeenAt =
    typeof r.lastSeenAt === "string" && r.lastSeenAt.length > 0
      ? r.lastSeenAt
      : updatedAt ?? createdAt ?? new Date(0).toISOString();

  const plan: RemoteAccountPlan = r.plan === "free" ? "free" : "free";
  const status: RemoteAccountStatus = r.status === "suspended" ? "suspended" : "active";
  const creditBalance = parseStoredCreditBalance(r);

  const safeCreated = createdAt ?? new Date(0).toISOString();
  const safeUpdated = updatedAt ?? safeCreated;

  return {
    accountId,
    subject,
    issuer,
    createdAt: safeCreated,
    updatedAt: safeUpdated,
    lastSeenAt,
    plan,
    status,
    creditBalance,
  };
}

export function mergeRemoteAccountOnUpsert(
  existing: RemoteAccount | null,
  principal: AuthPrincipal,
  now: string
): RemoteAccount {
  const accountId = getPrincipalKey(principal);

  if (!existing) {
    return {
      accountId,
      subject: principal.subject,
      issuer: principal.issuer,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      plan: "free",
      status: "active",
      creditBalance: getRemoteAccountInitialCredits(),
    };
  }

  return {
    ...existing,
    accountId,
    subject: principal.subject,
    issuer: principal.issuer,
    updatedAt: now,
    lastSeenAt: now,
  };
}
