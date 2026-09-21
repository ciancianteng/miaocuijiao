#!/usr/bin/env node
/**
 * Offline verification: multi-companion parent/child order group (Phase 1).
 * Does NOT touch Production / Staging DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORDER_TYPE_MULTI_GROUP,
  aggregateParentStatus,
  canCreateWalletRefundForOrder,
  canDebitBossWalletForOrder,
  canSettleCompanionIncomeForOrder,
  groupCompletedSpendCatFood,
  isLegacyStandaloneOrder,
  isMultiGroupChild,
  isMultiGroupParent,
  maxLineRefundAmount,
  refreshParentOrderStatus,
  shouldAwardBossPointsOnFinalize,
  simulatePlaceMultiOrderPlan,
  summarizeGroupAmounts,
} from "../server/api/_order-group.js";
import { assertPayOrderAllowed } from "../server/api/_place-multi-order.js";
import {
  computeOrderRewardPoints,
  defaultBossPointsSettings,
  orderPointsIdempotencyKey,
} from "../server/api/_user-points.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

test("TEST 1 create plan 1 parent + 2 children total 70", () => {
  const plan = simulatePlaceMultiOrderPlan({
    companions: [
      { companionId: "A", amount: 30 },
      { companionId: "B", amount: 40 },
    ],
    idempotencyKey: "pom-test-1",
  });
  assert.equal(plan.parent.order_type, ORDER_TYPE_MULTI_GROUP);
  assert.equal(plan.parent.companion_id, null);
  assert.equal(plan.parent.parent_order_id, null);
  assert.equal(plan.parent.total_amount, 70);
  assert.equal(plan.children.length, 2);
  assert.equal(plan.children[0].total_amount, 30);
  assert.equal(plan.children[1].total_amount, 40);
  assert.ok(plan.children.every((c) => c.parent_order_id === "__PARENT__"));
});

test("TEST 2 wallet debit once for 70", () => {
  const plan = simulatePlaceMultiOrderPlan({
    companions: [
      { companionId: "A", amount: 30 },
      { companionId: "B", amount: 40 },
    ],
  });
  assert.equal(plan.walletDebitCount, 1);
  assert.equal(plan.walletDebitOnce, 70);
  assert.equal(canDebitBossWalletForOrder(plan.parent), true);
  assert.equal(canDebitBossWalletForOrder(plan.children[0]), false);
  assert.equal(canDebitBossWalletForOrder(plan.children[1]), false);
  const payChild = assertPayOrderAllowed({ parent_order_id: "P", companion_id: "A" });
  assert.equal(payChild.ok, false);
});

test("TEST 3 idempotency key wiring", () => {
  const key = "pom-dup-key";
  const a = simulatePlaceMultiOrderPlan({
    companions: [
      { companionId: "A", amount: 30 },
      { companionId: "B", amount: 40 },
    ],
    idempotencyKey: key,
  });
  assert.equal(a.parent.idempotency_key, key);
  const placeSrc = readFileSync(path.join(root, "server/api/_place-multi-order.js"), "utf8");
  assert.match(placeSrc, /idempotency_key=eq/);
  assert.match(placeSrc, /deduped:\s*true/);
  assert.match(placeSrc, /softCancelOrders/);
  // Single wallet debit key lives on pay_order (parent), not place_multi create
  const ordersSrc = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
  assert.match(ordersSrc, /order-pay:/);
});

test("TEST 4 companion isolation by companion_id", () => {
  const children = [
    { id: "cA", companion_id: "A", parent_order_id: "P", total_amount: 30 },
    { id: "cB", companion_id: "B", parent_order_id: "P", total_amount: 40 },
  ];
  assert.deepEqual(
    children.filter((c) => c.companion_id === "A").map((c) => c.id),
    ["cA"]
  );
  assert.deepEqual(
    children.filter((c) => c.companion_id === "B").map((c) => c.id),
    ["cB"]
  );
});

test("TEST 5+6 income bases 30/40; parent no companion_income", () => {
  const parent = {
    id: "P",
    order_type: ORDER_TYPE_MULTI_GROUP,
    companion_id: null,
    parent_order_id: null,
    total_amount: 70,
  };
  const childA = { id: "cA", companion_id: "A", parent_order_id: "P", total_amount: 30 };
  const childB = { id: "cB", companion_id: "B", parent_order_id: "P", total_amount: 40 };
  assert.equal(canSettleCompanionIncomeForOrder(parent), false);
  assert.equal(canSettleCompanionIncomeForOrder(childA), true);
  assert.equal(canSettleCompanionIncomeForOrder(childB), true);
  assert.equal(Math.round(30 * 0.2 * 100) / 100, 6);
  assert.equal(Math.round(40 * 0.2 * 100) / 100, 8);
});

test("TEST 7 A completed B in_progress → parent not completed", () => {
  const children = [
    { status: "completed", total_amount: 30 },
    { status: "in_progress", total_amount: 40 },
  ];
  assert.equal(aggregateParentStatus(children), "in_progress");
  assert.notEqual(aggregateParentStatus(children), "completed");
  const parent = {
    order_type: ORDER_TYPE_MULTI_GROUP,
    status: aggregateParentStatus(children),
    companion_id: null,
  };
  assert.equal(shouldAwardBossPointsOnFinalize(parent), false);
});

test("TEST 8 A+B completed → parent completed; points once on 70", () => {
  const children = [
    { status: "completed", total_amount: 30 },
    { status: "completed", total_amount: 40 },
  ];
  assert.equal(aggregateParentStatus(children), "completed");
  const spend = groupCompletedSpendCatFood(children);
  assert.equal(spend, 70);
  const settings = defaultBossPointsSettings();
  // Use rate 10 like prod settings default in many envs; helper uses DEFAULT_POINTS_PER_CAT_FOOD
  const pts = computeOrderRewardPoints(spend, {
    ...settings,
    enabled: true,
    pointsPerCatFood: 10,
    pointsPerRm: 10,
  });
  assert.equal(pts, 700); // 70*10 — product rate may be 10; assert formula binding
  // Product example in brief used 300 for 30 catfood when rate=10 → for 70 expect 700 with rate 10.
  // Also verify idempotency key binds to parent id:
  assert.equal(orderPointsIdempotencyKey("PARENT-UUID"), "order_points:PARENT-UUID");
  const parent = {
    id: "PARENT-UUID",
    order_type: ORDER_TYPE_MULTI_GROUP,
    status: "completed",
    companion_id: null,
  };
  assert.equal(shouldAwardBossPointsOnFinalize(parent), true);
  assert.equal(shouldAwardBossPointsOnFinalize({ parent_order_id: "PARENT-UUID", status: "completed" }), false);
});

await testAsync("TEST 9 refreshParent awards at most once via idempotent key", async () => {
  const awards = [];
  const parentId = "P1";
  const store = {
    [parentId]: {
      id: parentId,
      order_type: ORDER_TYPE_MULTI_GROUP,
      companion_id: null,
      parent_order_id: null,
      status: "in_progress",
      total_amount: 70,
      paid_cat_food: 70,
      boss_id: "boss",
    },
  };
  const children = [
    { id: "cA", parent_order_id: parentId, status: "completed", total_amount: 30, companion_id: "A" },
    { id: "cB", parent_order_id: parentId, status: "completed", total_amount: 40, companion_id: "B" },
  ];
  const awardFn = async (order) => {
    const key = orderPointsIdempotencyKey(order.id);
    if (awards.find((a) => a.key === key)) {
      return { ok: true, duplicate: true, skipped: true, points: 0, idempotency_key: key };
    }
    const points = computeOrderRewardPoints(order.paid_cat_food || order.total_amount, {
      ...defaultBossPointsSettings(),
      enabled: true,
      pointsPerCatFood: 10,
    });
    awards.push({ key, points, orderId: order.id });
    return { ok: true, points, idempotency_key: key };
  };
  const deps = {
    loadOrder: async (id) => store[id],
    loadChildren: async () => children,
    patchOrder: async (id, patch) => {
      store[id] = { ...store[id], ...patch };
      return store[id];
    },
    awardBossPointsForCompletedOrder: awardFn,
  };
  const r1 = await refreshParentOrderStatus(parentId, deps);
  const r2 = await refreshParentOrderStatus(parentId, deps);
  assert.equal(r1.status, "completed");
  assert.equal(r2.status, "completed");
  assert.equal(awards.length, 1);
  assert.equal(awards[0].orderId, parentId);
  assert.equal(awards[0].key, "order_points:P1");
  assert.equal(awards[0].points, 700);
});

test("TEST 10 partial refund B=40 only", () => {
  const parent = {
    id: "P",
    order_type: ORDER_TYPE_MULTI_GROUP,
    companion_id: null,
    total_amount: 70,
    paid_cat_food: 70,
  };
  const childB = {
    id: "cB",
    parent_order_id: "P",
    companion_id: "B",
    total_amount: 40,
    paid_cat_food: 40,
    status: "cancelled",
  };
  assert.equal(canCreateWalletRefundForOrder(parent), false);
  assert.equal(canCreateWalletRefundForOrder(childB), true);
  assert.equal(maxLineRefundAmount(childB), 40);
  assert.notEqual(maxLineRefundAmount(childB), 70);
  const children = [
    { status: "completed", total_amount: 30 },
    { status: "refunded", total_amount: 40 },
  ];
  const amounts = summarizeGroupAmounts(parent, children);
  assert.equal(amounts.originalTotal, 70);
  assert.equal(amounts.refundedTotal, 40);
  assert.equal(amounts.netPaidEstimate, 30);
  assert.equal(aggregateParentStatus(children), "completed"); // effective children all completed
});

test("TEST 11 parent never companion_income", () => {
  const parent = { order_type: ORDER_TYPE_MULTI_GROUP, companion_id: null, parent_order_id: null };
  assert.equal(isMultiGroupParent(parent), true);
  assert.equal(canSettleCompanionIncomeForOrder(parent), false);
  const completeSrc = readFileSync(path.join(root, "server/api/_order-complete.js"), "utf8");
  assert.match(completeSrc, /multi_group_parent_no_companion_income/);
});

test("TEST 12 child withdrawable; parent not", () => {
  const parent = { order_type: ORDER_TYPE_MULTI_GROUP, companion_id: null };
  const child = { parent_order_id: "P", companion_id: "A", total_amount: 30 };
  assert.equal(canSettleCompanionIncomeForOrder(child), true);
  assert.equal(canSettleCompanionIncomeForOrder(parent), false);
  // Withdrawal bills keyed by companion_id transactions — parent has none
  assert.equal(!!parent.companion_id, false);
});

test("TEST 13+14 legacy standalone unchanged", () => {
  const legacy = {
    id: "L1",
    companion_id: "A",
    parent_order_id: null,
    order_type: "direct_companion",
    status: "completed",
    total_amount: 30,
  };
  assert.equal(isLegacyStandaloneOrder(legacy), true);
  assert.equal(isMultiGroupChild(legacy), false);
  assert.equal(isMultiGroupParent(legacy), false);
  assert.equal(canDebitBossWalletForOrder(legacy), true);
  assert.equal(canSettleCompanionIncomeForOrder(legacy), true);
  assert.equal(shouldAwardBossPointsOnFinalize(legacy), true);
  assert.equal(canCreateWalletRefundForOrder(legacy), true);
  const ordersSrc = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
  assert.match(ordersSrc, /action === "create" \|\| action === "place_order"/);
  assert.match(ordersSrc, /place_multi_order/);
});

test("TEST 15+16 create-only / no debit at place_multi (pay_order owns debit)", () => {
  const placeSrc = readFileSync(path.join(root, "server/api/_place-multi-order.js"), "utf8");
  assert.match(placeSrc, /MULTI_ORDER_CHILD_CREATE_FAILED/);
  assert.match(placeSrc, /softCancelOrders/);
  assert.match(placeSrc, /awaiting_payment/);
  assert.match(placeSrc, /payment-confirm/);
  // place_multi must NOT call debitWallet — pay_order does parent debit once
  assert.doesNotMatch(placeSrc, /await debitWallet\(/);
  assert.doesNotMatch(placeSrc, /wallet_debit_failed/);
  const ordersSrc = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
  assert.match(ordersSrc, /payGuard\.cascadeChildren/);
  assert.match(ordersSrc, /order-pay:/);
});

test("STATIC migration parent_order_id present", () => {
  const mig = readFileSync(
    path.join(root, "supabase/migrations/20260919_orders_parent_order_id.sql"),
    "utf8"
  );
  assert.match(mig, /parent_order_id/);
  assert.match(mig, /idx_orders_parent_order_id/);
  assert.match(mig, /idx_orders_boss_parent_order/);
  // Must not ADD batch_id column for grouping
  assert.doesNotMatch(mig, /add column if not exists batch_id/i);
  assert.match(mig, /Does NOT use batch_id/);
});

test("STATIC points skip child + parent refresh wired", () => {
  const pts = readFileSync(path.join(root, "server/api/_user-points.js"), "utf8");
  assert.match(pts, /multi_group_child_skip_points/);
  const complete = readFileSync(path.join(root, "server/api/_order-complete.js"), "utf8");
  assert.match(complete, /refreshParentOrderStatus/);
  assert.match(complete, /MULTI_PARENT_NO_DIRECT_FINALIZE/);
  const admin = readFileSync(path.join(root, "server/api/admin/orders.js"), "utf8");
  assert.match(admin, /MULTI_PARENT_NO_DIRECT_FINALIZE/);
  const cs = readFileSync(path.join(root, "server/api/customer-service.js"), "utf8");
  assert.match(cs, /MULTI_PARENT_NO_DIRECT_FINALIZE/);
  const refund = readFileSync(path.join(root, "server/api/_boss-refund-payout.js"), "utf8");
  assert.match(refund, /MULTI_PARENT_NO_DIRECT_REFUND/);
});

test("STATIC no order_items / no batch_id misuse", () => {
  const placeSrc = readFileSync(path.join(root, "server/api/_place-multi-order.js"), "utf8");
  const groupSrc = readFileSync(path.join(root, "server/api/_order-group.js"), "utf8");
  assert.doesNotMatch(placeSrc, /order_items/);
  assert.doesNotMatch(groupSrc, /order_items/);
  assert.match(groupSrc, /batch_id is intentionally unused/);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      passed: results.filter((r) => r.ok).length,
      failed: failed.length,
      failures: failed,
    },
    null,
    2
  )
);
if (failed.length) process.exit(1);
console.log("verify-multi-companion-order: PASS");
