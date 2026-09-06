/**
 * Unit tests: companion credential OR gate for accept-order + homepage visibility.
 *
 * Case 1: identity=true, deposit=false  => visible + can accept
 * Case 2: identity=false, deposit=true  => visible + can accept
 * Case 3: identity=false, deposit=false => hidden + cannot accept
 *
 * Usage: node scripts/verify-companion-credential-or-gate.mjs
 */
import assert from "node:assert/strict";
import {
  isIdentityVerified,
  isDepositVerified,
  isCredentialOrOk,
  evaluateCredentialMatrix,
} from "../server/api/_companion-credential-gate.js";
import { evaluatePublishGate } from "../server/api/_companion-publish-gate.js";

const profile = { role: "companion", status: "active", display_name: "验收陪玩" };
const baseRow = {
  id: "cp-test-1",
  user_id: "user-test-1",
  application_status: "approved",
  allow_orders: true,
  featured: true,
  nickname: "验收陪玩",
  game: "王者荣耀",
  price: 68,
  is_test_account: false,
};

function runCase(name, rowPatch, expectVisible, expectAccept) {
  const row = { ...baseRow, ...rowPatch };
  const matrix = evaluateCredentialMatrix(row);
  const gate = evaluatePublishGate(row, profile, {});
  assert.equal(matrix.canAccept, expectAccept, `${name}: canAccept`);
  assert.equal(matrix.homepageVisible, expectVisible, `${name}: homepageVisible (credential)`);
  assert.equal(gate.credentialOrOk, expectAccept, `${name}: gate.credentialOrOk`);
  assert.equal(gate.canWork, expectAccept, `${name}: gate.canWork`);
  assert.equal(gate.hallVisible, expectVisible, `${name}: gate.hallVisible`);
  assert.equal(isCredentialOrOk(row), expectAccept, `${name}: isCredentialOrOk`);
  console.log(`PASS ${name}`);
}

// Case 1: identity only
runCase(
  "case1_identity_only",
  { identity_status: "approved", deposit_status: "unpaid" },
  true,
  true
);
assert.equal(isIdentityVerified({ identity_status: "approved" }), true);
assert.equal(isDepositVerified({ deposit_status: "unpaid" }), false);

// Case 2: deposit only
runCase(
  "case2_deposit_only",
  { identity_status: "draft", deposit_status: "approved", verification_status: "pending" },
  true,
  true
);
assert.equal(isIdentityVerified({ identity_status: "draft", verification_status: "pending" }), false);
assert.equal(isDepositVerified({ deposit_status: "approved" }), true);

// Case 3: neither (explicitly clear verification_status — production identity column)
runCase(
  "case3_neither",
  { identity_status: "draft", deposit_status: "unpaid", verification_status: "pending" },
  false,
  false
);
assert.equal(isIdentityVerified({ identity_status: "draft", verification_status: "pending" }), false);
assert.equal(isDepositVerified({ deposit_status: "unpaid" }), false);
assert.equal(
  isCredentialOrOk({ identity_status: "draft", deposit_status: "unpaid", verification_status: "pending" }),
  false
);

// Explicitly prove AND is NOT required: both true still works
runCase(
  "both_approved_still_ok",
  { identity_status: "approved", deposit_status: "approved" },
  true,
  true
);

// Auth-row override: profile columns unpaid, but deposit ledger approved
{
  const row = {
    ...baseRow,
    identity_status: "draft",
    deposit_status: "unpaid",
    verification_status: "pending",
  };
  const matrix = evaluateCredentialMatrix(row, null, { status: "approved" });
  const gate = evaluatePublishGate(row, profile, { depositRow: { status: "approved" } });
  assert.equal(matrix.canAccept, true);
  assert.equal(gate.hallVisible, true);
  console.log("PASS auth_row_deposit_overrides_profile_column");
}

// Featured + recommend homepage style row with only identity still lists
{
  const row = {
    ...baseRow,
    featured: true,
    identity_status: "approved",
    deposit_status: "unpaid",
  };
  const gate = evaluatePublishGate(row, profile, {});
  assert.equal(gate.hallVisible, true);
  assert.equal(gate.credentialOrOk, true);
  console.log("PASS featured_identity_only_lists_on_homepage");
}

// Production path: verification_status=approved counts as identity even when identity row is pending
{
  const row = {
    ...baseRow,
    deposit_status: "unpaid",
    verification_status: "approved",
  };
  const identityRow = { status: "pending" };
  assert.equal(isIdentityVerified(row, identityRow), true);
  assert.equal(isCredentialOrOk(row, identityRow, null), true);
  const gate = evaluatePublishGate(row, profile, { identityRow });
  assert.equal(gate.credentialOrOk, true);
  assert.equal(gate.hallVisible, true);
  assert.equal(gate.canWork, true);
  console.log("PASS verification_status_approved_overrides_pending_identity_row");
}

// Dual-role boss profile with approved companion row still hall-visible
{
  const row = {
    ...baseRow,
    verification_status: "approved",
    deposit_status: "unpaid",
  };
  const bossProfile = { id: row.user_id, role: "boss", status: "active", is_test_account: false };
  const gate = evaluatePublishGate(row, bossProfile, { identityRow: { status: "pending" } });
  assert.equal(gate.credentialOrOk, true);
  assert.equal(gate.hallVisible, true);
  assert.equal(gate.canWork, true);
  console.log("PASS boss_dual_role_companion_hall_visible");
}

console.log("verify-companion-credential-or-gate: ok");
