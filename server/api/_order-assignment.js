/**
 * Order assignment routing helpers.
 *
 * assignment_type:
 *   - public   → 公开抢单；companion_id MUST be null while in hall
 *   - assigned → 指定陪玩；companion_id required; NEVER in public grab hall
 *
 * Status mapping (DB enum ↔ product language):
 *   pending / waiting_for_companion  → hall-open (DB: pending)
 *   waiting_boss_confirm             → hall selecting after grabs
 *   claimed / waiting_companion_confirm → 待陪玩确认 (DB: claimed)
 */
export const ASSIGNMENT_PUBLIC = "public";
export const ASSIGNMENT_ASSIGNED = "assigned";

export function resolveAssignmentType(row = {}) {
  const raw = String(row.assignment_type || row.assignmentType || "")
    .trim()
    .toLowerCase();
  if (raw === "assigned" || raw === "direct" || raw === "direct_companion") return ASSIGNMENT_ASSIGNED;
  if (raw === "public" || raw === "open" || raw === "open_grab") return ASSIGNMENT_PUBLIC;
  const orderType = String(row.order_type || row.orderType || "").toLowerCase();
  if (/direct_companion|assigned|指定/.test(orderType) && row.companion_id) return ASSIGNMENT_ASSIGNED;
  if (row.companion_id && String(row.status || "") === "awaiting_payment") return ASSIGNMENT_ASSIGNED;
  if (row.companion_id && ["claimed", "confirmed", "in_progress"].includes(String(row.status || ""))) {
    // Ambiguous without column: prefer assigned when no evidence of public grabs in row flags.
    if (row._hadPublicGrabs === true) return ASSIGNMENT_PUBLIC;
    if (row._hadPublicGrabs === false) return ASSIGNMENT_ASSIGNED;
  }
  if (!row.companion_id) return ASSIGNMENT_PUBLIC;
  return ASSIGNMENT_ASSIGNED;
}

export function isPublicHallEligible(row = {}) {
  if (resolveAssignmentType(row) !== ASSIGNMENT_PUBLIC) return false;
  if (row.companion_id) return false;
  const status = String(row.status || "");
  return status === "pending" || status === "waiting_boss_confirm";
}

export function isAssignedPendingConfirm(row = {}, companionId = "") {
  if (resolveAssignmentType(row) !== ASSIGNMENT_ASSIGNED) return false;
  if (!row.companion_id) return false;
  if (companionId && String(row.companion_id) !== String(companionId)) return false;
  return String(row.status || "") === "claimed";
}

/** Fields safe to show on the public grab hall card. */
export function sanitizeHallOrderView(viewed = {}) {
  const publicNote = String(viewed.bossNotes || viewed.remark || "")
    .replace(/(?:电话|手机|联系方式|微信|WhatsApp|QQ)[：:\s]*[^\n；;]*/gi, "")
    .replace(/(?:密码|口令|支付|付款方式|收款)[：:\s]*[^\n；;]*/gi, "")
    .replace(/(?:指定陪玩|陪玩姓名|陪玩名)[：:\s]*[^\n；;]*/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return {
    id: viewed.id,
    orderNo: viewed.orderNo,
    orderType: viewed.orderType,
    orderTypeKey: viewed.orderTypeKey,
    orderSource: viewed.orderSource,
    game: viewed.game,
    gameServer: viewed.gameServer,
    serviceContent: String(viewed.serviceContent || "")
      .replace(/(?:电话|手机|联系方式|微信|WhatsApp|QQ|密码|口令|付款方式)[：:\s]*[^\n；;]*/gi, "")
      .trim()
      .slice(0, 240),
    serviceName: viewed.serviceName,
    serviceType: viewed.serviceType,
    duration: viewed.duration,
    hours: viewed.hours,
    unitPrice: viewed.unitPrice,
    amount: viewed.amount,
    playerIncome: viewed.playerIncome,
    platformFee: viewed.platformFee,
    bossNotes: publicNote || "-",
    remark: publicNote || "-",
    appointmentAt: viewed.appointmentAt,
    createdAt: viewed.createdAt,
    orderStatus: viewed.orderStatus,
    status: viewed.status,
    statusText: viewed.statusText,
    requiredLevel: viewed.requiredLevel,
    requiredTags: viewed.requiredTags,
    assignmentType: ASSIGNMENT_PUBLIC,
    // Explicitly omit: companionId, bossId, bossName, bossUid, gameId, settlement, raw, phone, payment
    myGrab: viewed.myGrab || null,
    grabCount: viewed.grabCount || 0,
    alreadyGrabbed: !!viewed.alreadyGrabbed,
    hallState: viewed.hallState,
    hallStateLabel: viewed.hallStateLabel,
    flowStatus: viewed.flowStatus,
    canGrab: !!viewed.canGrab,
  };
}

export function assignmentPatch({ type, companionId = null } = {}) {
  const assignment_type = type === ASSIGNMENT_ASSIGNED ? ASSIGNMENT_ASSIGNED : ASSIGNMENT_PUBLIC;
  if (assignment_type === ASSIGNMENT_ASSIGNED) {
    return {
      assignment_type,
      companion_id: companionId || null,
      order_type: "direct_companion",
    };
  }
  return {
    assignment_type: ASSIGNMENT_PUBLIC,
    companion_id: null,
    order_type: "open_grab",
  };
}

/** Soft-apply assignment_type on patch bodies; callers may strip if column missing. */
export async function patchWithAssignment(supabaseJson, restUrl, serviceHeaders, orderId, patch) {
  try {
    const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(patch),
    });
    return rows?.[0] || null;
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (!/assignment_type|PGRST204|schema cache|column/i.test(msg)) throw err;
    const { assignment_type: _a, ...rest } = patch;
    const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(rest),
    });
    return rows?.[0] || null;
  }
}
