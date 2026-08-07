/**
 * Companion inbox: official CS chat + system notifications with DB read receipts.
 */
import {
  normalizeCompanionConsultType,
  consultTypeLabel,
  TRANSFER_USER_TIP,
  isPendingTransferStatus,
  isClosedConversationStatus,
  conversationStatusLabel,
} from "./_conversation-lock.js";
import {
  decorateChatMessage,
  normalizeImageUrl,
  persistImageMessage,
  messagePreviewText,
} from "./_chat-message.js";
import {
  anonymousBossLabel,
  publicDisplayName,
  resolveBossPublicCode,
} from "./_account-codes.js";

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

const CATEGORY_LABEL_CN = {
  system: "系统通知",
  order: "订单通知",
  withdraw: "提现通知",
  audit: "审核通知",
  activity: "活动通知",
};

/**
 * Persist a companion system notification (service role). Survives refresh/relogin.
 */
export async function insertCompanionNotification({
  companionUserId,
  category = "system",
  title = "",
  body = "",
  href = "/companion/account",
  noticeKey = "",
  notificationType = "",
  relatedApplicationId = "",
} = {}) {
  const uid = String(companionUserId || "").trim();
  if (!uid) return null;
  const key =
    String(noticeKey || "").trim() ||
    `${category || "system"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = {
    companion_id: uid,
    notice_key: key,
    category: String(category || "system"),
    title: String(title || "").trim() || "系统通知",
    body: String(body || "").trim(),
    href: String(href || "/companion/account"),
    created_at: nowIso(),
  };
  const rich = {
    ...base,
    notification_type: String(notificationType || category || "system").trim(),
    related_application_id: String(relatedApplicationId || "").trim() || null,
  };
  try {
    await supabaseJson(restUrl("companion_notifications", ""), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(rich),
    });
    return key;
  } catch (err) {
    const detail = String(err?.message || err || "");
    if (/notification_type|related_application_id|column|schema|PGRST/i.test(detail)) {
      try {
        await supabaseJson(restUrl("companion_notifications", ""), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify(base),
        });
        return key;
      } catch (err2) {
        console.warn("[companion-inbox] insertCompanionNotification failed:", err2?.message || err2);
        return null;
      }
    }
    console.warn("[companion-inbox] insertCompanionNotification failed:", err?.message || err);
    return null;
  }
}

export async function notifyCompanionReviewResult(
  companionUserId,
  { status, reason = "", kind = "application", applicationId = "", email = "" } = {}
) {
  const st = String(status || "").toLowerCase();
  const approved = /approved|verified|passed|paid/.test(st);
  const rejected = /reject|resubmit|need_more|declin|fail/.test(st);
  if (!approved && !rejected) return null;

  // Application review: dedicated titles + email / email_pending
  if (kind === "application") {
    const { notifyCompanionApplicationReview } = await import("./_companion-review-notify.js");
    return notifyCompanionApplicationReview(companionUserId, {
      status,
      reason,
      applicationId,
      email,
    });
  }

  const kindLabel =
    ({ identity: "实名认证", payment: "收款账户", deposit: "押金审核", media: "媒体审核" })[kind] || "资料审核";
  const title = approved ? `${kindLabel}已通过` : `${kindLabel}未通过`;
  const body = approved
    ? `${kindLabel}已通过，可继续完善资料或接单。`
    : String(reason || "").trim() || "请根据驳回原因修改后重新提交。";
  const href =
    kind === "identity" || kind === "payment" || kind === "deposit" ? "/companion/account" : "/companion/profile";
  return insertCompanionNotification({
    companionUserId,
    category: "audit",
    title,
    body,
    href,
    noticeKey: `audit-${kind}-${approved ? "pass" : "reject"}-${Date.now()}`,
    notificationType: `audit_${kind}_${approved ? "pass" : "reject"}`,
  });
}

export async function loadCompanionNotifications(companionUserId) {
  const uid = String(companionUserId || "").trim();
  if (!uid) return [];
  const rows = await supabaseJson(
    restUrl(
      "companion_notifications",
      `?companion_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=100&select=id,notice_key,category,title,body,href,created_at`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const key = String(row.notice_key || row.id || "");
      const category = String(row.category || "system");
      if (category === "email_log") return null;
      return {
        id: key,
        key,
        dbId: row.id || "",
        category,
        categoryLabel: CATEGORY_LABEL_CN[category] || "系统通知",
        title: row.title || "系统通知",
        body: row.body || "",
        at: row.created_at || "",
        href: row.href || "/companion/account",
        fromDb: true,
      };
    })
    .filter(Boolean);
}

/** Derived notices from live order/withdraw rows. Audit notices come from companion_notifications. */
export function buildSystemNotices({ companionUserId, player = {}, verification = {}, deposit = {}, orders = [], withdrawals = [], popularity = {}, auditLocked = false, auditHint = "" } = {}) {
  const items = [];
  const push = (key, category, title, body, at, href = "") => {
    items.push({
      id: key,
      key,
      category,
      categoryLabel: CATEGORY_LABEL_CN[category] || "系统通知",
      title,
      body,
      at: at || "",
      href,
    });
  };
  void companionUserId;
  void player;
  void verification;
  void deposit;
  void auditLocked;
  void auditHint;
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

function shanghaiTodayKey() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseCsMeta(note = "") {
  const text = String(note || "");
  const idx = text.indexOf("MCJ_CS_META:");
  if (idx === -1) return {};
  try {
    return JSON.parse(text.slice(idx + "MCJ_CS_META:".length));
  } catch {
    return {};
  }
}

/** Pick an on-duty CS (clocked in); else least-busy active CS. */
export async function pickOnlineCustomerServiceId() {
  const profiles = await supabaseJson(
    restUrl("profiles", "?role=eq.customer_service&status=eq.active&select=id,display_name&order=created_at.asc&limit=80"),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const list = Array.isArray(profiles) ? profiles : [];
  if (!list.length) return null;

  const today = shanghaiTodayKey();
  const onDuty = [];
  for (const p of list) {
    const rows = await supabaseJson(
      restUrl(
        "customer_service_reports",
        `?customer_service_id=eq.${encodeURIComponent(p.id)}&report_date=eq.${encodeURIComponent(today)}&order=created_at.desc&limit=5`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    for (const row of rows || []) {
      const meta = parseCsMeta(row.note);
      if (meta.kind === "config") continue;
      const clockIn = row.shift_start || meta.clockInAt || "";
      const clockOut = row.shift_end || meta.clockOutAt || "";
      if (clockIn && !clockOut) {
        onDuty.push(p);
        break;
      }
    }
  }
  const pool = onDuty.length ? onDuty : list;

  const open = await supabaseJson(
    restUrl("conversations", "?customer_service_id=not.is.null&status=not.in.(closed,ended)&select=customer_service_id&limit=2000"),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const counts = {};
  (open || []).forEach((c) => {
    const id = c.customer_service_id;
    if (id) counts[id] = (counts[id] || 0) + 1;
  });
  pool.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || String(a.id).localeCompare(String(b.id)));
  return pool[0]?.id || null;
}

async function assignOnlineCustomerService(conversation) {
  if (!conversation?.id || conversation.customer_service_id) return conversation;
  const csId = await pickOnlineCustomerServiceId();
  if (!csId) return conversation;
  const acceptedAt = nowIso();
  async function claim(patch) {
    const rows = await supabaseJson(
      restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}&customer_service_id=is.null`),
      {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      }
    );
    return Array.isArray(rows) ? rows[0] : null;
  }
  let updated = null;
  try {
    updated = await claim({
      customer_service_id: csId,
      status: "active",
      accepted_at: acceptedAt,
      updated_at: acceptedAt,
    });
  } catch (err) {
    const detail = String(err?.message || "");
    if (/accepted_at|column|schema/i.test(detail)) {
      try {
        updated = await claim({ customer_service_id: csId, status: "active", updated_at: acceptedAt });
      } catch (err2) {
        if (/status|check|invalid/i.test(String(err2?.message || ""))) {
          updated = await claim({ customer_service_id: csId, status: "serving", updated_at: acceptedAt }).catch(() => null);
        }
      }
    } else if (/status|check|invalid/i.test(detail)) {
      updated = await claim({ customer_service_id: csId, status: "serving", updated_at: acceptedAt }).catch(() => null);
    }
  }
  if (updated?.id) {
    await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conversation.id,
        sender_id: csId,
        sender_role: "system",
        message_type: "system",
        content: "系统已自动分配在线客服，可直接发消息。",
        order_id: null,
        read_at: null,
        created_at: nowIso(),
      }),
    }).catch(() => null);
    return updated;
  }
  return conversation;
}

