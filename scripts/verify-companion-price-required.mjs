/**
 * Permanent contract:
 * - Price required for application submit + first approval only.
 * - Admin correction/edit of already-approved companions must NEVER be blocked
 *   by submission validation (even when price is currently missing).
 * - Public listing gate is separate and unchanged.
 */
import assert from "node:assert/strict";
import {
  hasPositivePrice,
  priceCheckRow,
  assertHasPositivePrice,
  isApprovedApplicationStatus,
  isFirstApprovalTransition,
  MISSING_PRICE_MESSAGE,
} from "../server/api/_companion-publish-gate.js";

assert.equal(hasPositivePrice({ price: 0, game_prices: {} }), false);
assert.equal(hasPositivePrice({ price: 10 }), true);
assert.equal(hasPositivePrice({ price: 0, game_prices: { apex: 25 } }), true);
assert.equal(hasPositivePrice({ price: "0", gamePrices: { valorant: "0" } }), false);
assert.equal(hasPositivePrice(priceCheckRow({ hourlyPrice: 18 })), true);
assert.equal(hasPositivePrice(priceCheckRow({ gamePriceMap: { mlbb: 12 } })), true);
assert.equal(hasPositivePrice(priceCheckRow({ price: 0 }, { price: 0, game_prices: {} })), false);
assert.equal(hasPositivePrice(priceCheckRow({ price: 0 }, { game_prices: { x: 8 } })), true);

assert.throws(
  () => assertHasPositivePrice({ price: 0, game_prices: {} }),
  (err) => err && err.code === "MISSING_PRICE" && String(err.message).includes("接单价格")
);
assert.equal(assertHasPositivePrice({ price: 1 }), true);
assert.ok(MISSING_PRICE_MESSAGE);

assert.equal(isApprovedApplicationStatus("approved"), true);
assert.equal(isApprovedApplicationStatus("pending"), false);

// First approval: pending -> approved => enforce
assert.equal(isFirstApprovalTransition({ application_status: "pending" }, "approved"), true);
assert.equal(isFirstApprovalTransition({ application_status: "resubmit" }, "approved"), true);

// Already approved: admin correction/edit / re-save approved => never enforce
assert.equal(isFirstApprovalTransition({ application_status: "approved", price: 0 }, "approved"), false);
assert.equal(isFirstApprovalTransition({ verification_status: "approved", price: 0 }, "approved"), false);

// Non-approval edits do not trigger first-approval transition
assert.equal(isFirstApprovalTransition({ application_status: "approved" }, "pending"), false);
assert.equal(isFirstApprovalTransition({ application_status: "approved" }, ""), false);

console.log("verify-companion-price-required: ok");
