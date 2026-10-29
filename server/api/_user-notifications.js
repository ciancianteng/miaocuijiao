/**
 * Server unread inbox for the PWA badge.
 * Badge number is always COUNT of unread rows, never a client increment.
 * Same (user_id, event_key) cannot insert twice.
 */
import fs from "node:fs";
import path from "node:path";

loadLocalEnv();

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

const TABLE = "user_notifications";

export function eventKeyChat(messageId) {
  const id = String(messageId || "").trim();
  return id ? `chat:${id}` : "";
}

export function eventKeyOrder(orderId, action) {
  const id = String(orderId || "").trim();
  const act = String(action || "updated").trim().toLowerCase();
  return id ? `order:${id}:${act}` : "";
}

export function chatRecipientIds(conversation, senderId) {
  const sender = String(senderId || "").trim();
  const ids = [
    conversation && conversation.boss_id,
    conversation && conversation.companion_id,
    conversation && conversation.customer_service_id,
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .filter((id) => id !== sender);
  return [...new Set(ids)];
}

export function badgeAction(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return "clear";
  return "set";
}

export function categoryOf(type) {
  const value = String(type || "").toLowerCase();
  if (value === "cs_consult" || value === "consult") return "consult";
  if (value === "recharge_proof" || value === "recharge_review" || value === "recharge") return "recharge";
  if (value === "gift_proof" || value === "gift_review" || value === "gift") return "gift";
  if (value === "chat_message" || value.startsWith("chat")) return "chat";
  if (/order|payment|refund|withdrawal|transfer/.test(value)) return "order";
  return "system";
}

export function dedupeRecords(records) {
  const seen = new Set();
  const kept = [];
  for (const row of records || []) {
    const key = `${row.userId || row.user_id}|${row.eventKey || row.event_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

export function remainingUnread(items, { conversationId = "", readIds = [], all = false } = {}) {
  return (items || []).filter((item) => {
    if (item.is_read || item.isRead) return false;
    if (all) return false;
    if (readIds.includes(String(item.id || ""))) return false;
    if (conversationId && String(item.entity_id || item.entityId || "") === String(conversationId) && String(item.entity_type || item.entityType || "") === "conversation") {
      return false;
    }
    return true;
  }).length;
}

export function retireRemovedCompanions(items, removedUserIds, orderId) {
  const removed = new Set((removedUserIds || []).map((id) => String(id || "")).filter(Boolean));
  const order = String(orderId || "");
  return (items || []).map((item) => {
    const mine = removed.has(String(item.user_id || item.userId || ""));
    const sameOrder = String(item.entity_id || item.entityId || "") === order && String(item.entity_type || item.entityType || "") === "order";
    if (mine && sameOrder && !(item.is_read || item.isRead)) {
      return { ...item, is_read: true, isRead: true };
    }
    return item;
  });
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (key && !key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${TABLE}${query}`;
}

function missingTable(message) {
  return /does not exist|schema cache|PGRST205|Could not find the table/i.test(String(message || ""));
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function countUnread(userId) {
  const total = await countUnreadForPush(userId);
  return total == null ? 0 : total;
}

/** Null when the count request failed, so a push must not clear the icon by mistake. */
/** Only this user's unread rows. Null is_read still counts as unread. */
export function userUnreadFilter(userId) {
  return `user_id=eq.${encodeURIComponent(String(userId || "").trim())}&or=(is_read.is.false,is_read.is.null)`;
}

export async function countUnreadForPush(userId) {
  const id = String(userId || "").trim();
  if (!id || !envValue("SUPABASE_URL")) return null;
  try {
    const response = await fetch(restUrl(`?${userUnreadFilter(id)}&select=id`), {
      headers: { ...serviceHeaders(), Prefer: "count=exact", Range: "0-0" },
    });
    if (!response.ok && response.status !== 416) return null;
    const range = response.headers.get("content-range") || "";
    const total = Number(String(range).split("/")[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

export async function recordUserNotification(input) {
  const userId = String(input?.userId || "").trim();
  const eventKey = String(input?.eventKey || "").trim();
  if (!userId || !eventKey) return { ok: false, created: false, code: "MISSING" };
  const type = String(input.type || "system").slice(0, 64);
  const row = {
    user_id: userId,
    event_key: eventKey.slice(0, 240),
    type,
    category: String(input.category || categoryOf(type)).slice(0, 32),
    entity_type: String(input.entityType || "").slice(0, 64),
    entity_id: String(input.entityId || "").slice(0, 120),
    title: String(input.title || "妙脆角").slice(0, 80),
    body: String(input.body || "").slice(0, 180),
    url: String(input.url || "/").slice(0, 500),
    is_read: false,
  };
  const response = await fetch(restUrl("?on_conflict=user_id,event_key"), {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message = body?.message || body?.hint || "";
    if (response.status === 409 || /duplicate|23505/i.test(String(message))) {
      return { ok: true, created: false, duplicate: true, unreadCount: await countUnread(userId) };
    }
    if (missingTable(message)) return { ok: false, created: false, code: "TABLE_MISSING" };
    return { ok: false, created: false, code: "WRITE_FAILED" };
  }
  const created = Array.isArray(body) ? body.length > 0 : !!body?.id;
  return { ok: true, created, duplicate: !created, unreadCount: await countUnread(userId) };
}

function patchError(body, status) {
  const message = String(body?.message || body?.hint || body?.details || body || "").trim();
  const err = new Error(message ? `已读状态写入失败：${message.slice(0, 180)}` : "已读状态写入失败");
  err.status = status || 500;
  return err;
}

async function patchUnread(filter, userId) {
  const stamp = { is_read: true, read_at: new Date().toISOString() };
  let response = await fetch(restUrl(filter), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(stamp),
  });
  if (!response.ok) {
    const body = await readJson(response);
    const message = String(body?.message || body || "");
    if (missingTable(message)) throw patchError(body, response.status);
    if (/read_at|column|schema cache|PGRST204/i.test(message)) {
      response = await fetch(restUrl(filter), {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ is_read: true }),
      });
      if (!response.ok) throw patchError(await readJson(response), response.status);
    } else {
      throw patchError(body, response.status);
    }
  }
  const unreadCount = await countUnreadForPush(userId);
  if (unreadCount == null) {
    const err = new Error("已读已写入，但未读数量读取失败");
    err.status = 503;
    throw err;
  }
  return unreadCount;
}

export function markConversationRead(userId, conversationId) {
  const id = String(conversationId || "").trim();
  if (!id) return countUnreadForPush(userId).then((n) => (n == null ? Promise.reject(Object.assign(new Error("未读数量读取失败"), { status: 503 })) : n));
  return patchUnread(
    `?${userUnreadFilter(userId)}&entity_type=eq.conversation&entity_id=eq.${encodeURIComponent(id)}`,
    userId,
  );
}

export function markNotificationRead(userId, notificationId) {
  return patchUnread(
    `?id=eq.${encodeURIComponent(notificationId)}&${userUnreadFilter(userId)}`,
    userId,
  );
}

export function markAllRead(userId) {
  return patchUnread(`?${userUnreadFilter(userId)}`, userId);
}

export function clearOrderUnread(userId, orderId) {
  return patchUnread(
    `?${userUnreadFilter(userId)}&entity_type=eq.order&entity_id=eq.${encodeURIComponent(orderId)}`,
    userId,
  );
}

function cnStamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function displayName(userId, fallback) {
  const id = String(userId || "").trim();
  if (!id || !envValue("SUPABASE_URL")) return fallback;
  try {
    const response = await fetch(
      `${envValue("SUPABASE_URL")}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=display_name,nickname&limit=1`,
      { headers: serviceHeaders() },
    );
    const rows = await readJson(response);
    const row = Array.isArray(rows) ? rows[0] : null;
    return String(row?.nickname || row?.display_name || "").trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Persist one work alert for every active agent. Reading it does not complete the task. */
export async function fanoutCsWorkNotice({
  kind,
  relatedId,
  eventKey,
  title,
  body,
  href,
  category,
  entityType,
}) {
  const rid = String(relatedId || "").trim();
  const key = String(eventKey || "").trim();
  if (!rid || !key) return { staff: 0 };
  const { listActiveCustomerServiceIds, notifyCustomerServiceStaff } = await import("./_staff-notify.js");
  const staffIds = await listActiveCustomerServiceIds();
  await notifyCustomerServiceStaff({
    kind,
    relatedId: rid,
    title,
    body,
    href,
    staffIds,
  }).catch(() => null);
  for (const staffId of staffIds) {
    await recordUserNotification({
      userId: staffId,
      eventKey: key,
      type: kind,
      category: category || categoryOf(kind),
      entityType: entityType || category || kind,
      entityId: rid,
      title,
      body,
      url: href,
    }).catch(() => null);
  }
  return { staff: staffIds.length };
}

/** Clear the alert after the task is actually finished. Does not change the task row. */
export async function retireWorkNotices(entityType, entityId) {
  const type = String(entityType || "").trim();
  const id = String(entityId || "").trim();
  if (!type || !id || !envValue("SUPABASE_URL")) return 0;
  try {
    const response = await fetch(
      restUrl(`?entity_type=eq.${encodeURIComponent(type)}&entity_id=eq.${encodeURIComponent(id)}&is_read=eq.false`),
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() }),
      },
    );
    return response.ok ? 1 : 0;
  } catch {
    return 0;
  }
}

async function patchUnreadConsult(userId, eventKey, title, body) {
  const response = await fetch(
    restUrl(`?user_id=eq.${encodeURIComponent(userId)}&event_key=eq.${encodeURIComponent(eventKey)}`),
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ title, body, is_read: false, read_at: null }),
    },
  );
  return response.ok;
}

/** One inbox row per waiting conversation. Later messages update that row instead of inserting another. */
export async function notifyWaitingConsult(conversation, options = {}) {
  const id = String(conversation?.id || "").trim();
  const assigned = String(conversation?.customer_service_id || "").trim();
  const status = String(conversation?.status || conversation?.rawStatus || "");
  if (!id || assigned) return { ok: true, skipped: "assigned" };
  if (status === "closed" || status === "ended") return { ok: true, skipped: "closed" };
  const bossId = conversation?.boss_id || conversation?.bossId || options.bossId || "";
  const bossName = String(options.bossName || "").trim() || (await displayName(bossId, "老板"));
  const preview = String(options.preview || "老板发起客服咨询").replace(/\s+/g, " ").trim().slice(0, 80) || "老板发起客服咨询";
  const stamp = cnStamp(options.createdAt);
  const title = "新老板咨询待接待";
  const body = `${bossName}：${preview}${stamp ? ` · ${stamp}` : ""} · 待接待`;
  const href = `/customer-service/conversations/?id=${encodeURIComponent(id)}`;
  const eventKey = `consult:${id}`;
  const { listActiveCustomerServiceIds, notifyCustomerServiceStaff } = await import("./_staff-notify.js");
  const staffIds = (await listActiveCustomerServiceIds()).filter((staffId) => staffId);
  await notifyCustomerServiceStaff({
    kind: "cs_consult",
    relatedId: id,
    title,
    body,
    href,
    staffIds,
    skipPush: options.skipPush === true,
  }).catch(() => null);
  for (const staffId of staffIds) {
    const saved = await recordUserNotification({
      userId: staffId,
      eventKey,
      type: "cs_consult",
      category: "consult",
      entityType: "cs_consult",
      entityId: id,
      title,
      body,
      url: href,
    }).catch(() => null);
    if (options.refreshPreview && saved?.duplicate) {
      await patchUnreadConsult(staffId, eventKey, title, body).catch(() => null);
    }
  }
  return { ok: true, staff: staffIds.length };
}

/** Fill notices for waiting threads that were opened before the inbox write existed. Same event key cannot insert twice. */
export async function ensureWaitingConsultNotices(conversations) {
  const waiting = (Array.isArray(conversations) ? conversations : [])
    .filter((row) => row && row.id && !row.currentServiceId && row.rawStatus !== "closed" && row.conversationType !== "companion_support")
    .slice(0, 20);
  for (const row of waiting) {
    await notifyWaitingConsult(
      { id: row.id, boss_id: row.bossId, customer_service_id: "", status: row.rawStatus },
      { preview: row.lastMessage || "老板发起客服咨询", createdAt: row.lastTime || row.createdAt },
    ).catch(() => null);
  }
  return waiting.length;
}

export function chatUrlFor(conversation, userId) {
  const cid = encodeURIComponent(String(conversation?.id || ""));
  if (String(conversation?.boss_id || "") === String(userId)) return `/support.html?conversation=${cid}`;
  if (String(conversation?.companion_id || "") === String(userId)) return `/companion/?conversation=${cid}`;
  return `/customer-service/conversations/?id=${cid}`;
}

export async function notifyChatParticipants(conversation, message, senderId) {
  if (!message?.id || String(message.message_type || message.messageType || "") === "system") {
    return { ok: true, skipped: "system_or_missing" };
  }
  const assigned = String(conversation?.customer_service_id || "").trim();
  const sender = String(senderId || "").trim();
  let recipients = chatRecipientIds(conversation, senderId);
  let waitingStaff = [];
  if (!assigned) {
    try {
      const { listActiveCustomerServiceIds } = await import("./_staff-notify.js");
      const staffIds = await listActiveCustomerServiceIds();
      waitingStaff = staffIds.filter((id) => id && id !== sender);
      recipients = [...new Set([...recipients, ...waitingStaff])];
    } catch {
      /* staff inbox is best-effort; user notifications below still fan out */
    }
  }
  const waiting = !assigned && waitingStaff.length > 0;
  const rawText = String(message.content || "").replace(/\s+/g, " ").trim();
  const image = String(message.message_type || message.messageType || "") === "image";
  const preview = image ? "发来一张图片" : rawText.slice(0, 80);
  const title = "新消息";
  const bodyText = preview || "你收到一条新消息";
  if (waiting) {
    await notifyWaitingConsult(
      { ...conversation, boss_id: conversation?.boss_id || conversation?.bossId || sender },
      {
        preview: preview || "发来一条新咨询",
        createdAt: message.created_at || message.createdAt,
        refreshPreview: true,
        bossName: message.senderName || message.sender_name || "",
        skipPush: true,
      },
    ).catch(() => null);
  }
  for (const userId of recipients) {
    if (waiting && waitingStaff.includes(userId)) continue;
    await recordUserNotification({
      userId,
      eventKey: eventKeyChat(message.id),
      type: "chat_message",
      category: "chat",
      entityType: "conversation",
      entityId: conversation?.id || "",
      title,
      body: bodyText,
      url: chatUrlFor(conversation, userId),
    }).catch(() => null);
  }
  try {
    const { sendWebPushToUser } = await import("./_web-push.js");
    for (const userId of recipients) {
      const consultHref = `/customer-service/conversations/?id=${encodeURIComponent(String(conversation?.id || ""))}`;
      const url = waiting && waitingStaff.includes(userId) ? consultHref : chatUrlFor(conversation, userId);
      await sendWebPushToUser(userId, {
        title,
        body: bodyText,
        url,
        notificationType: "chat_message",
        eventType: "chat_message",
        entityId: String(conversation?.id || ""),
        tag: `chat-${conversation?.id || message.id}`,
        targetUserId: userId,
      }).catch(() => null);
    }
  } catch {
    /* push is optional; the inbox row is the badge source */
  }
  return { ok: true, recipients: recipients.length, waiting };
}

export async function recordOrderEvent({ userId, orderId, action, title, body, url }) {
  return recordUserNotification({
    userId,
    eventKey: eventKeyOrder(orderId, action),
    type: `order_${String(action || "updated").toLowerCase()}`,
    entityType: "order",
    entityId: orderId,
    title,
    body,
    url,
  });
}

function anonHeaders(extra = {}) {
  return {
    apikey: envValue("SUPABASE_ANON_KEY") || envValue("VITE_SUPABASE_ANON_KEY"),
    "Content-Type": "application/json",
    ...extra,
  };
}

async function userFromRequest(req) {
  const token = String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    const err = new Error("请先登录。");
    err.status = 401;
    throw err;
  }
  const response = await fetch(`${envValue("SUPABASE_URL")}/auth/v1/user`, {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const authUser = await readJson(response);
  if (!response.ok || !authUser?.id) {
    const err = new Error("登录已过期，请重新登录。");
    err.status = 401;
    throw err;
  }
  const rowsResponse = await fetch(
    `${envValue("SUPABASE_URL")}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,status&limit=1`,
    { headers: serviceHeaders() },
  );
  const rows = await readJson(rowsResponse);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile?.id) {
    const err = new Error("账号未绑定平台资料。");
    err.status = 403;
    throw err;
  }
  if (profile.status && profile.status !== "active") {
    const err = new Error("账号未启用。");
    err.status = 403;
    throw err;
  }
  return profile;
}

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(data);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export async function listNotifications(userId, category) {
  const filter = category && category !== "all" ? `&category=eq.${encodeURIComponent(category)}` : "";
  const response = await fetch(
    restUrl(`?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50${filter}&select=id,type,category,entity_type,entity_id,title,body,url,is_read,created_at,read_at`),
    { headers: serviceHeaders() },
  );
  const body = await readJson(response);
  if (!response.ok) {
    if (missingTable(body?.message || "")) return [];
    return [];
  }
  return (Array.isArray(body) ? body : []).map((row) => ({
    id: row.id,
    type: row.type,
    category: row.category,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    url: row.url,
    isRead: !!row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

export async function handleUserNotificationRequest(req, res, action, body) {
  try {
    const profile = await userFromRequest(req);
    const userId = profile.id;
    if (action === "unread_count" || action === "unread-count") {
      const unreadCount = await countUnreadForPush(userId);
      if (unreadCount == null) return send(res, 503, { ok: false, message: "未读数量读取失败" });
      return send(res, 200, { ok: true, unread_count: unreadCount, unreadCount });
    }
    if (action === "inbox" || action === "list_badge") {
      const category = String((req.query && req.query.category) || body.category || "all");
      const items = await listNotifications(userId, category);
      const unreadCount = await countUnreadForPush(userId);
      if (unreadCount == null) return send(res, 503, { ok: false, message: "未读数量读取失败" });
      return send(res, 200, { ok: true, items, unread_count: unreadCount, unreadCount });
    }
    if (action === "badge_read" || action === "read_one") {
      const id = String(body.id || body.notification_id || "").trim();
      if (!id) return send(res, 400, { ok: false, message: "缺少通知 ID。" });
      const unreadCount = await markNotificationRead(userId, id);
      return send(res, 200, { ok: true, unread_count: unreadCount, unreadCount });
    }
    if (action === "badge_read_all" || action === "read_all_badge") {
      const unreadCount = await markAllRead(userId);
      return send(res, 200, { ok: true, unread_count: unreadCount, unreadCount });
    }
    if (action === "badge_read_conversation") {
      const conversationId = String(body.conversationId || body.conversation_id || body.id || "").trim();
      const unreadCount = await markConversationRead(userId, conversationId);
      return send(res, 200, { ok: true, unread_count: unreadCount, unreadCount });
    }
    return send(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return send(res, error.status || 500, { ok: false, message: error.message || "通知暂时无法加载" });
  }
}