export async function ensureCompanionSupportConversation(companionUserId, opts = {}) {
  const orderId = String(opts.orderId || opts.order_id || "").trim() || null;
  const forceNew = !!(opts.forceNew || opts.force_new);
  const consultType = normalizeCompanionConsultType(opts.consultType || opts.consult_type, { orderId: orderId || "" });
  const consultLabel = consultTypeLabel("companion", consultType);

  // Reuse ONLY same companion + order_id + consult_type. Never lock whole companion account.
  if (!forceNew) {
    const base = orderId
      ? `?companion_id=eq.${encodeURIComponent(companionUserId)}&conversation_type=eq.companion_support&order_id=eq.${encodeURIComponent(orderId)}&status=not.in.(closed,ended)`
      : `?companion_id=eq.${encodeURIComponent(companionUserId)}&conversation_type=eq.companion_support&order_id=is.null&status=not.in.(closed,ended)`;
    const withConsult = `${base}&consult_type=eq.${encodeURIComponent(consultType)}&order=updated_at.desc&limit=1`;
    let existing = await supabaseJson(restUrl("conversations", withConsult), { headers: serviceHeaders() }).catch((err) => {
      if (/consult_type|column|schema/i.test(String(err?.message || ""))) return null;
      return [];
    });
    if (existing === null) {
      existing = await supabaseJson(restUrl("conversations", `${base}&order=updated_at.desc&limit=1`), {
        headers: serviceHeaders(),
      }).catch(() => []);
    }
    // Do NOT auto-assign CS. Conversations stay in the waiting pool until a human CS clicks 接待.
    if (existing?.[0]) return existing[0];
  }

  const payload = {
    boss_id: null,
    companion_id: companionUserId,
    customer_service_id: null,
    order_id: orderId,
    conversation_type: "companion_support",
    consult_type: consultType,
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
      const tip = orderId
        ? `陪玩发起官方客服咨询（${consultLabel}），已关联订单，正在等待客服接待。`
        : `陪玩发起官方客服咨询（${consultLabel}），正在等待客服接待。`;
      await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          conversation_id: conversation.id,
          sender_id: companionUserId,
          sender_role: "companion",
          message_type: "system",
          content: tip,
          order_id: orderId,
          read_at: null,
          created_at: nowIso(),
        }),
      }).catch(() => null);
    }
    return conversation || null;
  } catch (error) {
    // retry without consult_type / conversation_type if column missing
    if (!/consult_type|conversation_type|column|schema/i.test(String(error.message || ""))) throw error;
    const legacy = {
      boss_id: null,
      companion_id: companionUserId,
      customer_service_id: null,
      order_id: orderId,
      status: "waiting_service",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    if (!/conversation_type/i.test(String(error.message || ""))) {
      legacy.conversation_type = "companion_support";
    }
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(legacy),
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
  const basePayload = {
    conversation_id: conversation.id,
    sender_id: companionUserId,
    sender_role: "companion",
    order_id: conversation.order_id || null,
    read_at: null,
    created_at: nowIso(),
  };
  const insertFn = (payload) =>
    supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });

  let row = null;
  if (type === "image") {
    if (!normalizeImageUrl(text)) {
      throw Object.assign(new Error("图片消息内容无效"), { status: 400 });
    }
    const saved = await persistImageMessage(insertFn, basePayload, text);
    row = saved.row;
  } else {
    const rows = await insertFn({ ...basePayload, message_type: type, content: text });
    row = Array.isArray(rows) ? rows[0] : rows;
  }
  await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ updated_at: nowIso(), last_message_at: nowIso() }),
  }).catch(() => null);
  return row || null;
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
  const decorated = decorateChatMessage(row, {
    senderName:
      role === "companion"
        ? "我"
        : role === "customer_service"
          ? "客服"
          : role === "system" || row.message_type === "system"
            ? "系统"
            : "对方",
  });
  return {
    id: decorated.id,
    conversationId: decorated.conversationId,
    senderId: decorated.senderId,
    senderRole: role,
    senderLabel: decorated.senderName,
    side: role === "companion" ? "right" : "left",
    messageType: decorated.messageType,
    content: decorated.content,
    imageUrl: decorated.imageUrl,
    image_url: decorated.image_url,
    createdAt: decorated.createdAt,
    readAt: decorated.readAt,
  };
}

