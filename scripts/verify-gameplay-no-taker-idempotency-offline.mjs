#!/usr/bin/env node
/**
 * Offline: overlapping no-taker ticks never refund / announce twice.
 * Runs against an in-memory order store with CAS semantics; no network, no env.
 *   node scripts/verify-gameplay-no-taker-idempotency-offline.mjs
 */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const k of Object.keys(process.env)) {
  if (/SUPABASE|DATABASE_URL|POSTGRES/i.test(k)) delete process.env[k];
}
process.chdir(os.tmpdir());
const { refundGameplayNoTaker } = await import(pathToFileURL(path.join(root, "server/api/_order-confirm-timeout.js")).href);

function makeDb(order, { holdAlreadyReleased = false } = {}) {
  const row = { ...order };
  const logs = [];
  let released = holdAlreadyReleased;
  const db = {
    restUrl: (table, query = "") => `mem://${table}${query}`,
    serviceHeaders: () => ({}),
    async supabaseJson(url, opts = {}) {
      await new Promise((r) => setImmediate(r));
      const [, table, query = ""] = url.match(/^mem:\/\/([a-z_]+)(.*)$/) || [];
      if (table !== "orders" || opts.method !== "PATCH") return [];
      const want = Object.fromEntries([...query.matchAll(/(status|companion_id)=(eq|is)\.([^&]+)/g)].map((m) => [m[1], m[3]]));
      if (want.status && row.status !== decodeURIComponent(want.status)) return [];
      if (want.companion_id === "null" && row.companion_id) return [];
      Object.assign(row, JSON.parse(opts.body));
      return [{ ...row }];
    },
    async writeOrderStatusLog(_db, entry) {
      logs.push(entry);
    },
    wallet: {
      async releaseWalletHold() {
        await new Promise((r) => setImmediate(r));
        if (released) return { ok: true, duplicate: true };
        released = true;
        return { ok: true, hold: { status: "released" } };
      },
    },
  };
  return { db, row, logs };
}

const base = {
  id: "00000000-0000-0000-0000-000000000001",
  order_no: "MCJO-T1",
  boss_id: "00000000-0000-0000-0000-0000000000b0",
  companion_id: null,
  paid_cat_food: 30,
  total_amount: 30,
  description: "商品ID：p1\n接单规则：抢单大厅30分钟无人接单自动全额退回猫粮余额",
};
const refundedLogs = (logs) => logs.filter((l) => l.toStatus === "refunded").length;

// 1) Two ticks race on the same hall order: one locks + refunds, the other is a no-op.
{
  const { db, row, logs } = makeDb({ ...base, status: "pending", note: "" });
  const snapshot = { ...row };
  const [a, b] = await Promise.all([refundGameplayNoTaker(db, snapshot), refundGameplayNoTaker(db, snapshot)]);
  assert.equal(row.status, "refunded");
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one tick wins the lock");
  assert.equal(logs.filter((l) => l.toStatus === "refund_requested").length, 1);
  assert.equal(refundedLogs(logs), 1);
  console.log("PASS concurrent hall ticks → one lock, one refund, one log");
}

// 2) Lock younger than the grace window belongs to an in-flight tick: do not resume.
{
  const note = `[[NO_TAKER_REFUND]]${new Date(Date.now() - 30 * 1000).toISOString()}`;
  const { db, row, logs } = makeDb({ ...base, status: "refund_requested", note });
  assert.equal(await refundGameplayNoTaker(db, { ...row }), null);
  assert.equal(row.status, "refund_requested");
  assert.equal(logs.length, 0);
  console.log("PASS fresh refund lock is left to its owner");
}

// 3) A tick died after releasing the hold; two later ticks resume concurrently → still one refund log.
{
  const note = `[[NO_TAKER_REFUND]]${new Date(Date.now() - 5 * 60 * 1000).toISOString()}`;
  const { db, row, logs } = makeDb({ ...base, status: "refund_requested", note }, { holdAlreadyReleased: true });
  const snapshot = { ...row };
  const outs = await Promise.all([refundGameplayNoTaker(db, snapshot), refundGameplayNoTaker(db, snapshot)]);
  assert.equal(row.status, "refunded");
  assert.equal(refundedLogs(logs), 1, "only the CAS winner logs refunded");
  assert.equal(outs.filter((o) => o?.duplicate).length, 1, "the loser reports duplicate");
  console.log("PASS stale lock resumed by overlapping ticks → one refunded log");
}

// 4) Re-running on an already refunded order does nothing.
{
  const { db, row, logs } = makeDb({ ...base, status: "refunded", note: "" });
  assert.equal(await refundGameplayNoTaker(db, { ...row, status: "pending" }), null);
  assert.equal(logs.length, 0);
  console.log("PASS refunded order is never touched again");
}

console.log("\nverify-gameplay-no-taker-idempotency-offline: all PASS");
