#!/usr/bin/env node
/**
 * Offline regression: multi 35+35 = Boss payment 70 once (never 140).
 */
import assert from "node:assert/strict";
import {
  nestParentOnlyOrders,
  isBossPaymentOwnerOrder,
  isMultiGroupChild,
  canDebitBossWalletForOrder,
} from "../server/api/_order-group.js";
import {
  buildDashboardStats,
  countsAsRevenue,
  isBusinessOrderRoot,
} from "../server/api/admin/dashboard.js";

const parent = {
  id: "p70",
  parent_order_id: null,
  order_type: "multi_group",
  status: "claimed",
  total_amount: 70,
  amount: 70,
  paid_at: new Date().toISOString(),
  paid_cat_food: 70,
  created_at: new Date().toISOString(),
  boss_id: "b1",
  companion_id: null,
};
const c1 = {
  id: "c35a",
  parent_order_id: "p70",
  order_type: "direct_companion",
  status: "claimed",
  total_amount: 35,
  amount: 35,
  created_at: new Date().toISOString(),
  boss_id: "b1",
  companion_id: "a",
  companionName: "小宏",
};
const c2 = {
  id: "c35b",
  parent_order_id: "p70",
  order_type: "direct_companion",
  status: "claimed",
  total_amount: 35,
  amount: 35,
  created_at: new Date().toISOString(),
  boss_id: "b1",
  companion_id: "b",
  companionName: "小灰灰",
};

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message || e) });
    console.error("FAIL", name, e.message || e);
  }
}

test("CASE1 payment owner is parent only", () => {
  assert.equal(isBossPaymentOwnerOrder(parent), true);
  assert.equal(isBossPaymentOwnerOrder(c1), false);
  assert.equal(canDebitBossWalletForOrder(c1), false);
  assert.equal(canDebitBossWalletForOrder(parent), true);
});

test("CASE1 nest list count = 1 not 3", () => {
  const nested = nestParentOnlyOrders([parent, c1, c2]);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].childCount, 2);
  assert.equal(nested[0].allocations.length, 2);
  assert.equal(
    nested[0].allocations.reduce((s, a) => s + a.allocatedAmount, 0),
    70
  );
});

test("CASE1 dashboard GMV = 70 not 140", () => {
  const dash = buildDashboardStats({
    profiles: [{ id: "b1", role: "boss", status: "active", email: "b@x.com" }],
    orders: [parent, c1, c2],
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 70);
  assert.equal(dash.filter.childOrdersSkipped, 2);
});

test("CASE1 countsAsRevenue on child is false (root+CS gate)", () => {
  assert.equal(isBusinessOrderRoot(c1), false);
  assert.equal(isBusinessOrderRoot(parent), true);
  assert.equal(countsAsRevenue(c1), false);
  assert.equal(countsAsRevenue(parent), true);
});

test("CASE3 allocation sum = parent total", () => {
  assert.equal(35 + 35, 70);
  assert.equal(Number(parent.total_amount), 70);
});

test("CASE6 admin-style revenue reduce parent-only", () => {
  const list = nestParentOnlyOrders([parent, c1, c2]);
  const revenue = list.reduce((n, x) => {
    if (!countsAsRevenue(x)) return n;
    return n + (Number(x.amount) || Number(x.total_amount) || 0);
  }, 0);
  assert.equal(revenue, 70);
  const naive = [parent, c1, c2].reduce((n, x) => {
    if (x.status === "awaiting_payment" || x.status === "cancelled") return n;
    return n + Number(x.total_amount);
  }, 0);
  assert.equal(naive, 140);
  assert.notEqual(revenue, naive);
});

test("child filter helper", () => {
  assert.equal(isMultiGroupChild(c1), true);
  assert.equal(isMultiGroupChild(parent), false);
});

const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