function conversationUnreadCount(messages, companionUserId) {
  return (messages || []).filter(
    (m) =>
      m.sender_role !== "companion" &&
      String(m.sender_id || "") !== String(companionUserId || "") &&
      !m.read_at &&
      m.message_type !== "system"
  ).length;
}

async function loadCompanionSupportConversations(companionUserId) {
  const uid = String(companionUserId || "").trim();
  if (!uid) return [];
  // Include companion_support AND order_support threads this companion is on,
  // so boss/CS image messages on the order room sync to the companion end.
  const select =
    "id,companion_id,boss_id,customer_service_id,order_id,consult_type,status,conversation_type,created_at,updated_at,last_message_at,closed_at,ended_at,closed_by,accepted_at,title";
  const rows = await supabaseJson(
    restUrl(
      "conversations",
      `?companion_id=eq.${encodeURIComponent(uid)}&order=updated_at.desc&limit=100&select=${select}`
    ),
    { headers: serviceHeaders() }
  ).catch(async (err) => {
    if (!/consult_type|closed_at|ended_at|closed_by|boss_id|conversation_type|column|schema/i.test(String(err?.message || ""))) {
      return [];
    }
    return supabaseJson(
      restUrl("conversations", `?companion_id=eq.${encodeURIComponent(uid)}&order=updated_at.desc&limit=100`),
      { headers: serviceHeaders() }
    ).catch(() => []);
  });
  const list = Array.isArray(rows) ? rows : [];
  // Prefer support + order rooms; drop accidental unrelated rows without type if any.
  return list.filter((row) => {
    const t = String(row.conversation_type || "");
    if (!t) return true;
    return t === "companion_support" || t === "order_support" || t === "general_support";
  });
}

