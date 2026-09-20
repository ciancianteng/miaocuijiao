/**
 * Multi-group partial cancel / soft-exit / replacement / keep-remaining.
 * Pure helpers + orchestration. Does not touch Production by itself.
 */
import {
  ORDER_TYPE_MULTI_GROUP,
  aggregateParentStatus,
  effectiveChildren,
  isMultiGroupChild,
  isMultiGroupParent,
  refreshParentOrderStatus,
} from "./_order-group.js";

export const UNAVAILABLE_MARKER = "[[COMPANION_UNAVAILABLE]]";
export const KEEP_REMAINING_MARKER = "[[KEEP_REMAINING_APPLIED]]";
export const REPLACEMENT_MARKER = "[[REPLACEMENT_CHILD]]";

const EXITED_STATUSES = new Set(["cancelled", "refunded"]);
const ACCEPTED_STATUSES = new Set(["confirmed", "in_progress", "completed", "reviewed"]);
const PENDING_STATUSES = new Set(["claimed", "pending", "waiting_boss_confirm"]);

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function statusOf(order) {
  return String(order?.status || "").trim().toLowerCase();
}

function noteBlob(order) {
  return `${order?.note || ""}\n${order?.description || ""}\n${order?.cancel_reason || ""}`;
}

/** Child soft-exited by companion reject / cancel / unavailable (still keep row for audit). */
export function isCompanionUnavailableExit(order) {
  if (!order) return false;
  const s = statusOf(order);
  if (!EXITED_STATUSES.has(s) && s !== "pending") {
    // claimed with marker shouldn't happen; treat cancelled/refunded primarily
  }
  if (EXITED_STATUSES.has(s) || /无法接单|已退出|unavailable/i.test(String(order?.cancel_reason || ""))) {
    if (noteBlob(order).includes(UNAVAILABLE_MARKER)) return true;
    if (/无法接单|已退出/.test(String(order?.cancel_reason || ""))) return true;
  }
  return noteBlob(order).includes(UNAVAILABLE_MARKER) && EXITED_STATUSES.has(s);
}

export function isKeepRemainingApplied(order) {
  return noteBlob(order).includes(KEEP_REMAINING_MARKER);
}

export function isReplacementChild(order) {
  return noteBlob(order).includes(REPLACEMENT_MARKER);
}

/**
 * Boss-facing confirmation chip for one child:
 * - pending → clock
 * - accepted → check
 * - exited → replacement slot (active queue) + history row
 * - other → status text
 */
export function companionConfirmUiState(child) {
  const s = statusOf(child);
  if (isCompanionUnavailableExit(child) || (EXITED_STATUSES.has(s) && isMultiGroupChild(child))) {
    const keepDone = isKeepRemainingApplied(child);
    return {
      key: keepDone ? "exited_kept" : "exited",
      label: keepDone ? "已退出（仅保留其余）" : "无法接单 / 已退出",
      icon: keepDone ? "exit" : "replace",
      showInActiveQueue: !keepDone,
      showAsReplacementSlot: !keepDone,
      showInHistory: true,
    };
  }
  if (ACCEPTED_STATUSES.has(s)) {
    return {
      key: "accepted",
      label: "已确认",
      icon: "check",
      showInActiveQueue: true,
      showAsReplacementSlot: false,
      showInHistory: true,
    };
  }
  if (PENDING_STATUSES.has(s) || s === "awaiting_payment") {
    return {
      key: "pending",
      label: "等待确认",
      icon: "clock",
      showInActiveQueue: true,
      showAsReplacementSlot: false,
      showInHistory: true,
    };
  }
  return {
    key: "other",
    label: s || "未知",
    icon: "other",
    showInActiveQueue: !EXITED_STATUSES.has(s),
    showAsReplacementSlot: false,
    showInHistory: true,
  };
}

/**
 * Build active confirmation queue for boss UI.
 * Exited children become replacement slots; accepted/pending keep prior icons.
 * Never resets siblings when one exits.
 */
