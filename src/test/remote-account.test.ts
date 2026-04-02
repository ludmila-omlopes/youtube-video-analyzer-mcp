import assert from "node:assert/strict";

import {
  getRemoteAccountInitialCredits,
  mergeRemoteAccountOnUpsert,
  normalizeRemoteAccountFromStorage,
} from "../app/remote-account.js";
import { getPrincipalKey, type AuthPrincipal } from "../lib/auth/principal.js";

const principal: AuthPrincipal = {
  subject: "auth0|user-1",
  issuer: "https://issuer.example.com/",
  audience: "https://app.example.com/mcp",
  scope: [],
  tokenId: "t1",
  rawClaims: {},
};

export async function run(): Promise<void> {
  const accountId = getPrincipalKey(principal);
  const t0 = "2026-04-01T00:00:00.000Z";
  const t1 = "2026-04-02T00:00:00.000Z";

  const legacy = {
    accountId,
    subject: principal.subject,
    issuer: principal.issuer,
    createdAt: t0,
    updatedAt: t0,
  };

  const normalized = normalizeRemoteAccountFromStorage(legacy, accountId);
  assert.ok(normalized);
  assert.equal(normalized.plan, "free");
  assert.equal(normalized.status, "active");
  assert.equal(normalized.lastSeenAt, t0);
  assert.equal(normalized.creditBalance, getRemoteAccountInitialCredits());

  const merged = mergeRemoteAccountOnUpsert(normalized, principal, t1);
  assert.equal(merged.createdAt, t0);
  assert.equal(merged.updatedAt, t1);
  assert.equal(merged.lastSeenAt, t1);

  assert.equal(normalizeRemoteAccountFromStorage({ accountId: "other" }, accountId), null);

  const fresh = mergeRemoteAccountOnUpsert(null, principal, t1);
  assert.equal(fresh.createdAt, t1);
  assert.equal(fresh.lastSeenAt, t1);
  assert.equal(fresh.plan, "free");
  assert.equal(fresh.status, "active");
  assert.equal(fresh.creditBalance, getRemoteAccountInitialCredits());
}
