/**
 * Companion order-eligibility credential gate (admin list / verification).
 *
 * Business rule (locked):
 *   identity approved OR deposit approved  → 可以接单
 *   Both are NOT required. Do not display or compute as AND.
 *
 * Full work access in companion.js also requires profile approved / account active /
 * allow_orders / forced-ack — this helper only covers the credential OR gate used
 * for the admin「接单资格」column. Commission rates are independent of this gate.
 */

function normalizeCredentialStatus(value, fallback = "pending") {
  const text = String(value == null ? "" : value).trim();
  if (!text) return fallback;
  if (/未缴纳|unpaid/i.test(text)) return "unpaid";
  if (/待审核|pending|审核中/i.test(text)) return "pending";
  if (/已通过|approved|已认证|verified|已缴纳|^paid$|已到账/i.test(text)) return "approved";
  if (/已驳回|已拒绝|rejected/i.test(text)) return "rejected";
  if (/重新提交|resubmit|待补充/i.test(text)) return "resubmit";
  if (/已退回|refunded/i.test(text)) return "refunded";
  if (/未认证|unverified|draft|none|not_submitted|missing/i.test(text)) return "unpaid";
  return String(text).toLowerCase();
}

function isCredentialApproved(value) {
  return normalizeCredentialStatus(value, "") === "approved";
}

/**
 * @param {{ identityStatus?: string, depositStatus?: string, identity_status?: string, deposit_status?: string }} input
 */
export function resolveCredentialOrderEligibility(input = {}) {
  const identityRaw = input.identityStatus ?? input.identity_status ?? "pending";
  const depositRaw = input.depositStatus ?? input.deposit_status ?? "unpaid";
  const identityVerified = isCredentialApproved(identityRaw);
  const depositVerified = isCredentialApproved(depositRaw);
  // OR — never AND
  const orderEligible = identityVerified || depositVerified;

  let orderEligibilityReason = "需实名认证通过或押金已缴纳（满足任一即可）";
  if (orderEligible) {
    if (identityVerified && depositVerified) {
      orderEligibilityReason = "实名与押金均已通过（满足二选一）";
    } else if (identityVerified) {
      orderEligibilityReason = "实名认证已通过";
    } else {
      orderEligibilityReason = "押金已缴纳";
    }
  }

  const orderEligibility = orderEligible ? "可以接单" : "不可接单";
  const orderEligibilityLabel = orderEligible ? "✅ 可以接单" : "❌ 不可接单";

  return {
    identityVerified,
    depositVerified,
    credentialOrOk: orderEligible,
    orderEligible,
    order_eligible: orderEligible,
    orderEligibility,
    order_eligibility: orderEligibility,
    orderEligibilityLabel,
    order_eligibility_label: orderEligibilityLabel,
    orderEligibilityReason,
    order_eligibility_reason: orderEligibilityReason,
    rule: "identity_or_deposit",
  };
}

export function isCredentialApprovedStatus(value) {
  return isCredentialApproved(value);
}