export function buildConfirmationQueue(children = []) {
  const list = Array.isArray(children) ? children.slice() : [];
  list.sort((a, b) => String(a.created_at || a.createdAt || "").localeCompare(String(b.created_at || b.createdAt || "")));
  const queue = [];
  const history = [];
  for (const ch of list) {
    const ui = companionConfirmUiState(ch);
    history.push({ child: ch, ui });
    if (ui.showInActiveQueue) {
      queue.push({
        childId: ch.id,
        companionId: ch.companion_id || ch.companionId || null,
        companionName:
          (ch.companion && (ch.companion.display_name || ch.companion.nickname)) ||
          ch.companionName ||
          ch.companion_name ||
          "陪玩",
        avatarUrl: (ch.companion && (ch.companion.avatar_url || ch.companion.avatarUrl)) || "",
        statusKey: ui.key,
        icon: ui.icon,
        label: ui.label,
        needsReplacement: !!ui.showAsReplacementSlot,
        status: statusOf(ch),
      });
    }
  }
  const needsBossDecision = queue.some((q) => q.needsReplacement);
  const hasAccepted = queue.some((q) => q.statusKey === "accepted");
  const hasPending = queue.some((q) => q.statusKey === "pending");
  const canKeepRemaining =
    needsBossDecision &&
    queue.filter((q) => q.statusKey === "accepted" || q.statusKey === "pending").length >= 1;
  return {
    queue,
    history,
    needsBossDecision,
    hasAccepted,
    hasPending,
    canKeepRemaining,
    effectiveCount: effectiveChildren(list).length,
  };
}

export function buildUnavailableNote({ reason, companionId, companionName, at } = {}) {
  const ts = at || new Date().toISOString();
  return `${UNAVAILABLE_MARKER}|reason:${reason || "无法接单"}|companion:${companionId || ""}|name:${companionName || ""}|at:${ts}`;
}

/**
 * Soft-exit a multi child: cancelled, keep companion_id + parent_order_id for audit.
 * Does NOT open public hall. Does NOT touch siblings.
 */
export function softExitPatch({ reason, companionId, companionName, existingNote } = {}) {
  const marker = buildUnavailableNote({ reason, companionId, companionName });
  const prev = String(existingNote || "").trim();
  const note = prev.includes(UNAVAILABLE_MARKER) ? prev : `${prev}\n${marker}`.trim();
  return {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_reason: `无法接单 / 已退出${reason ? `（${reason}）` : ""}`.slice(0, 200),
    note,
    // Keep companion_id for history — do not clear, do not set open_grab.
  };
}

/**
 * In-memory simulation for offline verify harness.
 */
export function simulateSoftExitQueue({ children, exitChildId, reason = "时间无法配合" }) {
  const next = (children || []).map((c) => {
    if (String(c.id) !== String(exitChildId)) return { ...c };
    return {
      ...c,
      ...softExitPatch({
        reason,
        companionId: c.companion_id || c.companionId,
        companionName: c.companionName,
        existingNote: c.note,
      }),
      companion_id: c.companion_id || c.companionId, // preserve
      parent_order_id: c.parent_order_id,
    };
  });
  return {
    children: next,
    queue: buildConfirmationQueue(next),
    parentStatus: aggregateParentStatus(next),
  };
}

export function simulateAcceptChild({ children, acceptChildId }) {
  const next = (children || []).map((c) => {
    if (String(c.id) !== String(acceptChildId)) return { ...c };
    return {
      ...c,
      status: "in_progress",
      accepted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    };
  });
  return {
    children: next,
    queue: buildConfirmationQueue(next),
    parentStatus: aggregateParentStatus(next),
  };
}

export function simulateReplaceCompanion({ children, replaceChildId, newCompanionId, newChildId }) {
  const parentId = (children || []).find((c) => c.parent_order_id)?.parent_order_id || null;
  const exited = (children || []).find((c) => String(c.id) === String(replaceChildId));
  if (!exited || !isCompanionUnavailableExit(exited)) {
    return { ok: false, error: "slot_not_exited" };
  }
  const activeCompanions = new Set(
    effectiveChildren(children)
      .map((c) => String(c.companion_id || c.companionId || ""))
      .filter(Boolean)
  );
  if (activeCompanions.has(String(newCompanionId))) {
    return { ok: false, error: "duplicate_companion" };
  }
  const replacement = {
    id: newChildId || `rep-${Date.now()}`,
    parent_order_id: parentId || exited.parent_order_id,
    companion_id: newCompanionId,
    companionId: newCompanionId,
    companionName: `陪玩${newCompanionId}`,
    status: "claimed",
    order_type: "direct_companion",
    total_amount: money(exited.total_amount),
    hours: exited.hours || 1,
    unit_price: exited.unit_price || exited.total_amount,
    note: `${REPLACEMENT_MARKER}|replaces:${replaceChildId}`,
    created_at: new Date().toISOString(),
  };
  // Exited child stays in history; replacement joins as new child under same parent.
  const next = [...(children || []).map((c) => ({ ...c })), replacement];
  const q = buildConfirmationQueue(next);
  // Critical: previously accepted siblings must remain accepted.
  const acceptedBefore = (children || []).filter((c) => companionConfirmUiState(c).key === "accepted");
  for (const a of acceptedBefore) {
    const after = q.queue.find((x) => String(x.childId) === String(a.id));
    if (after && after.statusKey !== "accepted") {
      return { ok: false, error: "sibling_reset", children: next, queue: q };
    }
  }
  return {
    ok: true,
    children: next,
    queue: q,
    parentOrderId: replacement.parent_order_id,
    replacement,
    parentStatus: aggregateParentStatus(next),
  };
}

