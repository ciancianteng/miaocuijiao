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
/** Companion has accepted / service active — counts toward ALL_CONFIRMED. */
const CONFIRMED_LIKE = new Set(["accepted", "confirmed", "in_progress", "completed", "reviewed"]);
/** Still waiting for companion accept after payment. */
const WAITING_CONFIRM_LIKE = new Set([
  "pending",
  "claimed",
  "awaiting_payment",
  "waiting_boss_confirm",
]);

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function statusOf(order) {
  return String(order?.status || "").trim().toLowerCase();
}

/**
 * Explicit multi-group UI / machine label (does not invent DB enum values).
 * Maps onto existing orders.status vocabulary for persistence via aggregateParentStatus.
 */
export function deriveMultiGroupState(parent, children = []) {
  const list = Array.isArray(children) ? children : [];
  const parentSt = statusOf(parent);
  const effective = effectiveChildren(list);
  const confirmed = effective.filter((c) => CONFIRMED_LIKE.has(statusOf(c)));
  const waiting = effective.filter((c) => WAITING_CONFIRM_LIKE.has(statusOf(c)));
  const rejected = list.filter((c) => CANCELLED_LIKE.has(statusOf(c)));
  const total = effective.length;
  const confirmedCount = confirmed.length;

  if (!list.length) {
    return {
      key: parentSt === "awaiting_payment" ? "PAYMENT_PENDING" : "WAITING_CONFIRMATION",
      parentStatus: parentSt || "awaiting_payment",
      confirmedCount: 0,
      totalCount: 0,
      label: "等待子订单",
    };
  }
  if (list.some((c) => statusOf(c) === "awaiting_payment") || parentSt === "awaiting_payment") {
    const reviewing = /payment_review|pending_review|待人工|凭证/.test(
      String(parent?.note || "") + String(parent?.description || "")
    );
    return {
      key: reviewing ? "PAYMENT_REVIEW" : "PAYMENT_PENDING",
      parentStatus: "awaiting_payment",
      confirmedCount: 0,
      totalCount: total || list.length,
      label: reviewing ? "待人工审核" : "待付款",
    };
  }
  if (rejected.length && waiting.length + confirmed.length > 0) {
    const needsRep = rejected.some((c) =>
      /COMPANION_UNAVAILABLE|无法接单|已退出/.test(String(c?.note || "") + String(c?.description || "") + String(c?.cancel_reason || ""))
    );
    return {
      key: needsRep ? "REPLACEMENT_REQUIRED" : "PARTIALLY_CANCELED",
      parentStatus: aggregateParentStatus(list),
      confirmedCount,
      totalCount: total,
      label: needsRep
        ? `等待补位（${confirmedCount}/${total} 已确认）`
        : `部分取消（${confirmedCount}/${total} 进行中）`,
    };
  }
  if (total > 0 && confirmedCount < total) {
    return {
      key: confirmedCount > 0 ? "PARTIALLY_CONFIRMED" : "WAITING_CONFIRMATION",
      parentStatus: "claimed",
      confirmedCount,
      totalCount: total,
      label:
        confirmedCount > 0
          ? `等待陪玩确认（${confirmedCount}/${total}）`
          : `等待陪玩确认（0/${total}）`,
    };
  }
  if (total > 0 && confirmedCount === total) {
    if (effective.every((c) => statusOf(c) === "completed" || statusOf(c) === "reviewed")) {
      return {
        key: "COMPLETED",
        parentStatus: "completed",
        confirmedCount,
        totalCount: total,
        label: "已完成",
      };
    }
    return {
      key: "IN_PROGRESS",
      parentStatus: "in_progress",
      confirmedCount,
      totalCount: total,
      label: `进行中（${confirmedCount}/${total} 已确认）`,
    };
  }
  if (list.every((c) => statusOf(c) === "cancelled")) {
    return { key: "CANCELED", parentStatus: "cancelled", confirmedCount: 0, totalCount: 0, label: "已取消" };
  }
  if (list.every((c) => statusOf(c) === "refunded")) {
    return { key: "REFUNDED", parentStatus: "refunded", confirmedCount: 0, totalCount: 0, label: "已退款" };
  }
  return {
    key: "PARTIALLY_CONFIRMED",
    parentStatus: aggregateParentStatus(list),
    confirmedCount,
    totalCount: total,
    label: `等待陪玩确认（${confirmedCount}/${total || list.length}）`,
  };
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

/** True payment / wallet / revenue owner — never a multi child allocation row. */
export function isBossPaymentOwnerOrder(order) {
  if (!order || typeof order !== "object") return false;
  return !isMultiGroupChild(order);
}

/**
 * Boss / Admin / CS order lists: only top-level rows; nest children under parent.
 * Children remain available as `children` / `allocations` for detail UI.
 */
export function nestParentOnlyOrders(orders = []) {
  const list = Array.isArray(orders) ? orders : [];
  const childrenByParent = new Map();
  const roots = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const pid = String(o.parent_order_id || o.parentOrderId || "").trim();
    if (pid) {
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(o);
      continue;
    }
    roots.push(o);
  }
  return roots.map((root) => {
    const id = String(root.id || root.orderId || "");
    const kids = childrenByParent.get(id) || [];
    const childCount = kids.length;
    const companionNames = kids
      .map((c) => c.companionName || c.playerName || c.companion_name || "")
      .filter(Boolean);
    // Review targets = effective completed children with a companion (not cancelled/refunded).
    const reviewTargets = kids.filter((c) => {
      const st = String(c.status || "").toLowerCase();
      if (CANCELLED_LIKE.has(st) || st === "refund_requested") return false;
      const cid = c.companionId || c.companion_id || (c.companion && (c.companion.id || c.companion.user_id));
      if (!cid) return false;
      return st === "completed" || st === "reviewed" || !!c.reviewed || !!c.canReview;
    });
    const reviewDone = reviewTargets.filter((c) => !!c.reviewed || String(c.status || "").toLowerCase() === "reviewed").length;
    const reviewPending = reviewTargets.filter((c) => !!c.canReview || (String(c.status || "").toLowerCase() === "completed" && !c.reviewed)).length;
    const isMultiRoot =
      String(root.orderTypeKey || root.order_type || "").toLowerCase() === ORDER_TYPE_MULTI_GROUP ||
      !!root.isMultiGroupParent ||
      childCount > 0;
    const multiReview = isMultiRoot
      ? { done: reviewDone, total: reviewTargets.length, pending: Math.max(0, reviewTargets.length - reviewDone) }
      : null;
    return {
      ...root,
      children: kids,
      allocations: kids.map((c) => ({
        id: c.id,
        orderNo: c.orderNo || c.order_no || c.orderNoDisplay || "",
        companionId: c.companionId || c.companion_id || "",
        companionName: c.companionName || c.playerName || "",
        companionCode: c.companionCode || c.playerUid || "",
        allocatedAmount:
          Number(
            c.allocatedAmount != null
              ? c.allocatedAmount
              : c.totalAmount != null
                ? c.totalAmount
                : c.total_amount != null
                  ? c.total_amount
                  : c.amount
          ) || 0,
        status: c.status || "",
        statusText: c.statusText || "",
        reviewed: !!(c.reviewed || String(c.status || "").toLowerCase() === "reviewed"),
        canReview: !!c.canReview,
      })),
      childCount,
      companionCount: childCount || (root.companionId || root.companion_id ? 1 : 0),
      companionsLabel:
        companionNames.length > 0
          ? companionNames.join("、")
          : root.companionName || root.playerName || (childCount ? `${childCount}位陪玩` : "待分配"),
      multiReview,
      // Parent has no companion_id — expose aggregate review CTA from children.
      canReview: isMultiRoot
        ? reviewPending > 0 || reviewTargets.some((c) => !!c.canReview)
        : !!root.canReview,
      reviewed: isMultiRoot
        ? reviewTargets.length > 0 && reviewDone >= reviewTargets.length
        : !!root.reviewed,
    };
  });
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
 * P0 rules (multi-companion):
 * - No payment success → awaiting_payment
 * - After pay, until ALL active children confirmed → claimed (WAITING / PARTIAL confirm)
 * - ONLY when every effective child is confirmed → in_progress
 * - Never promote parent to in_progress on 1/N confirm
 * - All cancelled → cancelled; all refunded → refunded
 * - All effective completed → completed
 */
export function aggregateParentStatus(children = []) {
  const list = Array.isArray(children) ? children : [];
  if (!list.length) return "awaiting_payment";

  const statuses = list.map(statusOf);
  if (statuses.some((s) => s === "awaiting_payment")) return "awaiting_payment";

  const allTerminal = statuses.every((s) => TERMINAL.has(s));
  if (allTerminal) {
    if (statuses.every((s) => s === "cancelled")) return "cancelled";
    if (statuses.every((s) => s === "refunded")) return "refunded";

    const effective = effectiveChildren(list);
    if (effective.length === 0) {
      if (statuses.some((s) => s === "refunded")) return "refunded";
      return "cancelled";
    }
    if (effective.every((c) => statusOf(c) === "completed" || statusOf(c) === "reviewed")) {
      return "completed";
    }
    return "in_progress";
  }

  const effective = effectiveChildren(list);
  if (!effective.length) {
    // Only cancelled/refunded siblings left mid-flight — keep cancelled/refunded aggregate
    if (statuses.every((s) => CANCELLED_LIKE.has(s))) {
      if (statuses.some((s) => s === "refunded")) return "refunded";
      return "cancelled";
    }
    return "claimed";
  }

  const allConfirmed = effective.every((c) => CONFIRMED_LIKE.has(statusOf(c)));
  if (!allConfirmed) {
    // 1/N confirmed must NOT flip parent to in_progress
    return "claimed";
  }

  if (effective.every((c) => statusOf(c) === "completed" || statusOf(c) === "reviewed")) {
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

  // Cat-food hold → final debit when the whole multi group completes.
  let holdFinalize = null;
  if (nextStatus === "completed") {
    try {
      const walletApi = await import("./_wallet.js");
      holdFinalize = await walletApi.finalizeWalletHold({
        orderId: parentOrderId,
        idempotencyKey: `order-finalize:${parent.order_no || parentOrderId}`,
        reason: `多人订单完成扣款 ${parent.order_no || parentOrderId}`,
        operatorId,
      });
    } catch (e) {
      holdFinalize = { ok: false, error: String(e?.message || e).slice(0, 160) };
    }
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
    holdFinalize,
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
