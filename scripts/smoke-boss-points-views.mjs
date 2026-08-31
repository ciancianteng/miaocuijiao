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
  DEFAULT_POINTS_PER_CAT_FOOD,
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
assert(DEFAULT_POINTS_PER_CAT_FOOD === 10, "default points per 猫粮");
assert(DEFAULT_POINTS_PER_RM === DEFAULT_POINTS_PER_CAT_FOOD, "legacy alias");
assert(orderPointsIdempotencyKey("abc") === "order_points:abc", "idempotency key shape");
assert(
  orderPointsClawbackIdempotencyKey("abc") === "order_points_clawback:abc",
  "clawback key shape"
);

assert(orderEffectiveSpendAmount({ paid_cat_food: 38, total_amount: 40 }) === 38, "prefer paid_cat_food");
assert(orderEffectiveSpendAmount({ paid_cat_food: 0, total_amount: 128 }) === 128, "fallback total_amount");
assert(orderEffectiveSpendAmount({ total_amount: 8 }) === 8, "total only");

const settings = defaultBossPointsSettings();
assert(settings.pointsPerCatFood === 10 && settings.enabled === true, "default settings");
assert(settings.spendUnit === "cat_food", "spend unit is cat_food");
assert(computeOrderRewardPoints(8, settings) === 80, "8猫粮 → 80");
assert(computeOrderRewardPoints(38, settings) === 380, "38猫粮 → 380");
assert(computeOrderRewardPoints(128, settings) === 1280, "128猫粮 → 1280");
assert(computeOrderRewardPoints(10.9, { ...settings, roundingMode: "floor" }) === 109, "floor 10.9*10");

const capped = { ...settings, maxRewardPoints: 100 };
assert(computeOrderRewardPoints(50, capped) === 100, "max cap");

const disabled = { ...settings, enabled: false };
assert(computeOrderRewardPoints(50, disabled) === 0, "disabled → 0");

const minGate = { ...settings, minOrderCatFood: 20, minOrderAmount: 20 };
assert(computeOrderRewardPoints(10, minGate) === 0, "below min");
assert(computeOrderRewardPoints(20, minGate) === 200, "at min");

assert(parseNonNegNumber(-1, { fieldLabel: "x" }).ok === false, "reject negative");
assert(parseNonNegNumber(1.5, { integer: true, fieldLabel: "x" }).ok === false, "reject float int");
assert(viewPointsSettings(null).examples[0].label.includes("猫粮"), "example uses 猫粮");
assert(viewPointsSettings(null).examples[0].label.includes("100积分"), "example 10猫粮");

const empty = emptyPointsAccountView("u1");
assert(empty.balance === 0 && empty.outstandingDebt === 0, "empty account is zero");

const viewed = viewPointsAccount(
  {
    user_id: "u1",
    balance: 50,
    outstanding_debt: 330,
    lifetime_earned: 380,
    lifetime_spent: 50,
    lifetime_debt_opened: 330,
    lifetime_debt_repaid: 0,
    updated_at: "2026-08-31",
  },
  "u1"
);
assert(viewed.balance === 50 && viewed.outstandingDebt === 330, "account debt mapping");

const ledger = viewPointsLedgerRow({
  id: "l1",
  delta: -50,
  balance_after: 0,
  debt_delta: 330,
  debt_after: 330,
  clawback_target: 380,
  gross_points: 0,
  reason: "订单退款回退积分（应回收 380，已扣余额 50，记入欠款 330）",
  source: "order_refund_clawback",
  related_order_id: "ord-1",
  created_at: "2026-08-31T12:00:00Z",
  idempotency_key: "order_points_clawback:ord-1",
});
assert(ledger.deltaText === "-50", "clawback delta text");
assert(ledger.debtDelta === 330 && ledger.clawbackTarget === 380, "debt audit fields");
assert(ledger.sourceLabel === "订单退款回退积分", "clawback source label");

console.log("OK smoke-boss-points-views");
