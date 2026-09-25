#!/usr/bin/env node
/**
 * Offline verifies for _payment-gates.js
 * node scripts/verify-payment-cs-gates-offline.mjs
 */
import assert from "node:assert/strict";
import {
  assertLegalStatusJump,
  assertManualProofBeforeCsApprove,
  assertCsApprovedBeforeCompanionStage,
  assertMultiPayOrderRequiresCsPath,
  isManualPaymentMethod,
  isWalletPaymentMethod,
} from "../server/api/_payment-gates.js";

function throws(fn, code) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected throw");
  if (code) assert.equal(err.code, code);
}

assert.equal(isWalletPaymentMethod("catfood"), true);
assert.equal(isManualPaymentMethod("duitnow"), true);
assert.equal(isManualPaymentMethod("catfood"), false);

throws(() => assertLegalStatusJump("awaiting_payment", "confirmed"), "ILLEGAL_STATUS_TRANSITION");
throws(() => assertLegalStatusJump("awaiting_payment", "in_progress"), "ILLEGAL_STATUS_TRANSITION");
assertLegalStatusJump("claimed", "in_progress");

throws(
  () => assertManualProofBeforeCsApprove({ payment_method: "duitnow" }, []),
  "PAYMENT_PROOF_REQUIRED"
);
assertManualProofBeforeCsApprove({ payment_method: "duitnow" }, [{ storage_path: "x.png" }]);
assertManualProofBeforeCsApprove({ payment_method: "catfood" }, []);

throws(
  () =>
    assertCsApprovedBeforeCompanionStage(
      { order_type: "multi_group", parent_order_id: null, payment_method: "catfood" },
      [],
      { toStatus: "claimed" }
    ),
  "CS_APPROVAL_REQUIRED"
);
assertCsApprovedBeforeCompanionStage(
  { order_type: "multi_group", parent_order_id: null },
  [{ status: "approved" }],
  { toStatus: "claimed" }
);
assertCsApprovedBeforeCompanionStage(
  { order_type: "direct_companion", payment_method: "catfood" },
  [],
  { toStatus: "claimed" }
);

throws(
  () => assertMultiPayOrderRequiresCsPath({ order_type: "multi_group", parent_order_id: null }),
  "MULTI_REQUIRES_PROOF_AND_CS"
);
assertMultiPayOrderRequiresCsPath({ order_type: "direct_companion" });

console.log("PASS payment/CS gates offline");
