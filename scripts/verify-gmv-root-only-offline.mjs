#!/usr/bin/env node
/**
 * Offline: GMV root-only + multi-order plan (no DB writes).
 */
import assert from "node:assert/strict";
import {
  buildDashboardStats,
  countsAsRevenue,
  isBusinessOrderRoot,
} from "../server/api/admin/dashboard.js";
import { simulatePlaceMultiOrderPlan } from "../server/api/_order-group.js";

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

test("TEST1 parent+2 children GMV = 70 not 140", () => {
  const parent = {
    id: "p1",
    parent_order_id: null,
    order_type: "multi_group",
    status: "claimed",
    total_amount: 70,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  const c1 = {
    id: "c1",
    parent_order_id: "p1",
    order_type: "direct_companion",
    status: "claimed",
    total_amount: 35,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  const c2 = {
    id: "c2",
    parent_order_id: "p1",
    order_type: "direct_companion",
    status: "claimed",
    total_amount: 35,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  assert.equal(isBusinessOrderRoot(parent), true);
  assert.equal(isBusinessOrderRoot(c1), false);
  assert.equal(countsAsRevenue(c1), true); // status would count IF wrongly included
  const dash = buildDashboardStats({
    profiles: [{ id: "b1", role: "boss", status: "active", email: "b@x.com" }],
    orders: [parent, c1, c2],
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 70);
  assert.equal(dash.filter.childOrdersSkipped, 2);
});

test("TEST2 cancelled parent excluded from GMV", () => {
  const parent = {
    id: "p2",
    parent_order_id: null,
    order_type: "multi_group",
    status: "cancelled",
    total_amount: 70,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  const dash = buildDashboardStats({
    profiles: [{ id: "b1", role: "boss", status: "active", email: "b@x.com" }],
    orders: [parent],
    withdrawals: [],
  });
  assert.equal(dash.stats.totalAmount, 0);
});

test("TEST3 simulate multi plan 1 parent 2 children", () => {
  const plan = simulatePlaceMultiOrderPlan({
    companions: [
      { companionId: "a", amount: 35 },
      { companionId: "b", amount: 35 },
    ],
    idempotencyKey: "pom-test-1",
  });
  assert.equal(plan.parent.total_amount, 70);
  assert.equal(plan.children.length, 2);
  assert.equal(plan.walletDebitOnce, 70);
  assert.equal(plan.walletDebitCount, 1);
});

test("TEST4 refunded excluded", () => {
  const parent = {
    id: "p3",
    parent_order_id: null,
    order_type: "multi_group",
    status: "refunded",
    total_amount: 70,
    created_at: new Date().toISOString(),
    boss_id: "b1",
  };
  assert.equal(countsAsRevenue(parent), false);
});

test("TEST5 awaiting_payment excluded", () => {
  assert.equal(
    countsAsRevenue({ status: "awaiting_payment", total_amount: 70 }),
    false
  );
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
