#!/usr/bin/env node
/**
 * Offline regression: completed business order count SoT (parent-only).
 * Covers cancelled/paid-not-completed/rejected/refunded/multi/child/audit dupes.
 */
import assert from "node:assert/strict";
import {
  buildDashboardStats,
  countsAsRevenue,
  isBusinessOrderRoot,
  isRealCompletedBusinessOrder,
} from "../server/api/admin/dashboard.js";
import {
  countCompletedBusinessOrders,
  listCompletedBusinessOrders,
} from "../server/api/_business-order-stats.js";
import { buildHomeDailyStatsPayload } from "../server/api/home/daily-stats.js";

const boss = { id: "boss-1", role: "boss", email: "boss@gmail.com", display_name: "B", status: "active" };
const comp = { id: "comp-1", role: "companion", email: "c@gmail.com", display_name: "C", status: "active" };
const profiles = [boss, comp];

function dash(orders, paymentTransactions = []) {
  const normalized = (orders || []).map((o) =>
    Object.prototype.hasOwnProperty.call(o, "parent_order_id") || Object.prototype.hasOwnProperty.call(o, "parentOrderId")
      ? o
      : { ...o, parent_order_id: null }
  );
  return buildDashboardStats({
    profiles,
    orders: normalized,
    paymentTransactions,
    withdrawals: [],
    now: new Date("2026-09-26T04:00:00.000Z"),
  });
}

// CASE 1: standalone completed => +1
{
  const orders = [{ id: "s1", status: "completed", total_amount: 40, boss_id: boss.id, companion_id: comp.id }];
  assert.equal(countCompletedBusinessOrders(orders), 1);
  assert.equal(dash(orders).stats.completed, 1);
}

// CASE 2: cancelled => +0
{
  const orders = [{ id: "s2", status: "cancelled", total_amount: 40, boss_id: boss.id, companion_id: comp.id }];
  assert.equal(dash(orders).stats.completed, 0);
}

// CASE 3: paid but not completed => +0 completed (may still be revenue)
{
  const orders = [
    {
      id: "s3",
      status: "in_progress",
      total_amount: 40,
      paid_at: "2026-09-26T01:00:00.000Z",
      paid_cat_food: 40,
      boss_id: boss.id,
      companion_id: comp.id,
    },
  ];
  assert.equal(dash(orders).stats.completed, 0);
  assert.equal(countsAsRevenue(orders[0]), true);
}

// CASE 4: payment rejected / awaiting => +0
{
  const orders = [{ id: "s4", status: "awaiting_payment", total_amount: 40, boss_id: boss.id }];
  assert.equal(dash(orders).stats.completed, 0);
  assert.equal(countsAsRevenue(orders[0]), false);
}

// CASE 5: refunded => +0 completed
{
  const orders = [{ id: "s5", status: "refunded", total_amount: 40, paid_at: "2026-09-01T00:00:00.000Z", boss_id: boss.id }];
  assert.equal(dash(orders).stats.completed, 0);
}

// CASE 6: parent + 2 children all completed => completed +1 only; GMV = parent once
{
  const parent = {
    id: "p1",
    status: "completed",
    total_amount: 70,
    paid_at: "2026-09-26T01:00:00.000Z",
    paid_cat_food: 70,
    boss_id: boss.id,
    order_type: "multi_group",
    parent_order_id: null,
  };
  const c1 = {
    id: "c1",
    status: "completed",
    total_amount: 35,
    boss_id: boss.id,
    companion_id: "comp-a",
    parent_order_id: "p1",
    order_type: "direct_companion",
  };
  const c2 = {
    id: "c2",
    status: "completed",
    total_amount: 35,
    boss_id: boss.id,
    companion_id: "comp-b",
    parent_order_id: "p1",
    order_type: "direct_companion",
  };
  assert.equal(isBusinessOrderRoot(parent), true);
  assert.equal(isBusinessOrderRoot(c1), false);
  assert.equal(isRealCompletedBusinessOrder(c1), false);
  const d = dash([parent, c1, c2]);
  assert.equal(d.stats.completed, 1, "CASE6 completed must be 1");
  assert.equal(d.stats.totalAmount, 70, "CASE6 GMV parent once");
  assert.equal(d.filter.childOrdersSkipped, 2);
}

