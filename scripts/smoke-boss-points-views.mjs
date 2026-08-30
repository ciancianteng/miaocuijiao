/**
 * Smoke test for Boss points read helpers (no network).
 * Run: node scripts/smoke-boss-points-views.mjs
 */
import {
  emptyPointsAccountView,
  orderPointsIdempotencyKey,
  ORDER_COMPLETION_POINTS,
  DEFAULT_ORDER_COMPLETION_POINTS,
  parseOrderCompletionPoints,
  viewPointsAccount,
  viewPointsLedgerRow,
  viewPointsSettings,
} from "../server/api/_user-points.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(ORDER_COMPLETION_POINTS === 100, "fallback default is +100");
assert(DEFAULT_ORDER_COMPLETION_POINTS === 100, "DEFAULT_ORDER_COMPLETION_POINTS is 100");
assert(orderPointsIdempotencyKey("abc") === "order_points:abc", "idempotency key shape");
assert(parseOrderCompletionPoints(150).ok && parseOrderCompletionPoints(150).value === 150, "parse 150");
assert(parseOrderCompletionPoints(0).ok && parseOrderCompletionPoints(0).value === 0, "parse 0");
assert(!parseOrderCompletionPoints(-1).ok, "reject negative");
assert(!parseOrderCompletionPoints(1.5).ok, "reject float");
assert(!parseOrderCompletionPoints("12.0").ok, "reject decimal string");
assert(viewPointsSettings(null).orderCompletionPoints === 100, "settings fallback");
assert(viewPointsSettings({ order_completion_points: 80 }).orderCompletionPoints === 80, "settings row");

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

// Universal (no hardcoded emails / UUIDs in read helpers).
const src = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../server/api/points.js", import.meta.url), "utf8")
);
assert(!/ciancianteng@gmail\.com/i.test(src), "points API must not hardcode test email");
assert(!/boss@meow\.test/i.test(src), "points API must not hardcode test boss");
assert(/profile\.id/.test(src), "points API must use token profile.id");
assert(!/req\.query\.user_id|body\.user_id/.test(src), "must not trust client user_id");

console.log("OK smoke-boss-points-views");
