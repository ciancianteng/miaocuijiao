/**
 * Order-scoped CS session ownership helpers.
 * Lock unit = conversation (order_id / consult), never permanent boss account lock.
 */

export const CS_LOCK_DENIED =
  "该订单当前由其他客服负责，你没有操作权限。";

export const CS_LOCK_VIEW_ONLY = (name) =>
  `该订单正在由【${name || "其他客服"}】处理中，当前仅可查看。`;

export function isAdminLike(profile) {
  return ["admin", "super_admin", "finance_admin"].includes(String(profile?.role || ""));
}

export function isClosedStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "closed" || s === "ended";
}

export function lockStatusOf(conversation = {}) {
  if (isClosedStatus(conversation.status) || isClosedStatus(conversation.rawStatus)) return "ended";
  if (String(conversation.status || "").toLowerCase() === "pending_transfer") return "pending_transfer";
  if (conversation.customer_service_id || conversation.currentServiceId || conversation.assignedCsId) {
    return "assigned";
  }
  return "waiting";
}

export function ownershipDeniedError(ownerName = "其他客服") {
  const err = new Error(CS_LOCK_DENIED);
  err.status = 403;
  err.code = "CS_SESSION_LOCKED";
  err.ownerName = ownerName;
  err.messageDetail = CS_LOCK_VIEW_ONLY(ownerName);
  return err;
}

/**
 * Assert current CS owns the conversation (or is admin).
 * @returns {{ ok:true, conversation } | throws }
 */
export async function assertOwnsConversation({
  conversation,
  serviceProfile,
  allowAdmin = true,
  allowUnassigned = false,
} = {}) {
  if (!conversation) {
    const err = new Error("会话不存在。");
    err.status = 404;
    throw err;
  }
  if (isClosedStatus(conversation.status)) {
    const err = new Error("会话已结束，无法继续操作。");
    err.status = 403;
    err.code = "CS_SESSION_ENDED";
    throw err;
  }
  const ownerId = String(conversation.customer_service_id || "").trim();
  const me = String(serviceProfile?.id || "").trim();
  if (allowAdmin && isAdminLike(serviceProfile)) {
    return { ok: true, conversation, adminOverride: true };
  }
  if (!ownerId) {
    if (allowUnassigned) return { ok: true, conversation, unassigned: true };
    const err = new Error("请先点击「开始接待」后再操作。");
    err.status = 403;
    err.code = "CS_SESSION_UNCLAIMED";
    throw err;
  }
  if (ownerId !== me) {
    throw ownershipDeniedError();
  }
  return { ok: true, conversation };
}

/**
 * Resolve open conversation for an order and assert ownership for mutating ops.
 * If no conversation / no owner yet, allow (waiting pool) unless requireOwner=true.
 */
export async function assertCanMutateOrder({
  order,
  serviceProfile,
  loadOpenConversation,
  allowAdmin = true,
  requireOwner = false,
} = {}) {
  if (!order) {
    const err = new Error("订单不存在。");
    err.status = 404;
    throw err;
  }
  if (allowAdmin && isAdminLike(serviceProfile)) {
    return { ok: true, adminOverride: true };
  }
  const me = String(serviceProfile?.id || "").trim();
  const orderCs = String(order.customer_service_id || "").trim();
  let conv = null;
  if (typeof loadOpenConversation === "function" && order.id) {
    conv = await loadOpenConversation(order.id);
  }
  const convCs = String(conv?.customer_service_id || "").trim();
  const ownerId = convCs || orderCs;
  if (!ownerId) {
    if (requireOwner) {
      const err = new Error("请先接待该订单会话后再操作。");
      err.status = 403;
      err.code = "CS_SESSION_UNCLAIMED";
      throw err;
    }
    return { ok: true, unassigned: true, conversation: conv };
  }
  if (ownerId !== me) {
    throw ownershipDeniedError();
  }
  return { ok: true, conversation: conv };
}

export async function writeLockLog(
  { restUrl, supabaseJson, serviceHeaders },
  {
    conversationId = null,
    orderId = null,
    action,
    fromCsId = null,
    toCsId = null,
    operatorId = null,
    operatorRole = "customer_service",
    detail = "",
  }
) {
  if (!action) return null;
  const payload = {
    conversation_id: conversationId || null,
    order_id: orderId || null,
    action: String(action).slice(0, 64),
    from_cs_id: fromCsId || null,
    to_cs_id: toCsId || null,
    operator_id: operatorId || null,
    operator_role: String(operatorRole || "").slice(0, 40),
    detail: String(detail || "").slice(0, 2000),
    created_at: new Date().toISOString(),
  };
  try {
    const rows = await supabaseJson(restUrl("conversation_lock_logs", ""), {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    return Array.isArray(rows) ? rows[0] : payload;
  } catch (err) {
    if (/conversation_lock_logs|schema cache|PGRST|does not exist/i.test(String(err?.message || err))) {
      return null;
    }
    return null;
  }
}

export async function touchConversationActive(
  { restUrl, supabaseJson, serviceHeaders },
  conversationId
) {
  if (!conversationId) return;
  const now = new Date().toISOString();
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ last_active_at: now, updated_at: now }),
    });
  } catch (err) {
    if (/last_active_at|column|schema/i.test(String(err?.message || ""))) {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ updated_at: now }),
        });
      } catch (_) {}
    }
  }
}
