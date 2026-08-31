/**
 * Smoke test for Boss points rate helpers (no network).
 * Run: node scripts/smoke-boss-points-views.mjs
 */
import {
  emptyPointsAccountView,
  orderPointsIdempotencyKey,
  orderPointsClawbackIdempotencyKey,
  ORDER_COMPLETION_POINTS,
  DEFAULT_ORDER_COMPLETION_POINTS,
  DEFAULT_POINTS_PER_RM,
  orderEffectiveSpendAmount,
  computeOrderRewardPoints,
  viewPointsSettings,
  defaultBossPointsSettings,
  parseNonNegNumber,
  viewPointsAccount,
  viewPointsLedgerRow,
} from "../server/api/_user-points.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(ORDER_COMPLETION_POINTS === 100, "legacy fallback constant");
assert(DEFAULT_ORDER_COMPLETION_POINTS === 100, "DEFAULT_ORDER_COMPLETION_POINTS");
assert(DEFAULT_POINTS_PER_RM === 10, "default points per RM");
assert(orderPointsIdempotencyKey("abc") === "order_points:abc", "idempotency key shape");
assert(
  orderPointsClawbackIdempotencyKey("abc") === "order_points_clawback:abc",
  "clawback key shape"
);

assert(orderEffectiveSpendAmount({ paid_cat_food: 38, total_amount: 40 }) === 38, "prefer paid_cat_food");
assert(orderEffectiveSpendAmount({ paid_cat_food: 0, total_amount: 128 }) === 128, "fallback total_amount");
assert(orderEffectiveSpendAmount({ total_amount: 8 }) === 8, "total only");

const settings = defaultBossPointsSettings();
assert(settings.pointsPerRm === 10 && settings.enabled === true, "default settings");
assert(computeOrderRewardPoints(8, settings) === 80, "RM8 → 80");
assert(computeOrderRewardPoints(38, settings) === 380, "RM38 → 380");
assert(computeOrderRewardPoints(128, settings) === 1280, "RM128 → 1280");
assert(computeOrderRewardPoints(10.9, { ...settings, roundingMode: "floor" }) === 109, "floor 10.9*10");

const capped = { ...settings, maxRewardPoints: 100 };
assert(computeOrderRewardPoints(50, capped) === 100, "max cap");

const disabled = { ...settings, enabled: false };
assert(computeOrderRewardPoints(50, disabled) === 0, "disabled → 0");

const minGate = { ...settings, minOrderAmount: 20 };
assert(computeOrderRewardPoints(10, minGate) === 0, "below min");
assert(computeOrderRewardPoints(20, minGate) === 200, "at min");

assert(parseNonNegNumber(-1, { fieldLabel: "x" }).ok === false, "reject negative");
assert(parseNonNegNumber(1.5, { integer: true, fieldLabel: "x" }).ok === false, "reject float int");
assert(viewPointsSettings(null).examples[0].label.includes("100积分"), "example RM10");

const empty = emptyPointsAccountView("u1");
assert(empty.balance === 0 && empty.lifetimeEarned === 0, "empty account is zero");

const viewed = viewPointsAccount(
  { user_id: "u1", balance: 200, lifetime_earned: 300, lifetime_spent: 100, updated_at: "2026-08-30" },
  "u1"
);
assert(viewed.balance === 200 && viewed.lifetimeEarned === 300, "account view mapping");

const ledger = viewPointsLedgerRow({
  id: "l1",
  delta: 100,
  balance_after: 100,
  reason: "订单完成奖励",
  source: "order_complete_boss",
  related_order_id: "ord-1",
  created_at: "2026-08-30T12:00:00Z",
  idempotency_key: "order_points:ord-1",
});
assert(ledger.deltaText === "+100", "delta text");
assert(ledger.statusText === "已入账", "status text");

console.log("OK smoke-boss-points-views");
