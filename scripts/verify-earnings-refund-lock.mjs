#!/usr/bin/env node
/**
 * Offline unit checks: earnings windows + refund clawback wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isBossAfterSaleOpen,
  isCompanionEarningsLocked,
  companionWithdrawableAtIso,
  splitCompanionIncomeByWithdrawLock,
  MS_24H,
} from "../server/api/_earnings-windows.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const completedAt = "2026-09-22T06:00:00.000Z";
const t0 = Date.parse(completedAt);
const orderAuto = {
  status: "completed",
  completed_at: completedAt,
  completion_method: "system_auto_24h",
};
const orderBoss = {
  status: "completed",
  completed_at: completedAt,
  completion_method: "boss_manual",
  note: "[[AFTER_SALE_CLOSED]] boss_manual",
};

assert.equal(isCompanionEarningsLocked(orderAuto, t0 + 1000), true);
assert.equal(isCompanionEarningsLocked(orderAuto, t0 + MS_24H + 1000), false);
assert.equal(isCompanionEarningsLocked(orderBoss, t0 + 1000), true, "boss confirm does NOT unlock companion early");
assert.equal(isCompanionEarningsLocked(orderBoss, t0 + MS_24H + 1000), false);

assert.equal(isBossAfterSaleOpen(orderBoss, t0 + 1000), false, "boss_manual closes after-sale");
assert.equal(isBossAfterSaleOpen(orderAuto, t0 + 1000), true);
assert.equal(isBossAfterSaleOpen(orderAuto, t0 + MS_24H + 1000), false);
assert.equal(isBossAfterSaleOpen({ status: "in_progress" }, t0), true);
assert.equal(companionWithdrawableAtIso(orderAuto), new Date(t0 + MS_24H).toISOString());

const map = new Map([
  ["o1", { id: "o1", status: "completed", completed_at: completedAt }],
  ["o2", { id: "o2", status: "completed", completed_at: new Date(t0 - MS_24H * 2).toISOString() }],
]);
const split = splitCompanionIncomeByWithdrawLock(
  [
    { order_id: "o1", amount: 24 },
    { order_id: "o2", amount: 30 },
  ],
  map,
  t0 + 1000
);
assert.equal(split.locked.length, 1);
assert.equal(split.unlocked.length, 1);

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

console.log("verify-earnings-refund-lock: PASS");