export function simulateKeepRemaining({ children, exitedChildId }) {
  const next = (children || []).map((c) => {
    if (String(c.id) !== String(exitedChildId)) return { ...c };
    const prev = String(c.note || "");
    return {
      ...c,
      note: prev.includes(KEEP_REMAINING_MARKER) ? prev : `${prev}\n${KEEP_REMAINING_MARKER}`.trim(),
      status: "cancelled",
    };
  });
  const q = buildConfirmationQueue(next);
  return {
    ok: true,
    children: next,
    queue: q,
    parentStatus: aggregateParentStatus(next),
    refundChildId: exitedChildId,
    refundAmount: money((children || []).find((c) => String(c.id) === String(exitedChildId))?.total_amount),
  };
}

/**
 * Orchestrate DB soft-exit for multi child reject.
 */
export async function softExitMultiChildOrder(child, { reason, companionId, companionName, deps } = {}) {
  const {
    restUrl,
    supabaseJson,
    serviceHeaders,
    writeOrderStatusLog,
    refreshParent,
    notifyBoss,
    addSystemMessage,
  } = deps || {};
  if (!child?.id || !isMultiGroupChild(child)) {
    return { ok: false, error: "not_multi_child" };
  }
  const patch = softExitPatch({
    reason,
    companionId: companionId || child.companion_id,
    companionName,
    existingNote: child.note,
  });
  // Progressive patches for schemas missing cancel_reason
  const attempts = [
    patch,
    { status: "cancelled", cancelled_at: patch.cancelled_at, note: patch.note },
    { status: "cancelled", note: patch.note },
  ];
  let saved = null;
  let lastErr = null;
  for (const body of attempts) {
    try {
      const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(child.id)}&status=eq.claimed`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(body),
      });
      if (rows?.[0]) {
        saved = rows[0];
        break;
      }
    } catch (err) {
      lastErr = err;
      if (!/PGRST204|schema cache|column|Could not find/i.test(String(err?.message || err || ""))) throw err;
    }
  }
  if (!saved && lastErr) throw lastErr;
  saved = saved || { ...child, ...patch };

  // Discord: remove exited companion channel permission; keep room for others.
  try {
    const discordVoice = await import("./_discord-voice-orders.js");
    await discordVoice.revokeCompanionVoiceAccess(saved, companionId || child.companion_id);
  } catch (err) {
    console.warn("[softExit] discord revoke", String(err?.message || err).slice(0, 120));
  }

  if (typeof writeOrderStatusLog === "function") {
    await writeOrderStatusLog({
      orderId: child.id,
      fromStatus: child.status,
      toStatus: "cancelled",
      operatorRole: "companion",
      operatorId: companionId || child.companion_id,
      note: `multi_soft_exit: ${reason || ""}`,
    });
  }

  let parentRefresh = null;
  if (typeof refreshParent === "function" && child.parent_order_id) {
    parentRefresh = await refreshParent(child.parent_order_id).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  }

  if (typeof notifyBoss === "function") {
    await notifyBoss(saved, {
      title: "当前陪玩无法接单",
      body: "当前陪玩无法接单，请重新选择陪玩。",
      kind: "order_companion_unavailable",
    }).catch(() => false);
  }

  if (typeof addSystemMessage === "function") {
    await addSystemMessage(
      saved,
      companionId || child.companion_id,
      "companion",
      `陪玩 ${companionName || ""} 无法接单（${reason || ""}）。子单已退出确认队列，老板可补位或只保留其余陪玩；其他陪玩状态不受影响。`
    ).catch(() => null);
  }

  return { ok: true, order: saved, parentRefresh, softExit: true };
}

export async function refreshParentWithDeps(parentOrderId, deps = {}) {
  const { restUrl, supabaseJson, serviceHeaders, awardBossPointsForCompletedOrder = null } = deps;
  return refreshParentOrderStatus(parentOrderId, {
    loadOrder: async (id) => {
      const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      return rows?.[0] || null;
    },
    loadChildren: async (id) => {
      const rows = await supabaseJson(
        restUrl("orders", `?parent_order_id=eq.${encodeURIComponent(id)}&order=created_at.asc`),
        { headers: serviceHeaders() }
      );
      return Array.isArray(rows) ? rows : [];
    },
    patchOrder: async (id, patch) => {
      const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
      return rows?.[0] || null;
    },
    awardBossPointsForCompletedOrder,
  });
}

export { isMultiGroupChild, isMultiGroupParent, ORDER_TYPE_MULTI_GROUP, money };
