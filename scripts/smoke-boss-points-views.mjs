/**
 * Smoke test for Boss points read helpers (no network).
 * Run: node scripts/smoke-boss-points-views.mjs
 */
import {
  emptyPointsAccountView,
  orderPointsIdempotencyKey,
  ORDER_COMPLETION_POINTS,
  viewPointsAccount,
  viewPointsLedgerRow,
} from "../server/api/_user-points.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(ORDER_COMPLETION_POINTS === 100, "phase1 award is +100");
assert(orderPointsIdempotencyKey("abc") === "order_points:abc", "idempotency key shape");

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
assert(ledger.relatedOrderId === "ord-1", "order id");
assert(ledger.sourceLabel.includes("订单完成"), "source label");

console.log("OK smoke-boss-points-views");
