/**
 * Multi-companion order group helpers (parent + children on public.orders).
 *
 * Payment owner = parent (multi_group).
 * Settlement / companion income / per-line refund = children.
 * Boss loyalty points = once on parent when all effective children are completed.
 *
 * batch_id is intentionally unused here (Friday settlement / payout batches only).
 */

export const ORDER_TYPE_MULTI_GROUP = "multi_group";

const TERMINAL = new Set(["completed", "cancelled", "refunded"]);
const CANCELLED_LIKE = new Set(["cancelled", "refunded"]);

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function statusOf(order) {
  return String(order?.status || "").trim().toLowerCase();
}

export function isMultiGroupParent(order) {
  if (!order || typeof order !== "object") return false;
  if (order.parent_order_id) return false;
  const t = String(order.order_type || "").trim().toLowerCase();
  if (t === ORDER_TYPE_MULTI_GROUP) return true;
  // Soft detect: parent marker without companion
  return t === ORDER_TYPE_MULTI_GROUP || (order._is_multi_group_parent === true && !order.companion_id);
}

export function isMultiGroupChild(order) {
  if (!order || typeof order !== "object") return false;
  return !!(order.parent_order_id && String(order.parent_order_id).trim());
}

/** Legacy single-companion / open-grab / custom — not part of a multi group. */
export function isLegacyStandaloneOrder(order) {
  return !isMultiGroupParent(order) && !isMultiGroupChild(order);
}

/**
 * Wallet debit may only target payment owner:
 * - legacy standalone
 * - multi_group parent
 * Never children.
 */
export function canDebitBossWalletForOrder(order) {
  if (!order) return false;
  if (isMultiGroupChild(order)) return false;
  return true;
}

/**
 * Companion income / companion withdrawal source:
 * - children + legacy only
 * - never multi_group parent
 */
export function canSettleCompanionIncomeForOrder(order) {
  if (!order?.companion_id) return false;
  if (isMultiGroupParent(order)) return false;
  return true;
}

/**
 * Boss points award eligibility for a single finalize call.
 * - Child: never
 * - Parent: only when status is already/about-to-be completed (caller gates timing)
 * - Legacy: yes (existing path)
 */
export function shouldAwardBossPointsOnFinalize(order) {
  if (!order) return false;
  if (isMultiGroupChild(order)) return false;
  if (isMultiGroupParent(order)) {
    return statusOf(order) === "completed";
  }
  return true;
}

/** Children that still count toward group completion / points (not cancelled/refunded). */
export function effectiveChildren(children = []) {
  return (children || []).filter((c) => !CANCELLED_LIKE.has(statusOf(c)));
}

/** Spend 猫粮 for parent points = sum of completed children's line amounts. */
export function groupCompletedSpendCatFood(children = []) {
  return (children || [])
    .filter((c) => statusOf(c) === "completed")
    .reduce((n, c) => n + money(c.total_amount || c.paid_cat_food || 0), 0);
}

/**
 * Aggregate parent status from children. Reuses existing status enum only.
 *
 * Rules:
 * - Any non-terminal → mirror strongest active child status
 * - All cancelled → cancelled
 * - All refunded → refunded
 * - All terminal + every effective child completed (and ≥1 completed) → completed
 * - All terminal + mix completed + cancelled/refunded → completed iff all effective completed
 * - Else → in_progress (partial progress without full effective completion)
 */
export function aggregateParentStatus(children = []) {
  const list = Array.isArray(children) ? children : [];
  if (!list.length) return "awaiting_payment";

  const statuses = list.map(statusOf);
  const allTerminal = statuses.every((s) => TERMINAL.has(s));

  if (!allTerminal) {
    const active = statuses.filter((s) => !TERMINAL.has(s));
    const rank = {
      in_progress: 50,
      accepted: 40,
      claimed: 30,
      pending: 20,
      awaiting_payment: 10,
      refund_requested: 25,
    };
    let best = "pending";
    let bestScore = -1;
    for (const s of active) {
      const score = rank[s] ?? 15;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => s === "refunded")) return "refunded";

  const effective = effectiveChildren(list);
  if (effective.length === 0) {
    // All cancelled/refunded mix
    if (statuses.some((s) => s === "refunded")) return "refunded";
    return "cancelled";
  }
  if (effective.every((c) => statusOf(c) === "completed")) {
    return "completed";
  }
  return "in_progress";
}

