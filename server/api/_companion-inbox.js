/**
 * Companion inbox: official CS chat + system notifications with DB read receipts.
 */
function nowIso() {
  return new Date().toISOString();
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const WD_STATUS_TEXT = {
  pending_review: "待审核",
  approved_pending_pay: "已通过",
  paying: "审核中",
  paid_pending_receipt: "已通过",
  completed: "已打款",
  rejected: "已拒绝",
  pay_failed: "付款失败",
  cancelled: "已取消",
};

const ORDER_STATUS_TEXT = {
  awaiting_payment: "待付款",
  pending: "待接单",
  claimed: "待陪玩确认",
  confirmed: "待开始",
  in_progress: "进行中",
  waiting_boss_confirm: "选择陪玩中",
  completed: "已完成",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "已退款",
};

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
  return base;
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || "数据库请求失败");
  }
  return body;
}

export function buildSystemNotices({ companionUserId, player = {}, verification = {}, deposit = {}, orders = [], withdrawals = [], popularity = {}, auditLocked = false, auditHint = "" } = {}) {
  const items = [];
  const push = (key, category, title, body, at, href = "") => {
    items.push({
      id: key,
      key,
      category,
      categoryLabel:
        ({ system: "系统通知", order: "订单通知", withdraw: "提现通知", audit: "审核通知", activity: "活动通知" })[category] || "系统通知",
      title,
      body,
      at: at || "",
      href,
    });
  };
  if (auditLocked) push("sys-audit", "audit", "账号审核中", auditHint || "账号审核通过后即可开始接单。", "", "/companion/account");
  if (verification.identityRejectReason) push("audit-id", "audit", "实名认证未通过", verification.identityRejectReason, "", "/companion/account");
  if (verification.paymentRejectReason) push("audit-pay", "audit", "收款账户未通过", verification.paymentRejectReason, "", "/companion/account");
  if (deposit.rejectReason || verification.depositRejectReason) {
    push("audit-dep", "audit", "押金审核未通过", deposit.rejectReason || verification.depositRejectReason, "", "/companion/account");
  }
  if (verification.applicationRejectReason) {
    push("audit-app", "audit", "资料审核未通过", verification.applicationRejectReason, "", "/companion/profile");
  }
  push("sys-welcome", "system", "欢迎使用陪玩端", "完善公开资料与账号中心后，等待后台审核通过即可接单。", "", "/companion/dashboard");
  (orders || []).slice(0, 40).forEach((o) => {
    const status = ORDER_STATUS_TEXT[o.status] || o.orderStatus || o.statusText || "状态更新";
    const no = o.orderNo || o.order_no || "";
    if (!no && /^[0-9a-f-]{36}$/i.test(String(o.id || ""))) return;
    push(
      `ord-${o.id}`,
      "order",
      `订单 ${no || "更新"}`,
      `${status} · ${o.game || o.serviceName || "服务"}`,
      o.updatedAt || o.createdAt || "",
      "/companion/orders"
    );
  });
  (withdrawals || []).forEach((w) => {
    const no = w.withdrawalNo || w.withdrawal_no || "";
    push(
      `wd-${w.id}`,
      "withdraw",
      `提现 ${no || ""}`.trim(),
      `${WD_STATUS_TEXT[w.status] || "状态更新"} · ${money(w.catFoodAmount || w.cat_food_amount || w.amount)} 猫粮`,
      w.submittedAt || w.submitted_at || w.createdAt || w.created_at || "",
      "/companion/earnings?tab=records"
    );
  });
  const tip = popularity?.weekly?.tip;
  if (tip && !/regression|selector|grabber|uuid/i.test(String(tip))) {
    push("act-pop", "activity", "人气活动", tip, "", "/companion/dashboard");
  }
  return items;
}

export async function loadReadKeys(companionId) {
  const rows = await supabaseJson(
    restUrl("companion_notification_reads", `?companion_id=eq.${encodeURIComponent(companionId)}&select=notice_key`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.notice_key)));
}

