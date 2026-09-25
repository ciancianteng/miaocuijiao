#!/usr/bin/env node
/**
 * Offline: CS-approved parent payment is the only revenue SoT.
 * Multi 35+35 must stay Dashboard 1 order / RM70 (never 140).
 */
import assert from "node:assert/strict";
import {
  attachPaymentApprovals,
  approvedRevenueAmount,
  buildDashboardStats,
  countsAsRevenue,
  hasCsApprovedPayment,
  isBusinessOrderRoot,
} from "../server/api/admin/dashboard.js";
import { nestParentOnlyOrders, isMultiGroupChild } from "../server/api/_order-group.js";

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

const parentAwaiting = {
  id: "p70",
  parent_order_id: null,
  order_type: "multi_group",
  status: "awaiting_payment",
  total_amount: 70,
  created_at: new Date().toISOString(),
  boss_id: "b1",
};
const parentClaimedNoPay = {
  ...parentAwaiting,
  status: "claimed",
};
const parentApproved = {
  ...parentAwaiting,
  status: "claimed",
  paid_at: new Date().toISOString(),
  paid_cat_food: 70,
};
const c1 = {
  id: "c35a",
  parent_order_id: "p70",
  order_type: "direct_companion",
  status: "claimed",
  total_amount: 35,
  paid_at: new Date().toISOString(),
  paid_cat_food: 35,
  created_at: new Date().toISOString(),
  boss_id: "b1",
  companion_id: "a",
};
const c2 = {
  id: "c35b",
  parent_order_id: "p70",
  order_type: "direct_companion",
  status: "claimed",
  total_amount: 35,
  paid_at: new Date().toISOString(),
  paid_cat_food: 35,
  created_at: new Date().toISOString(),
  boss_id: "b1",
  companion_id: "b",
};
const profiles = [{ id: "b1", role: "boss", status: "active", email: "b@x.com" }];

test("CASE1 before CS approve: revenue=0 validOrders=0", () => {
  assert.equal(countsAsRevenue(parentAwaiting), false);
  assert.equal(countsAsRevenue(parentClaimedNoPay), false);
  const dash = buildDashboardStats({
    profiles,
    orders: [parentClaimedNoPay, c1, c2],
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 0);
  assert.equal(dash.stats.validOrders, 0);
});

test("CASE1 after CS approve single: 1 order / RM70", () => {
  const single = {
    id: "s70",
    parent_order_id: null,
    status: "claimed",
    total_amount: 70,
    paid_at: new Date().toISOString(),
    paid_cat_food: 70,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  assert.equal(hasCsApprovedPayment(single), true);
  assert.equal(countsAsRevenue(single), true);
  const dash = buildDashboardStats({ profiles, orders: [single], withdrawals: [] });
  assert.equal(dash.stats.validOrders, 1);
  assert.equal(dash.stats.totalAmount, 70);
});

test("CASE2 multi 35+35 Dashboard still 1 / RM70 not 140", () => {
  assert.equal(isBusinessOrderRoot(c1), false);
  assert.equal(isMultiGroupChild(c1), true);
  assert.equal(countsAsRevenue(c1), false);
  const dash = buildDashboardStats({
    profiles,
    orders: [parentApproved, c1, c2],
    withdrawals: [],
  });
  assert.equal(dash.stats.validOrders, 1);
  assert.equal(dash.stats.totalAmount, 70);
  assert.equal(dash.filter.childOrdersSkipped, 2);
});

test("CASE2 TX gross preferred over inflated total_amount", () => {
  const inflated = {
    ...parentApproved,
    total_amount: 140,
    paid_cat_food: 140,
  };
  const txs = [{ order_id: "p70", gross_amount: 70, payment_status: "paid", confirmed_at: new Date().toISOString() }];
  const dash = buildDashboardStats({
    profiles,
    orders: [inflated, c1, c2],
    paymentTransactions: txs,
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 70);
  assert.equal(dash.stats.validOrders, 1);
});

test("CASE3 duplicate approve / second TX ignored (unique order_id)", () => {
  const txs = [
    { order_id: "p70", gross_amount: 70, payment_status: "paid", confirmed_at: "2026-09-01T00:00:00Z" },
    { order_id: "p70", gross_amount: 70, payment_status: "paid", confirmed_at: "2026-09-01T00:01:00Z" },
  ];
  const attached = attachPaymentApprovals([parentApproved], txs);
  assert.equal(approvedRevenueAmount(attached[0]), 70);
  const dash = buildDashboardStats({
    profiles,
    orders: [parentApproved],
    paymentTransactions: txs,
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 70);
  assert.equal(dash.stats.validOrders, 1);
});

test("CASE5 cancelled / rejected unpaid not revenue", () => {
  assert.equal(countsAsRevenue({ ...parentApproved, status: "cancelled" }), false);
  assert.equal(countsAsRevenue({ ...parentApproved, status: "refunded" }), false);
  assert.equal(countsAsRevenue({ ...parentApproved, status: "awaiting_payment", paid_at: null, paid_cat_food: 0 }), false);
});

test("CASE6 nest allocations sum to parent; nest count=1", () => {
  const nested = nestParentOnlyOrders([parentApproved, c1, c2]);
  assert.equal(nested.length, 1);
  assert.equal(
    nested[0].allocations.reduce((s, a) => s + a.allocatedAmount, 0),
    70
  );
});

test("A=B reconcile shape: SUM(TX) == dashboard totalAmount", () => {
  const orders = [parentApproved, c1, c2];
  const txs = [{ order_id: "p70", boss_id: "b1", gross_amount: 70, payment_status: "paid" }];
  const dash = buildDashboardStats({ profiles, orders, paymentTransactions: txs, withdrawals: [] });
  const A = txs.filter((t) => t.payment_status === "paid").reduce((s, t) => s + Number(t.gross_amount), 0);
  const B = dash.stats.totalAmount;
  const C = new Set(txs.map((t) => t.order_id)).size;
  const D = dash.stats.validOrders;
  assert.equal(A, B);
  assert.equal(C, D);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
