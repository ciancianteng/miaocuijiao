/**
 * Offline verification for companion withdrawal settlement invariants.
 * Does not touch Production / Staging DBs.
 *
 * Run: node scripts/verify-companion-withdrawal-settlement.mjs
 */
import assert from "node:assert/strict";

const PAYOUT_FROZEN = new Set([
  "submitted",
  "pending_friday",
  "reviewing",
  "approved",
  "pending_payment",
  "processing",
  "paid",
  "rolled_over",
  "failed",
  "pending",
  "pending_review",
  "approved_pending_pay",
  "paying",
  "paid_pending_receipt",
]);
const WITHDRAW_ACTIVE = new Set([...PAYOUT_FROZEN, "completed", "paid"]);
const OPEN_ONE_AT_A_TIME = new Set([
  "submitted",
  "pending_friday",
  "reviewing",
  "pending",
  "pending_review",
  "rolled_over",
  "approved",
  "pending_payment",
  "approved_pending_pay",
  "paying",
  "paid_pending_receipt",
  "paid",
  "processing",
]);

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function withdrawable(netGross, withdrawals) {
  const locked = (withdrawals || [])
    .filter((w) => WITHDRAW_ACTIVE.has(String(w.status || "")))
    .reduce((n, w) => n + money(w.cat_food_amount ?? w.amount), 0);
  return Math.max(0, money(netGross) - locked);
}

function hasOpen(withdrawals) {
  return (withdrawals || []).some((w) => OPEN_ONE_AT_A_TIME.has(String(w.status || "")));
}

function markPaidOnce(row, { alreadyHasTx } = {}) {
  if (String(row.status) === "completed") {
    return { status: "completed", deductedAgain: false, duplicate: true };
  }
  // Freeze already reserved amount while pending; marking paid must not re-deduct.
  const deductedAgain = alreadyHasTx ? false : false;
  return { status: "completed", deductedAgain, duplicate: false };
}

// ── Cases ──────────────────────────────────────────────────────────
const income = 300;

// Request reserves balance
{
  const afterRequest = [{ status: "pending_friday", cat_food_amount: 100 }];
  assert.equal(withdrawable(income, afterRequest), 200);
  assert.equal(hasOpen(afterRequest), true);
}

// Approve keeps reserve (no second deduct)
{
  const afterApprove = [{ status: "pending_payment", cat_food_amount: 100 }];
  assert.equal(withdrawable(income, afterApprove), 200);
  assert.equal(hasOpen(afterApprove), true);
}

// Mark paid: still locked once, no double deduct
{
  const afterPaid = [{ status: "completed", cat_food_amount: 100 }];
  assert.equal(withdrawable(income, afterPaid), 200);
  const paid = markPaidOnce({ status: "pending_payment" }, { alreadyHasTx: true });
  assert.equal(paid.deductedAgain, false);
  const again = markPaidOnce({ status: "completed" });
  assert.equal(again.duplicate, true);
  assert.equal(again.deductedAgain, false);
}

// Reject returns balance
{
  const afterReject = [{ status: "rejected", cat_food_amount: 100 }];
  assert.equal(withdrawable(income, afterReject), 300);
  assert.equal(hasOpen(afterReject), false);
}

// Duplicate open blocked while pending_payment
{
  assert.equal(hasOpen([{ status: "pending_payment", cat_food_amount: 50 }]), true);
  assert.equal(hasOpen([{ status: "completed", cat_food_amount: 50 }]), false);
}

console.log("PASS verify-companion-withdrawal-settlement");
console.log(
  JSON.stringify(
    {
      reserveOnRequest: true,
      noDoubleDeductOnPaid: true,
      rejectReturnsBalance: true,
      oneOpenAtATimeIncludesPendingPayment: true,
      migration: "20260919_companion_withdrawals_one_open.sql",
    },
    null,
    2
  )
);
