/**
 * Offline checks for admin companion balance stats.
 * Does not write wallets or call production.
 */
import assert from "node:assert/strict";
import {
  balanceDatePolicy,
  companionEarningsBalance,
} from "../server/api/_companion-earnings-balance.js";
import { buildCompanionBalanceRows } from "../server/api/admin/companion-balances.js";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";

const now = Date.parse("2026-11-14T12:00:00.000Z");
const hour = 60 * 60 * 1000;

function order(id, completedAt, method = "") {
  return {
    id,
    status: "completed",
    completed_at: completedAt,
    completion_method: method,
    note: "",
    description: "",
  };
}

function income(id, userId, orderId, amount, note = "MCJ_SETTLEMENT:{}") {
  return {
    id,
    user_id: userId,
    order_id: orderId,
    transaction_type: "companion_income",
    amount,
    status: "completed",
    note,
    created_at: new Date(now).toISOString(),
  };
}

function withdrawal(id, userId, amount, status) {
  return { id, companion_id: userId, cat_food_amount: amount, amount, status };
}

const unlocked = order("o-open", new Date(now - 48 * hour).toISOString());
const locked = order("o-lock", new Date(now - hour).toISOString());

const openOnly = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(openOnly.withdrawable, 100);
assert.equal(openOnly.pendingSettlement, 0);
assert.equal(openOnly.withdrawing, 0);
assert.equal(openOnly.withdrawn, 0);

const lockedOnly = companionEarningsBalance({
  transactions: [income("t2", "u1", "o-lock", 80)],
  withdrawals: [],
  orders: [locked],
  nowMs: now,
});
assert.equal(lockedOnly.withdrawable, 0);
assert.equal(lockedOnly.pendingSettlement, 80);
assert.equal(lockedOnly.earningsLocked, 80);

const submitted = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [withdrawal("w1", "u1", 40, "submitted")],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(submitted.withdrawable, 60);
assert.equal(submitted.withdrawing, 40);
assert.equal(submitted.withdrawn, 0);

const approved = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [withdrawal("w1", "u1", 40, "approved")],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(approved.withdrawable, 60);
assert.equal(approved.withdrawing, 40);
assert.equal(approved.withdrawn, 0);

const paidStillFrozen = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [withdrawal("w1", "u1", 40, "paid")],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(paidStillFrozen.withdrawable, 60);
assert.equal(paidStillFrozen.withdrawing, 40, "paid stays in 提现中 until completed");
assert.equal(paidStillFrozen.withdrawn, 0);

const completed = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [withdrawal("w1", "u1", 40, "completed")],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(completed.withdrawable, 60);
assert.equal(completed.withdrawing, 0);
assert.equal(completed.withdrawn, 40);

const rejected = companionEarningsBalance({
  transactions: [income("t1", "u1", "o-open", 100)],
  withdrawals: [withdrawal("w1", "u1", 40, "rejected")],
  orders: [unlocked],
  nowMs: now,
});
assert.equal(rejected.withdrawable, 100);
assert.equal(rejected.withdrawing, 0);
assert.equal(rejected.withdrawn, 0);

const mixed = companionEarningsBalance({
  transactions: [
    income("t-open", "u1", "o-open", 100),
    income("t-lock", "u1", "o-lock", 30),
    income("t-gift", "u1", "", 15, "MCJ_GIFT:{}"),
    income("t-reward", "u1", "", 9, "奖励猫粮"),
  ],
  withdrawals: [withdrawal("w1", "u1", 20, "submitted"), withdrawal("w2", "u1", 10, "completed")],
  orders: [unlocked, locked],
  nowMs: now,
});
assert.equal(mixed.pendingSettlement, 30);
assert.equal(mixed.withdrawing, 20);
assert.equal(mixed.withdrawn, 10);
assert.equal(mixed.withdrawable, 100 + 15 - 20 - 10);
assert.equal(
  Math.round((mixed.withdrawable + mixed.pendingSettlement + mixed.withdrawing + mixed.withdrawn) * 100) / 100,
  mixed.withdrawableBase
);
assert.equal(mixed.bonus, 9);

const rows = buildCompanionBalanceRows({
  nowMs: now,
  profiles: [
    { id: "u1", role: "companion", status: "active", email: "real@example.com", display_name: "小满" },
    { id: "u-test", role: "companion", status: "active", email: "smoke@meow.test", display_name: "ProdSmoke" },
  ],
  companionProfiles: [
    { id: "cp1", user_id: "u1", nickname: "小满", verification_status: "approved", companion_code: "PW00021" },
    { id: "cp-test", user_id: "u-test", nickname: "ProdSmoke", verification_status: "approved", companion_code: "PW00999" },
  ],
  transactions: [
    income("t1", "u1", "o-open", 100),
    income("t-lock", "u1", "o-lock", 30),
    income("t-test", "u-test", "o-open", 500),
  ],
  withdrawals: [withdrawal("w1", "u1", 20, "submitted"), withdrawal("w-test", "u-test", 50, "completed")],
  orders: [unlocked, locked],
});
assert.equal(rows.rows.length, 1);
assert.equal(rows.rows[0].publicId, "PW00021");
assert.equal(rows.rows[0].name, "小满");
assert.equal(rows.totals.withdrawable, rows.rows[0].withdrawable);
assert.equal(rows.totals.pendingSettlement, rows.rows[0].pendingSettlement);
assert.equal(rows.totals.withdrawing, 20);
assert.equal(rows.totals.withdrawn, 0);
assert.equal(rows.totals.pendingSettlement, 30);
assert.equal(rows.totals.withdrawable, 80);

const policy = balanceDatePolicy({ range: "today", start: "2026-11-01", end: "2026-11-14" });
assert.equal(policy.scope, "current");
assert.equal(policy.label, "当前余额");
assert.equal(policy.snapshot, false);
assert.equal(policy.dateFilterIgnored, true);
assert.deepEqual(policy.ignoredKeys.sort(), ["end", "range", "start"]);

const dash = buildDashboardStats({
  profiles: [{ id: "b1", role: "boss", status: "active", email: "boss@example.com" }],
  orders: [
    {
      id: "ord-1",
      status: "completed",
      total_amount: 100,
      platform_fee: 20,
      companion_income: 80,
      parent_order_id: null,
      paid_at: "2026-11-01T00:00:00.000Z",
      boss_id: "b1",
    },
  ],
  withdrawals: [{ id: "w", status: "completed", companion_id: "u1", net_amount_rm: 40, amount: 40 }],
  companionProfiles: [],
  paymentTransactions: [],
});
assert.equal(dash.stats.platformProfit, 20);
assert.equal(dash.stats.totalAmount, 100);
assert.equal(dash.stats.companionWithdrawableTotal, undefined);
assert.equal(dash.stats.companionPendingSettlementTotal, undefined);

console.log("companion balance stats: PASS");