async function resolveOrderMeta(orderIds = []) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await supabaseJson(
    restUrl("orders", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,order_no,boss_id`),
    { headers: serviceHeaders() }
  ).catch(() =>
    supabaseJson(
      restUrl("orders", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,order_no`),
      { headers: serviceHeaders() }
    ).catch(() => [])
  );
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row?.id) return;
    map[String(row.id)] = {
      orderNo: String(row.order_no || "").trim(),
      bossId: String(row.boss_id || "").trim(),
    };
  });
  return map;
}

async function resolveCsDisplayNames(csIds = []) {
  const ids = [...new Set((csIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await supabaseJson(
    restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,email`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row?.id) return;
    map[String(row.id)] = String(row.display_name || row.email || "").trim() || "客服";
  });
  return map;
}

async function resolveBossPeers(bossIds = []) {
  const ids = [...new Set((bossIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await supabaseJson(
    restUrl(
      "profiles",
      `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,nickname,email,boss_uid`
    ),
    { headers: serviceHeaders() }
  ).catch(() =>
    supabaseJson(
      restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,email`),
      { headers: serviceHeaders() }
    ).catch(() => [])
  );
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row?.id) return;
    const code = resolveBossPublicCode(row);
    const nick = publicDisplayName(row, "");
    map[String(row.id)] = {
      name: nick || anonymousBossLabel(row) || "老板",
      code: code || "",
      label: nick || anonymousBossLabel(row) || "老板",
    };
  });
  return map;
}

