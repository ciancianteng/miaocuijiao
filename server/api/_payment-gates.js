/**
 * Server-side payment proof + CS approval gates.
 * Prevents illegal skips into companion confirmation / in_progress.
 */
import { normalizeOrderStatus } from "./_order-status.js";

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function isWalletPaymentMethod(method) {
  return /cat.?food|wallet|猫粮|余额/.test(String(method || "").toLowerCase());
}

export function isManualPaymentMethod(method) {
  const raw = String(method || "").trim().toLowerCase();
  if (!raw) return false;
  if (isWalletPaymentMethod(raw)) return false;
  if (/^(test|preview[_-]?test|test[_-]?pay)$/.test(raw) || /测试支付|test\s*pay/.test(raw)) {
    return false;
  }
  return true;
}

export function isMultiGroupParentOrder(order = {}) {
  if (order.parent_order_id) return false;
  return String(order.order_type || "").toLowerCase() === "multi_group";
}

/** Statuses that mean companion-facing / in service (require prior CS payment approval for gated rails). */
export const COMPANION_STAGE_STATUSES = Object.freeze([
  "claimed",
  "confirmed",
  "in_progress",
  "completed",
  "waiting_boss_confirm",
  "pending",
]);

/**
 * Illegal raw jumps that must never succeed via generic status PATCH.
 * Dedicated actions (confirm_payment, accept_direct, …) still use their own paths
 * but must call the proof/CS asserts first.
 */
export const FORBIDDEN_STATUS_JUMPS = Object.freeze([
  ["awaiting_payment", "confirmed"],
  ["awaiting_payment", "in_progress"],
  ["awaiting_payment", "completed"],
  ["awaiting_payment", "companion_confirmed"],
]);

export function assertLegalStatusJump(fromStatus, toStatus) {
  const from = normalizeOrderStatus(fromStatus);
  const to = normalizeOrderStatus(toStatus);
  for (const [a, b] of FORBIDDEN_STATUS_JUMPS) {
    if (from === normalizeOrderStatus(a) && to === normalizeOrderStatus(b)) {
      throw httpError(
        `不允许从「${from}」直接跳到「${to}」。须先完成付款凭证与客服审核。`,
        409,
        { code: "ILLEGAL_STATUS_TRANSITION", from, to }
      );
    }
  }
  return { from, to };
}

/**
 * Manual rails (DuitNow/TNG/bank/…): CS cannot approve without a proof record.
 * Wallet/catfood: proof optional (multi still goes through CS confirm_payment separately).
 */
export function assertManualProofBeforeCsApprove(order, receiptOrList) {
  const method =
    order?.payment_method ||
    order?.paymentMethod ||
    order?.payment_method_code ||
    "";
  if (!isManualPaymentMethod(method)) return { ok: true, required: false };

  const list = Array.isArray(receiptOrList)
    ? receiptOrList
    : receiptOrList
      ? [receiptOrList]
      : [];
  const hasProof = list.some(
    (r) =>
      r &&
      (r.storage_path ||
        r.payment_proof_path ||
        r.proof_url ||
        r.file_path ||
        r.image_url ||
        r.receipt_url)
  );
  if (!hasProof) {
    throw httpError(
      "该支付方式需要付款凭证，尚未上传截图，不能客服审核通过。",
      409,
      { code: "PAYMENT_PROOF_REQUIRED" }
    );
  }
  return { ok: true, required: true };
}

/**
 * True when an approved payment_receipt exists (or explicit CS-approved flags on order).
 */
export function hasCsPaymentApproval(order = {}, receipts = []) {
  if (order.cs_approved_at || order.csApprovedAt) return true;
  if (order.payment_reviewed_at || order.paymentReviewedAt) return true;
  const list = Array.isArray(receipts) ? receipts : [];
  return list.some((r) => {
    const st = String(r?.status || r?.review_status || "").toLowerCase();
    return st === "approved" || st === "confirmed" || st === "paid";
  });
}

/**
 * Multi-group parents (and manual rails) must not enter companion stage without CS approval.
 * Single-order catfood may still use pay_order → claimed (existing path).
 */
export function assertCsApprovedBeforeCompanionStage(order, receipts = [], opts = {}) {
  const to = normalizeOrderStatus(opts.toStatus || "claimed");
  if (!COMPANION_STAGE_STATUSES.includes(to)) return { ok: true, gated: false };

  const multi = isMultiGroupParentOrder(order) || !!order.parent_order_id;
  const method = order?.payment_method || order?.paymentMethod || "";
  const manual = isManualPaymentMethod(method);

  // Gate: multi (any method) OR manual rails.
  if (!multi && !manual) return { ok: true, gated: false };

  if (hasCsPaymentApproval(order, receipts)) return { ok: true, gated: true };

  throw httpError(
    "尚未客服审核通过，不能进入等待陪玩确认 / 进行中。请先完成付款凭证与客服审核。",
    409,
    { code: "CS_APPROVAL_REQUIRED", to }
  );
}

/**
 * Multi parent must not auto-pay via pay_order into claimed.
 * Force submit_payment_proof → CS confirm_payment path (including catfood hold+proof).
 */
export function assertMultiPayOrderRequiresCsPath(order) {
  if (!isMultiGroupParentOrder(order)) return { ok: true };
  throw httpError(
    "多人订单须上传付款凭证并由客服审核通过后才会进入等待陪玩确认，不能直接猫粮支付跳过审核。",
    409,
    { code: "MULTI_REQUIRES_PROOF_AND_CS" }
  );
}
