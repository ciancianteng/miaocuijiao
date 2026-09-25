#!/usr/bin/env node
/**
 * Offline unit checks: earnings windows + refund clawback wiring.
 * Unlock SoT: earliest of Boss confirm OR serviceComplete+24h.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isBossAfterSaleOpen,
  isCompanionEarningsLocked,
  companionWithdrawableAtIso,
  companionWithdrawableAtMs,
  companionEarningsUnlockMeta,
  parseBossConfirmedAtMs,
  splitCompanionIncomeByWithdrawLock,
  MS_24H,
} from "../server/api/_earnings-windows.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const completedAt = "2026-09-22T06:00:00.000Z";
const t0 = Date.parse(completedAt);
const requestAt = "2026-09-22T05:00:00.000Z";
const tReq = Date.parse(requestAt);

const orderPlain = {
  status: "completed",
  completed_at: completedAt,
};
assert.equal(isCompanionEarningsLocked(orderPlain, t0 + 1000), true, "plain locked before +24h");
assert.equal(isCompanionEarningsLocked(orderPlain, t0 + MS_24H + 1000), false, "plain unlocked after +24h");
assert.equal(companionWithdrawableAtIso(orderPlain), new Date(t0 + MS_24H).toISOString());

const orderAuto = {
  status: "completed",
  completed_at: completedAt,
  completion_method: "system_auto_24h",
};
assert.equal(isCompanionEarningsLocked(orderAuto, t0 + 1000), false, "system_auto unlocked at completed_at");
assert.equal(companionWithdrawableAtIso(orderAuto), completedAt);

const orderBoss = {
  status: "completed",
  completed_at: completedAt,
  completion_method: "boss_manual",
  note: "[[AFTER_SALE_CLOSED]] boss_manual",
};
assert.equal(isCompanionEarningsLocked(orderBoss, t0 + 1000), false, "boss confirm unlocks immediately");
assert.equal(Number.isFinite(parseBossConfirmedAtMs(orderBoss)), true);
assert.equal(companionWithdrawableAtIso(orderBoss), completedAt);
const metaBoss = companionEarningsUnlockMeta(orderBoss, t0 + 1000);
assert.equal(metaBoss.locked, false);
assert.equal(metaBoss.unlockReason, "boss_confirmed_early");
assert.match(metaBoss.statusLabel, /提前解锁/);

const orderBossEarly = {
  status: "completed",
  completed_at: new Date(tReq + 10 * 60 * 1000).toISOString(),
  completion_method: "boss_manual",
  note: `[[COMPLETION_REQUESTED_AT]]${requestAt}\n[[AFTER_SALE_CLOSED]] boss_manual`,
};
assert.equal(
  isCompanionEarningsLocked(orderBossEarly, tReq + 10 * 60 * 1000 + 1000),
  false,
  "boss early confirm unlocks before request+24h"
);
assert.equal(companionWithdrawableAtMs(orderBossEarly), tReq + 10 * 60 * 1000);

const orderPendingAuto = {
  status: "completed",
  completed_at: new Date(tReq + MS_24H).toISOString(),
  completion_method: "system_auto_24h",
  note: `[[COMPLETION_REQUESTED_AT]]${requestAt}`,
};
assert.equal(isCompanionEarningsLocked(orderPendingAuto, tReq + MS_24H - 1000), true);
assert.equal(isCompanionEarningsLocked(orderPendingAuto, tReq + MS_24H + 1000), false);

assert.equal(isBossAfterSaleOpen(orderBoss, t0 + 1000), false, "boss_manual closes after-sale");
assert.equal(isBossAfterSaleOpen(orderPlain, t0 + 1000), true);
assert.equal(isBossAfterSaleOpen(orderPlain, t0 + MS_24H + 1000), false);
assert.equal(isBossAfterSaleOpen({ status: "in_progress" }, t0), true);

const map = new Map([
  ["o1", { id: "o1", status: "completed", completed_at: completedAt }],
  ["o2", { id: "o2", status: "completed", completed_at: new Date(t0 - MS_24H * 2).toISOString() }],
  ["o3", { id: "o3", status: "completed", completed_at: completedAt, completion_method: "boss_manual" }],
]);
const split = splitCompanionIncomeByWithdrawLock(
  [
    { order_id: "o1", amount: 24 },
    { order_id: "o2", amount: 30 },
    { order_id: "o3", amount: 56 },
  ],
  map,
  t0 + 1000
);
assert.equal(split.locked.length, 1, "plain still locked");
assert.equal(split.unlocked.length, 2, "old + boss_manual unlocked");
assert.equal(split.unlocked.reduce((n, r) => n + r.amount, 0), 86, "no double income");

const refundJs = readFileSync(path.join(root, "server/api/_boss-refund-payout.js"), "utf8");
assert.match(refundJs, /clawbackCompanionIncomeForOrder/);
assert.match(refundJs, /clawbackBossPointsForRefundedOrder/);
assert.match(refundJs, /clawbackCsOrderIncome/);
assert.match(refundJs, /clawbackBossCommissionForOrder/);
assert.match(refundJs, /整单积分全部取消/);

const ordersJs = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
assert.match(ordersJs, /AFTER_SALE_CLOSED/);
assert.match(ordersJs, /isBossAfterSaleOpen/);

const companionJs = readFileSync(path.join(root, "server/api/companion.js"), "utf8");
assert.match(companionJs, /earningsLocked/);
assert.match(companionJs, /splitCompanionIncomeByWithdrawLock/);
assert.match(companionJs, /companionEarningsUnlockMeta/);

console.log("verify-earnings-refund-lock: PASS");
