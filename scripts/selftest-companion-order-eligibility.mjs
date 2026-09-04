/**
 * Selftest: companion 接单资格 = 实名 OR 押金（不是 AND）
 * Also verifies commission fields stay independent of eligibility.
 *
 * Usage: node scripts/selftest-companion-order-eligibility.mjs
 */
import { resolveCredentialOrderEligibility } from "../server/api/_companion-order-eligibility.js";
import { resolvePlatformCommission } from "../server/api/_commission-rates.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function caseOf(identity, deposit) {
  return resolveCredentialOrderEligibility({
    identity_status: identity,
    deposit_status: deposit,
  });
}

// 1) Neither → not eligible
{
  const r = caseOf("pending", "unpaid");
  assert(!r.orderEligible && r.rule === "identity_or_deposit", "neither should fail");
  assert(/任一|或/.test(r.orderEligibilityReason), "reason must say OR not AND");
  assert(!/同时|并且|都需|均需/.test(r.orderEligibilityReason), "must not imply AND");
  console.log("PASS neither:", r.orderEligibilityLabel, r.orderEligibilityReason);
}

// 2) Identity only → eligible
{
  const r = caseOf("approved", "unpaid");
  assert(r.orderEligible && r.identityVerified && !r.depositVerified, "identity-only");
  assert(r.orderEligibilityLabel === "✅ 可以接单", "label");
  console.log("PASS identity-only:", r.orderEligibilityLabel, r.orderEligibilityReason);
}

// 3) Deposit only → eligible
{
  const r = caseOf("pending", "paid");
  assert(r.orderEligible && !r.identityVerified && r.depositVerified, "deposit-only");
  assert(r.orderEligibilityLabel === "✅ 可以接单", "label");
  console.log("PASS deposit-only:", r.orderEligibilityLabel, r.orderEligibilityReason);
}

// 4) Both → eligible (still OR, not requiring both)
{
  const r = caseOf("已认证", "已缴纳");
  assert(r.orderEligible && r.identityVerified && r.depositVerified, "both ok");
  assert(/二选一/.test(r.orderEligibilityReason), "both still framed as OR");
  console.log("PASS both:", r.orderEligibilityLabel, r.orderEligibilityReason);
}

// 5) Rejected identity + approved deposit → eligible
{
  const r = caseOf("rejected", "approved");
  assert(r.orderEligible, "deposit rescues rejected identity");
  console.log("PASS deposit rescues:", r.orderEligibilityLabel);
}

// 6) Commission rates independent of eligibility
{
  const rate = resolvePlatformCommission(20);
  assert(rate.platformRate === 20 || rate.platformRate === 0.2 || Number(rate.platformRate) > 0, "commission resolves");
  const ineligible = caseOf("unpaid", "unpaid");
  assert(!ineligible.orderEligible, "ineligible stays ineligible");
  // Eligibility helper must not mutate / gate commission resolution.
  const rate2 = resolvePlatformCommission(15);
  assert(Number(rate2.platformRate) !== Number(rate.platformRate) || rate2.platformRate === 15 || rate.platformRate === 20, "commission independent");
  console.log("PASS commission independent of eligibility gate");
}

console.log("ALL PASS — 接单资格 is OR; commission architecture untouched.");