// CASE 7: children completed, parent not completed => business completed +0
{
  const parent = {
    id: "p2",
    status: "in_progress",
    total_amount: 70,
    paid_at: "2026-09-26T01:00:00.000Z",
    paid_cat_food: 70,
    boss_id: boss.id,
    order_type: "multi_group",
  };
  const c1 = { id: "c3", status: "completed", total_amount: 35, parent_order_id: "p2", boss_id: boss.id };
  const c2 = { id: "c4", status: "completed", total_amount: 35, parent_order_id: "p2", boss_id: boss.id };
  assert.equal(dash([parent, c1, c2]).stats.completed, 0);
}

// CASE 8: two payment review/TX rows on same parent => completed still +1; GMV not doubled
{
  const parent = {
    id: "p3",
    status: "completed",
    total_amount: 70,
    paid_at: "2026-09-26T01:00:00.000Z",
    boss_id: boss.id,
  };
  const txs = [
    { order_id: "p3", payment_status: "paid", gross_amount: 70, confirmed_at: "2026-09-26T01:00:00.000Z" },
    { order_id: "p3", payment_status: "paid", gross_amount: 70, confirmed_at: "2026-09-26T01:05:00.000Z" },
  ];
  const d = dash([parent], txs);
  assert.equal(d.stats.completed, 1);
  assert.equal(d.stats.totalAmount, 70);
}

// CASE 9: historical payment TX with no matching completed business order => +0
{
  const txs = [{ order_id: "missing", payment_status: "paid", gross_amount: 70, confirmed_at: "2026-09-26T01:00:00.000Z" }];
  const d = dash([], txs);
  assert.equal(d.stats.completed, 0);
  assert.equal(d.stats.totalAmount, 0);
}

  // Prod incident replay: 4 parents + 4 children => 4; omitting parent_order_id must fail closed
  {
    const roots = ["419", "415", "357", "356"].map((n) => ({
      id: `root-${n}`,
      order_no: `MCJO000${n}`,
      status: "completed",
      total_amount: n === "419" ? 140 : n === "415" ? 70 : 30,
      paid_at: "2026-09-25T15:00:00.000Z",
      paid_cat_food: n === "419" ? 140 : n === "415" ? 70 : 30,
      boss_id: boss.id,
      parent_order_id: null,
    }));
    const children = [
      { id: "ch-421", status: "completed", total_amount: 70, parent_order_id: "root-419", boss_id: boss.id },
      { id: "ch-420", status: "completed", total_amount: 70, parent_order_id: "root-419", boss_id: boss.id },
      { id: "ch-417", status: "completed", total_amount: 35, parent_order_id: "root-415", boss_id: boss.id },
      { id: "ch-416", status: "completed", total_amount: 35, parent_order_id: "root-415", boss_id: boss.id },
    ];
    const orders = [...roots, ...children];
    const d = dash(orders);
    assert.equal(d.stats.completed, 4);
    assert.equal(d.stats.totalAmount, 140 + 70 + 30 + 30);
    const home = buildHomeDailyStatsPayload({ profiles, orders, onlineCompanions: 1, reviews: [], now: new Date() });
    assert.equal(home.completedOrders, 4);
    const stripped = orders.map(({ parent_order_id, ...rest }) => rest);
    assert.throws(
      () =>
        buildDashboardStats({
          profiles,
          orders: stripped,
          withdrawals: [],
          now: new Date("2026-09-26T04:00:00.000Z"),
        }),
      /parent_order_id/
    );
    assert.equal(listCompletedBusinessOrders(orders).length, 4);
  }

console.log("verify-completed-business-order-count: PASS");