/**
 * Batch last-message + unread for conversation list (no N×full-history fan-out).
 */
async function loadConversationListMeta(conversationIds = [], companionUserId = "") {
  const ids = [...new Set((conversationIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const meta = {};
  ids.forEach((id) => {
    meta[id] = { lastMessage: "", lastTime: "", unread: 0 };
  });
  if (!ids.length) return meta;

  const inList = ids.map(encodeURIComponent).join(",");
  const [messagesDesc, unreadRows] = await Promise.all([
    supabaseJson(
      restUrl(
        "messages",
        `?conversation_id=in.(${inList})&select=conversation_id,content,created_at,sender_role,message_type,image_url&order=created_at.desc&limit=400`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []),
    supabaseJson(
      restUrl(
        "messages",
        `?conversation_id=in.(${inList})&sender_role=neq.companion&read_at=is.null&message_type=neq.system&select=id,conversation_id,sender_id,sender_role&limit=2000`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []),
  ]);

  const lastByConv = {};
  for (const msg of Array.isArray(messagesDesc) ? messagesDesc : []) {
    const cid = String(msg?.conversation_id || "");
    if (!cid || lastByConv[cid]) continue;
    lastByConv[cid] = msg;
  }
  const unreadByConv = {};
  for (const row of Array.isArray(unreadRows) ? unreadRows : []) {
    const cid = String(row?.conversation_id || "");
    if (!cid) continue;
    if (companionUserId && String(row.sender_id || "") === String(companionUserId)) continue;
    if (String(row.sender_role || "") === "companion") continue;
    unreadByConv[cid] = (unreadByConv[cid] || 0) + 1;
  }

  ids.forEach((id) => {
    const last = lastByConv[id] || null;
    meta[id] = {
      lastMessage: last ? messagePreviewText(last) : "",
      lastTime: last?.created_at || "",
      unread: Number(unreadByConv[id] || 0),
    };
  });
  return meta;
}

function viewCompanionCsConversation(
  row = {},
  { orderNo = "", csName = "", lastMessage = "", lastTime = "", unread = 0, bossPeer = null } = {}
) {
  const closed = isClosedConversationStatus(row.status);
  const transferring = isPendingTransferStatus(row.status);
  const convType = String(row.conversation_type || "");
  const isOrderRoom = convType === "order_support" || (!!row.order_id && convType !== "companion_support");
  const consultKey = isOrderRoom
    ? "order_dock"
    : normalizeCompanionConsultType(row.consult_type, { orderId: row.order_id || "" });
  const consultLabel = isOrderRoom ? "订单沟通" : consultTypeLabel("companion", consultKey);
  const orderLabel = row.order_id ? orderNo || String(row.order_id).slice(0, 8) : "非订单咨询";
  const statusLabel = conversationStatusLabel(row);
  const peerName = isOrderRoom
    ? String(bossPeer?.label || bossPeer?.name || "老板")
    : String(csName || (row.customer_service_id ? "客服" : "官方客服"));
  const peerCode = isOrderRoom ? String(bossPeer?.code || "") : "";
  const subtitle = transferring
    ? TRANSFER_USER_TIP
    : closed
      ? `已结束 · ${orderLabel}`
      : `${statusLabel} · ${peerName}${peerCode && peerName.indexOf(peerCode) < 0 ? ` · ${peerCode}` : ""} · ${orderLabel}`;
  return {
    id: row.id,
    key: row.id,
    type: "cs",
    conversationType: convType || (isOrderRoom ? "order_support" : "companion_support"),
    title: consultLabel,
    subtitle,
    status: closed ? "ended" : transferring ? "pending_transfer" : row.customer_service_id ? "active" : "waiting",
    statusLabel,
    assignedServiceId: row.customer_service_id || "",
    assignedServiceName: csName || "",
    peerName,
    peerCode,
    bossName: isOrderRoom ? peerName : "",
    bossCode: peerCode,
    orderId: row.order_id || "",
    orderNo: orderNo || "",
    orderLabel,
    consultType: consultKey,
    consultTypeLabel: consultLabel,
    lastMessage: transferring ? TRANSFER_USER_TIP : lastMessage || (closed ? "会话已结束" : "发送消息开始咨询"),
    lastTime: lastTime || row.last_message_at || row.updated_at || row.created_at || "",
    endedAt: row.ended_at || row.closed_at || "",
    endedBy: row.closed_by || "",
    unread: closed ? 0 : unread,
    ended: closed,
  };
}

export async function endCompanionSupportConversation(companionUserId, conversationId, { endedByRole = "companion" } = {}) {
  const uid = String(companionUserId || "").trim();
  const cid = String(conversationId || "").trim();
  if (!uid || !cid) throw Object.assign(new Error("会话无效"), { status: 400 });
  const rows = await supabaseJson(
    restUrl("conversations", `?id=eq.${encodeURIComponent(cid)}&companion_id=eq.${encodeURIComponent(uid)}&limit=1`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const existing = rows?.[0] || null;
  if (!existing) throw Object.assign(new Error("会话不存在"), { status: 404 });
  if (isClosedConversationStatus(existing.status)) {
    return existing;
  }
  const closedAt = nowIso();
  const richPatch = {
    status: "ended",
    updated_at: closedAt,
    closed_at: closedAt,
    ended_at: closedAt,
    closed_by: uid,
  };
  let updated = null;
  try {
    const patched = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(cid)}&companion_id=eq.${encodeURIComponent(uid)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(richPatch),
    });
    updated = patched?.[0] || null;
  } catch (err) {
    const detail = String(err?.message || "");
    if (!/closed_at|ended_at|closed_by|column|schema/i.test(detail)) throw err;
    const patched = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(cid)}&companion_id=eq.${encodeURIComponent(uid)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "ended", updated_at: closedAt }),
    });
    updated = patched?.[0] || null;
  }
  await supabaseJson(restUrl("messages"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      conversation_id: cid,
      sender_id: uid,
      sender_role: "system",
      message_type: "system",
      content: endedByRole === "customer_service" ? "客服已结束本次对话。" : "陪玩已结束本次对话。",
      order_id: existing.order_id || null,
      read_at: null,
      created_at: closedAt,
    }),
  }).catch(() => null);
  return updated || { ...existing, status: "ended", closed_at: closedAt, ended_at: closedAt, closed_by: uid };
}

