import assert from "node:assert/strict";

import { InMemoryRemoteAccessStore } from "../app/remote-access-store.js";
import { getPrincipalKey, type AuthPrincipal } from "../lib/auth/principal.js";

const principal: AuthPrincipal = {
  subject: "google-oauth2|user-1",
  issuer: "https://issuer.example.com/",
  audience: "https://youtube-analyzer-mcp.onrender.com/api/mcp",
  scope: [],
  tokenId: "token-1",
  rawClaims: {},
};

export async function run(): Promise<void> {
  const store = new InMemoryRemoteAccessStore();
  const accountId = getPrincipalKey(principal);

  const created = await store.upsertAccount(principal);
  assert.equal(created.accountId, accountId);
  assert.equal(created.subject, principal.subject);
  assert.equal(created.issuer, principal.issuer);
  assert.equal(typeof created.createdAt, "string");
  assert.equal(typeof created.updatedAt, "string");
  assert.equal(typeof created.lastSeenAt, "string");
  assert.equal(created.plan, "free");
  assert.equal(created.status, "active");

  const loaded = await store.getAccount(accountId);
  assert.equal(loaded?.accountId, accountId);
  assert.equal(loaded?.plan, "free");
  assert.equal(loaded?.status, "active");
  assert.equal(typeof loaded?.creditBalance, "number");

  const afterDebit = await store.adjustAccountCredits(accountId, -1);
  assert.equal(afterDebit?.creditBalance, (loaded?.creditBalance ?? 0) - 1);

  const broke = await store.adjustAccountCredits(accountId, -((afterDebit?.creditBalance ?? 0) + 1));
  assert.equal(broke, null);
  assert.equal((await store.getAccount(accountId))?.creditBalance, afterDebit?.creditBalance ?? 0);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const touched = await store.upsertAccount(principal);
  assert.equal(touched.createdAt, created.createdAt);
  assert.notEqual(touched.updatedAt, created.updatedAt);
  assert.notEqual(touched.lastSeenAt, created.lastSeenAt);

  await store.setJobOwner("job-1", accountId);
  assert.equal(await store.getJobOwner("job-1"), accountId);
  await store.deleteJobOwner?.("job-1");
  assert.equal(await store.getJobOwner("job-1"), null);

  await store.setSessionOwner("session-1", accountId);
  assert.equal(await store.getSessionOwner("session-1"), accountId);
  await store.deleteSessionOwner?.("session-1");
  assert.equal(await store.getSessionOwner("session-1"), null);
}