export async function markNoticesRead(companionId, keys = []) {
  const list = [...new Set((keys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  if (!list.length) return { marked: 0 };
  const rows = list.map((notice_key) => ({
    companion_id: companionId,
    notice_key,
    read_at: nowIso(),
  }));
  // upsert in chunks
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    await supabaseJson(restUrl("companion_notification_reads", ""), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(chunk),
    }).catch(async () => {
      // fallback: individual insert ignore conflicts
      for (const row of chunk) {
        await supabaseJson(restUrl("companion_notification_reads", ""), {
          method: "POST",
          headers: serviceHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify(row),
        }).catch(() => null);
      }
    });
  }
  return { marked: list.length };
}

export async function ensureCompanionSupportConversation(companionUserId) {
  const existing = await supabaseJson(
    restUrl(
      "conversations",
      `?companion_id=eq.${encodeURIComponent(companionUserId)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (existing?.[0]) return existing[0];

  const payload = {
    boss_id: null,
    companion_id: companionUserId,
    customer_service_id: null,
    order_id: null,
    conversation_type: "companion_support",
    status: "waiting_service",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  try {
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    const conversation = rows?.[0];
    if (conversation?.id) {
      await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          conversation_id: conversation.id,
          sender_id: companionUserId,
          sender_role: "companion",
          message_type: "system",
          content: "陪玩发起官方客服咨询。",
          order_id: null,
          read_at: null,
          created_at: nowIso(),
        }),
      }).catch(() => null);
    }
    return conversation;
  } catch (error) {
    // retry without conversation_type if column missing
    if (!/conversation_type|column|schema/i.test(String(error.message || ""))) throw error;
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        boss_id: null,
        companion_id: companionUserId,
        customer_service_id: null,
        order_id: null,
        status: "waiting_service",
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    return rows?.[0] || null;
  }
}

export async function loadConversationMessages(conversationId) {
  if (!conversationId) return [];
  const rows = await supabaseJson(
    restUrl("messages", `?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=300`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function sendCompanionChatMessage(conversation, companionUserId, content, messageType = "text") {
  let text = String(content || "").trim();
  let type = String(messageType || "text").trim() || "text";
  if (!text) throw Object.assign(new Error("不能发送空消息"), { status: 400 });
  if (!conversation?.id) throw Object.assign(new Error("会话不存在"), { status: 404 });
  if (conversation.status === "closed" || conversation.status === "ended") {
    throw Object.assign(new Error("会话已结束，无法继续发送"), { status: 403 });
  }
  if (type === "image" && !(/^https?:\/\//i.test(text) || text.startsWith("__IMG__:"))) {
    throw Object.assign(new Error("图片消息内容无效"), { status: 400 });
  }
  const payload = {
    conversation_id: conversation.id,
    sender_id: companionUserId,
    sender_role: "companion",
    message_type: type,
    content: text,
    order_id: conversation.order_id || null,
    read_at: null,
    created_at: nowIso(),
  };
  let rows;
  try {
    rows = await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (type === "image" && /enum|invalid input|message_type/i.test(String(err.message || ""))) {
      payload.message_type = "text";
      payload.content = text.startsWith("__IMG__:") ? text : `__IMG__:${text}`;
      rows = await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      });
    } else {
      throw err;
    }
  }
  await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ updated_at: nowIso(), last_message_at: nowIso() }),
  }).catch(() => null);
  return rows?.[0] || null;
}

export async function markConversationMessagesRead(conversationId, { companionUserId } = {}) {
  const readAt = nowIso();
  // Only mark messages FROM the other party (CS / system), never companion's own sends.
  const filters = [
    `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.customer_service&read_at=is.null`,
    `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.system&read_at=is.null`,
  ];
  if (companionUserId) {
    filters.push(
      `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_id=neq.${encodeURIComponent(companionUserId)}&read_at=is.null`
    );
  }
  for (const q of filters) {
    await supabaseJson(restUrl("messages", q), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ read_at: readAt }),
    }).catch(() => null);
  }
  await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ last_read_at: readAt, updated_at: readAt }),
  }).catch(() => null);
  return { readAt };
}

export function viewMessage(row = {}) {
  const role = String(row.sender_role || "");
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderRole: role,
    senderLabel: role === "companion" ? "我" : role === "customer_service" ? "客服" : role === "system" || row.message_type === "system" ? "系统" : "对方",
    side: role === "companion" ? "right" : "left",
    messageType: row.message_type || "text",
    content: row.content || "",
    createdAt: row.created_at || "",
    readAt: row.read_at || "",
  };
}

export async function buildCompanionInbox(profile, companion, bootstrapSlice = {}) {
  const conversation = await ensureCompanionSupportConversation(profile.id);
  const messages = conversation?.id ? await loadConversationMessages(conversation.id) : [];
  const csUnread = messages.filter(
    (m) =>
      m.sender_role !== "companion" &&
      String(m.sender_id || "") !== String(profile.id) &&
      !m.read_at &&
      m.message_type !== "system"
  ).length;
  const notices = buildSystemNotices({
    companionUserId: profile.id,
    player: bootstrapSlice.player,
    verification: bootstrapSlice.verification,
    deposit: bootstrapSlice.deposit,
    orders: bootstrapSlice.myOrders || bootstrapSlice.orders,
    withdrawals: bootstrapSlice.withdrawals,
    popularity: bootstrapSlice.popularity,
    auditLocked: bootstrapSlice.auditLocked,
    auditHint: bootstrapSlice.auditHint,
  });
  const readKeys = await loadReadKeys(profile.id).catch(() => new Set());
  const systemNotices = notices.map((n) => ({
    ...n,
    unread: !readKeys.has(n.key),
  }));
  const systemUnread = systemNotices.filter((n) => n.unread).length;
  const lastCs = [...messages].reverse().find((m) => m.message_type !== "system") || messages[messages.length - 1];
  return {
    conversations: [
      {
        id: conversation?.id || "cs",
        key: "cs",
        type: "cs",
        title: "官方客服",
        subtitle: conversation?.customer_service_id ? "客服接待中" : "等待客服接待",
        lastMessage: lastCs?.content || "有问题可以咨询官方客服",
        lastTime: lastCs?.created_at || conversation?.updated_at || "",
        unread: csUnread,
      },
      {
        id: "system",
        key: "system",
        type: "system",
        title: "系统通知",
        subtitle: "订单 / 审核 / 提现 / 活动",
        lastMessage: systemNotices[0]?.title || "暂无通知",
        lastTime: systemNotices[0]?.at || "",
        unread: systemUnread,
      },
    ],
    csConversationId: conversation?.id || "",
    messages: messages.map(viewMessage),
    systemNotices,
    unreadTotal: csUnread + systemUnread,
    unreadMessages: csUnread + systemUnread,
  };
}