export function summarizeGroupAmounts(parent, children = []) {
  const original = money(parent?.paid_cat_food || parent?.total_amount || 0);
  const lineTotal = (children || []).reduce((n, c) => n + money(c.total_amount), 0);
  const completed = (children || [])
    .filter((c) => statusOf(c) === "completed")
    .reduce((n, c) => n + money(c.total_amount), 0);
  const refundedLines = (children || [])
    .filter((c) => statusOf(c) === "refunded")
    .reduce((n, c) => n + money(c.total_amount || c.paid_cat_food || 0), 0);
  return {
    originalTotal: original || lineTotal,
    lineTotal,
    completedTotal: completed,
    refundedTotal: refundedLines,
    netPaidEstimate: Math.max(0, (original || lineTotal) - refundedLines),
  };
}

/**
 * Refund ownership:
 * - Wallet credit only for child (line) or legacy standalone.
 * - Multi_group parent must not open a wallet refund for the full group amount
 *   (would double-pay with child refunds). Use children for partial refunds.
 */
export function canCreateWalletRefundForOrder(order) {
  if (!order) return false;
  if (isMultiGroupParent(order)) return false;
  return true;
}

/**
 * Max refundable on a child/legacy = that row's paid/total.
 * Group cap helper: remaining = parentPaid - sum(open/paid refunds on all siblings + parent).
 */
export function maxLineRefundAmount(order) {
  return money(order?.paid_cat_food || order?.total_amount || 0);
}

/**
 * Build deps-backed refresh: load children, patch parent status, optionally award points.
 * Pure orchestration — callers inject DB + award fn.
 */
export async function refreshParentOrderStatus(parentOrderId, deps = {}) {
  const {
    loadOrder,
    loadChildren,
    patchOrder,
    awardBossPointsForCompletedOrder = null,
    awardMethod = "system_auto_24h",
    operatorId = null,
  } = deps;
  if (!parentOrderId || typeof loadOrder !== "function" || typeof loadChildren !== "function") {
    return { ok: false, error: "missing_deps" };
  }

  const parent = await loadOrder(parentOrderId);
  if (!parent) return { ok: false, error: "parent_not_found" };
  if (!isMultiGroupParent(parent) && String(parent.order_type || "").toLowerCase() !== ORDER_TYPE_MULTI_GROUP) {
    // Soft: if has children via parent_order_id queries, still allow
    const kidsProbe = await loadChildren(parentOrderId);
    if (!kidsProbe?.length) return { ok: false, error: "not_multi_group_parent" };
  }

  const children = await loadChildren(parentOrderId);
  const nextStatus = aggregateParentStatus(children);
  const amounts = summarizeGroupAmounts(parent, children);

  let saved = parent;
  if (statusOf(parent) !== nextStatus && typeof patchOrder === "function") {
    const patch = { status: nextStatus };
    if (nextStatus === "completed" && !parent.completed_at) {
      patch.completed_at = new Date().toISOString();
    }
    saved = (await patchOrder(parentOrderId, patch)) || { ...parent, ...patch };
  }

  let bossPoints = null;
  const shouldAward =
    nextStatus === "completed" &&
    typeof awardBossPointsForCompletedOrder === "function" &&
    shouldAwardBossPointsOnFinalize({ ...saved, status: "completed", order_type: ORDER_TYPE_MULTI_GROUP });

  if (shouldAward) {
    // Points base = completed children spend (not cancelled/refunded lines).
    const spendOrder = {
      ...saved,
      status: "completed",
      order_type: ORDER_TYPE_MULTI_GROUP,
      parent_order_id: null,
      companion_id: null,
      total_amount: amounts.completedTotal,
      paid_cat_food: amounts.completedTotal,
    };
    try {
      bossPoints = await awardBossPointsForCompletedOrder(spendOrder, {
        method: awardMethod,
        operatorId,
      });
    } catch (e) {
      bossPoints = { ok: false, error: String(e?.message || e) };
    }
  }

  return {
    ok: true,
    parent: saved,
    children,
    status: nextStatus,
    amounts,
    bossPoints,
  };
}

/**
 * In-memory simulator for offline tests (no DB).
 */
export function simulatePlaceMultiOrderPlan({ companions, idempotencyKey }) {
  const lines = (companions || []).map((c, i) => ({
    index: i,
    companionId: c.companionId || c.companion_id,
    amount: money(c.amount ?? c.totalAmount ?? c.total_amount),
  }));
  const total = lines.reduce((n, l) => n + l.amount, 0);
  return {
    order_type: ORDER_TYPE_MULTI_GROUP,
    parent: {
      companion_id: null,
      parent_order_id: null,
      order_type: ORDER_TYPE_MULTI_GROUP,
      total_amount: total,
      paid_cat_food: total,
      idempotency_key: idempotencyKey || null,
    },
    children: lines.map((l) => ({
      companion_id: l.companionId,
      parent_order_id: "__PARENT__",
      order_type: "direct_companion",
      total_amount: l.amount,
      paid_cat_food: l.amount,
    })),
    walletDebitOnce: total,
    walletDebitCount: 1,
  };
}