export async function loadCompanionThreadMessages(profile, conversationId) {
  const uid = String(profile?.id || "").trim();
  const cid = String(conversationId || "").trim();
  if (!uid || !cid) throw Object.assign(new Error("会话无效"), { status: 400 });
  const rows = await supabaseJson(
    restUrl("conversations", `?id=eq.${encodeURIComponent(cid)}&companion_id=eq.${encodeURIComponent(uid)}&limit=1`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const conversation = rows?.[0] || null;
  if (!conversation) throw Object.assign(new Error("会话不存在或无权访问"), { status: 404 });
  const messages = await loadConversationMessages(cid).catch(() => []);
  return {
    conversationId: cid,
    conversation: viewCompanionCsConversation(conversation, {
      orderNo: "",
      lastMessage: "",
      unread: 0,
    }),
    messages: (messages || []).map(viewMessage),
  };
}

export async function buildCompanionInbox(profile, companion, bootstrapSlice = {}) {
  const activeId = String(bootstrapSlice.activeConversationId || bootstrapSlice.conversationId || "").trim();
  const includeActiveMessages = bootstrapSlice.includeActiveMessages !== false;
  const skipDerivedNotices = !!bootstrapSlice.light || !!bootstrapSlice.skipDerivedNotices;
  let rows = [];
  try {
    rows = await loadCompanionSupportConversations(profile.id);
  } catch (err) {
    rows = [];
  }

  // Never auto-create a dump “官方客服” session on inbox load.
  // New sessions are created only via send / 发起新咨询 with consult_type (+ optional order_id).

  const listed = rows.slice(0, 60);
  const orderMeta = await resolveOrderMeta(listed.map((r) => r.order_id));
  const bossIds = listed
    .map((r) => String(r.boss_id || orderMeta[String(r.order_id || "")]?.bossId || "").trim())
    .filter(Boolean);
  const [csNames, bossPeers, threadMeta] = await Promise.all([
    resolveCsDisplayNames(listed.map((r) => r.customer_service_id)),
    resolveBossPeers(bossIds),
    loadConversationListMeta(
      listed.map((r) => r.id).filter(Boolean),
      profile.id
    ),
  ]);

  const csConversations = listed.map((row) => {
    const meta = threadMeta[row.id] || {};
    const oMeta = orderMeta[String(row.order_id || "")] || {};
    const bossId = String(row.boss_id || oMeta.bossId || "").trim();
    return viewCompanionCsConversation(row, {
      orderNo: oMeta.orderNo || "",
      csName: csNames[String(row.customer_service_id || "")] || "",
      lastMessage: meta.lastMessage || "",
      lastTime: meta.lastTime || "",
      unread: meta.unread || 0,
      bossPeer: bossPeers[bossId] || null,
    });
  });

  let active =
    (activeId && csConversations.find((c) => String(c.id) === activeId)) ||
    csConversations.find((c) => !c.ended) ||
    csConversations[0] ||
    null;

  let activeMessages = [];
  if (includeActiveMessages && active?.id) {
    activeMessages = await loadConversationMessages(active.id).catch(() => []);
  }
  const csUnreadTotal = csConversations.reduce((sum, c) => sum + Number(c.unread || 0), 0);

  let systemNotices = [];
  let systemUnread = 0;
  if (!bootstrapSlice.skipNotices) {
    const [dbNotices, derivedNotices, readKeys] = await Promise.all([
      loadCompanionNotifications(profile.id).catch(() => []),
      skipDerivedNotices
        ? Promise.resolve([])
        : Promise.resolve(
            buildSystemNotices({
              companionUserId: profile.id,
              player: bootstrapSlice.player,
              verification: bootstrapSlice.verification,
              deposit: bootstrapSlice.deposit,
              orders: bootstrapSlice.myOrders || bootstrapSlice.orders,
              withdrawals: bootstrapSlice.withdrawals,
              popularity: bootstrapSlice.popularity,
              auditLocked: bootstrapSlice.auditLocked,
              auditHint: bootstrapSlice.auditHint,
            })
          ),
      loadReadKeys(profile.id).catch(() => new Set()),
    ]);
    const seen = new Set();
    const notices = [...(dbNotices || []), ...(derivedNotices || [])].filter((n) => {
      const k = String(n.key || n.id || "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    systemNotices = notices.map((n) => ({
      ...n,
      unread: !readKeys.has(n.key),
    }));
    systemUnread = systemNotices.filter((n) => n.unread).length;
  }
  const transferring = active ? isPendingTransferStatus(active.status === "pending_transfer" ? "pending_transfer" : "") : false;
  const consultKey = active?.consultType || "other";

  return {
    conversations: [
      ...csConversations,
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
    csConversations,
    csConversationId: active?.id || "",
    csConsultType: consultKey,
    csOrderId: active?.orderId || "",
    csOrderNo: active?.orderNo || "",
    csStatus: active?.status || "",
    csStatusLabel: active?.statusLabel || "",
    csEnded: !!(active && active.ended),
    csTransferring: transferring || !!(active && /更换客服/.test(String(active.subtitle || ""))),
    messages: includeActiveMessages ? activeMessages.map(viewMessage) : [],
    systemNotices,
    unreadTotal: csUnreadTotal + systemUnread,
    unreadMessages: csUnreadTotal + systemUnread,
    light: !!bootstrapSlice.light,
  };
}
