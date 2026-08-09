import fs from "node:fs";
import path from "node:path";
import { assertBossProfile, identityView } from "./_boss-identity.js";
import {
  decorateChatMessage,
  decorateChatMessageSigned,
  messagePreviewText,
  normalizeImageUrl,
  persistImageMessage,
} from "./_chat-message.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

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
function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}
function hasDb() { return REQUIRED_ENV.every((key) => envValue(key)); }
function json(res, status, data) { res.status(status).json(data); }
function anonHeaders(extra = {}) { return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", Prefer: "return=representation", "User-Agent": "MCJ-Server/1.0", ...extra };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}
function authUrl(route) { return `${envValue("SUPABASE_URL")}/auth/v1/${route}`; }
function restUrl(table, query = "") { return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`; }
function nowIso() { return new Date().toISOString(); }
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(body?.error_description || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `${response.status} ${response.statusText}`);
  }
  return body;
}
function tokenFrom(req) { return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim(); }
async function allocateBossUid() {
  const rows = await supabaseJson(
    restUrl("profiles", "?role=eq.boss&select=boss_uid&boss_uid=not.is.null&order=created_at.desc&limit=200"),
    { headers: serviceHeaders() }
  ).catch(() => []);
  let next = 100001;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row?.boss_uid || "").trim().match(/^B(\d+)$/i);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `B${next + attempt}`;
    const existing = await supabaseJson(
      restUrl("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    if (!Array.isArray(existing) || existing.length === 0) return candidate;
  }
  return `B${Date.now().toString().slice(-9)}`;
}

async function ensureBossUid(profile) {
  if (!profile?.id) return profile;
  if (profile.boss_uid && String(profile.boss_uid).trim()) return profile;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bossUid = await allocateBossUid();
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ boss_uid: bossUid }),
      });
      const saved = Array.isArray(rows) ? rows[0] : { ...profile, boss_uid: bossUid };
      if (saved?.boss_uid) return saved;
    } catch (_) {}
  }
  return profile;
}

function isAuthTokenFailure(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("403 forbidden") ||
    text.includes("jwt") ||
    text.includes("expired") ||
    text.includes("invalid claim") ||
    text.includes("unable to parse") ||
    text.includes("invalid token") ||
    text.includes("not authenticated")
  );
}

async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录后使用在线客服。"), { status: 401, code: "NO_SESSION" });
  let authUser;
  try {
    authUser = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (isAuthTokenFailure(message)) {
      throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401, code: "EXPIRED" });
    }
    throw Object.assign(new Error(message || "登录校验失败。"), { status: 401, code: "AUTH_FAILED" });
  }
  if (!authUser?.id) throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401, code: "EXPIRED" });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号资料加载失败，请重试。"), { status: 403, code: "NO_PROFILE" });

  const boss = await assertBossProfile(profile, {
    lookupOwnedOrder: async (bossId) => {
      const owned = await supabaseJson(
        restUrl("orders", `?boss_id=eq.${encodeURIComponent(bossId)}&select=id&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      return !!(Array.isArray(owned) && owned[0]);
    },
  });
  boss._authUser = authUser;
  boss._identity = identityView(boss, authUser);
  return boss;
}
async function getOrCreateConversation(profile, orderId = "", meta = {}) {
  const conversationType = orderId ? "order_support" : "general_support";
  const forceNew = !!(meta && (meta.forceNew || meta.force_new || meta.reopen));
  if (orderId) {
    const probe = await supabaseJson(
      restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&select=id,boss_id&limit=1`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    const hit = Array.isArray(probe) ? probe[0] : null;
    if (!hit) throw Object.assign(new Error("订单不存在。"), { status: 404, code: "ORDER_NOT_FOUND" });
    if (String(hit.boss_id || "") !== String(profile.id || "")) {
      throw Object.assign(new Error("无权限查看该订单。"), { status: 403, code: "FORBIDDEN_ORDER" });
    }
  }

  // Prefer an active (non-closed) thread. Closed threads stay read-only history.
  if (!forceNew) {
    const activeQuery = orderId
      ? `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=eq.${encodeURIComponent(orderId)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
      : `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=is.null&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`;
    const active = await supabaseJson(restUrl("conversations", activeQuery), { headers: serviceHeaders() }).catch(() => []);
    if (active?.[0]) {
      let conversation = active[0];
      // Do NOT stamp companion_id onto boss↔CS rooms — that leaked chats into companion inbox.
      if (orderId && conversation.companion_id) {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ companion_id: null, updated_at: nowIso() }),
        }).catch(() => null);
        conversation = { ...conversation, companion_id: null };
      }
      return { conversation, created: false, order: null };
    }
  }

  // One order → one conversation: reopen the latest closed order thread instead of creating another.
  if (orderId) {
    const closedRows = await supabaseJson(
      restUrl(
        "conversations",
        `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=eq.${encodeURIComponent(orderId)}&order=updated_at.desc&limit=1`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    const existing = Array.isArray(closedRows) ? closedRows[0] : null;
    if (existing?.id) {
      const reopenPatch = {
        status: "waiting_service",
        customer_service_id: null,
        companion_id: null,
        closed_at: null,
        closed_by: null,
        updated_at: nowIso(),
      };
      const orders = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&select=id,order_no&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      const updated = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(reopenPatch),
      }).catch(() => null);
      const conversation = (Array.isArray(updated) ? updated[0] : updated) || { ...existing, ...reopenPatch };
      await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          conversation_id: conversation.id,
          sender_id: profile.id,
          sender_role: "system",
          message_type: "system",
          content: forceNew
            ? `老板重新发起订单咨询（订单 ${orders?.[0]?.order_no || orderId}）。`
            : `老板继续订单咨询（订单 ${orders?.[0]?.order_no || orderId}）。`,
          order_id: orderId,
          created_at: nowIso(),
        }),
      }).catch(() => null);
      return { conversation, created: false, order: orders?.[0] || null, reopened: true };
    }
  }

  let order = null;
  if (orderId) {
    const orders = await supabaseJson(
      restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&limit=1`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    order = orders?.[0] || null;
  }

  // conversations schema: boss_id / companion_id / customer_service_id / order_id / status / conversation_type
  // Do NOT send customer_id — column does not exist and causes PostgREST 400 on create/reopen.
  if (!profile?.id) {
    throw Object.assign(new Error("账号身份无效，无法创建客服会话。请重新登录后再试。"), { status: 401 });
  }
  const payload = {
    boss_id: profile.id,
    order_id: orderId || null,
    companion_id: null,
    conversation_type: conversationType,
    status: "waiting_service",
    customer_service_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  let rows;
  try {
    rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = String(err?.message || err || "");
    // Fallback if conversation_type column missing in an older DB.
    if (/conversation_type/i.test(msg)) {
      const legacy = { ...payload };
      delete legacy.conversation_type;
      rows = await supabaseJson(restUrl("conversations"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(legacy),
      });
    } else {
      throw Object.assign(
        new Error(
          /customer_id|column/i.test(msg)
            ? "创建客服会话失败：数据字段不匹配，请稍后重试或联系管理员。"
            : msg || "创建客服会话失败，请稍后重试。"
        ),
        { status: err?.status || 500 }
      );
    }
  }
  const conversation = rows?.[0];
  if (conversation?.id) {
    const tip = order
      ? forceNew
        ? `老板重新发起订单咨询，已关联订单 ${order.order_no || order.id}。`
        : `老板发起客服咨询，已自动关联订单 ${order.order_no || order.id}。`
      : forceNew
        ? "老板重新发起人工客服咨询。"
        : "老板发起客服咨询。";
    await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conversation.id,
        sender_id: profile.id,
        sender_role: "boss",
        message_type: "system",
        content: tip,
        order_id: orderId || null,
        read_at: null,
        created_at: nowIso(),
      }),
    }).catch(() => null);
  }
  return { conversation, created: true, order };
}

async function conversationByIdForBoss(profile, conversationId) {
  if (!conversationId) return null;
  const rows = await supabaseJson(
    restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}&limit=1`),
    { headers: serviceHeaders() }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (String(row.boss_id || "") !== String(profile.id || "")) {
    throw Object.assign(new Error("无权限查看该会话。"), { status: 403, code: "FORBIDDEN_CONVERSATION" });
  }
  const { assertBossCanAccessConversation } = await import("./_conversation-privacy.js");
  assertBossCanAccessConversation(row, profile.id);
  return row;
}

async function servicePresence() {
  try {
    const rows = await supabaseJson(
      restUrl("profiles", `?role=eq.customer_service&status=eq.active&select=id&limit=50`),
      { headers: serviceHeaders() }
    );
    const staffCount = Array.isArray(rows) ? rows.length : 0;
    if (!staffCount) return { online: false, staffCount: 0 };
    // Soft presence: any CS message in the last 30 minutes counts as "online".
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recent = await supabaseJson(
      restUrl(
        "messages",
        `?sender_role=eq.customer_service&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    return { online: Array.isArray(recent) && recent.length > 0, staffCount };
  } catch {
    return { online: false, staffCount: 0 };
  }
}

function staffDisplayName(profile) {
  const name = String(profile?.display_name || "").trim();
  return name || "客服";
}

function serviceStatusText(conversation, presence, serviceName) {
  if (conversation?.customer_service_id) {
    return `客服 ${serviceName || "在线客服"} 正在为您服务`;
  }
  if (conversation?.status === "closed" || conversation?.status === "ended") return "会话已结束";
  if (presence?.online) return "等待客服接待";
  return "客服暂时离线";
}

async function loadServiceAgent(conversation) {
  const id = conversation?.customer_service_id;
  if (!id) return null;
  try {
    const rows = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&limit=1`),
      { headers: serviceHeaders() }
    );
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile) return null;
    return { id: profile.id, name: staffDisplayName(profile) };
  } catch {
    return null;
  }
}

async function loadMessages(conversationId) {
  if (!conversationId) return [];
  const rows = await supabaseJson(
    restUrl("messages", `?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=200`),
    { headers: serviceHeaders() }
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const senderIds = [...new Set(list.map((row) => row.sender_id).filter(Boolean))];
  let profileMap = {};
  if (senderIds.length) {
    const profiles = await supabaseJson(
      restUrl("profiles", `?id=in.(${senderIds.map(encodeURIComponent).join(",")})&select=id,display_name,role`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }
  return Promise.all(
    list.map(async (row) => {
      const sender = profileMap[row.sender_id] || {};
      let senderName = "";
      if (row.sender_role === "customer_service") senderName = staffDisplayName(sender);
      else if (row.sender_role === "boss") senderName = String(sender.display_name || "").trim() || "老板";
      else if (row.sender_role === "companion") senderName = String(sender.display_name || "").trim() || "陪玩";
      return decorateChatMessageSigned(row, { senderName });
    })
  );
}

async function decorateConversationPayload(conversation, presence) {
  const agent = await loadServiceAgent(conversation);
  const serviceName = agent?.name || "";
  return {
    conversation: conversation
      ? Object.assign({}, conversation, {
          customerId: conversation.customer_id || conversation.boss_id || "",
          customerServiceId: conversation.customer_service_id || "",
          assignedCustomerServiceId: conversation.customer_service_id || "",
          conversationType: conversation.conversation_type || (conversation.order_id ? "order_support" : "general_support"),
          customerServiceName: serviceName,
          serviceName,
        })
      : null,
    serviceOnline: !!presence?.online || !!conversation?.customer_service_id,
    serviceStatus: serviceStatusText(conversation, presence, serviceName),
    serviceName,
  };
}

async function loadProduct(productId) {
  try {
    const rows = await supabaseJson(restUrl("gameplay_products", `?id=eq.${encodeURIComponent(productId)}&limit=1`), { headers: serviceHeaders() });
    if (rows?.[0]) return rows[0];
  } catch {}
  try {
    const { readLocalProducts } = await import("./_gameplay-products-store.js");
    const list = await readLocalProducts();
    return list.find((item) => String(item.id) === String(productId)) || null;
  } catch {
    return null;
  }
}

async function listConversations(profile) {
  const rows = await supabaseJson(
    restUrl("conversations", `?boss_id=eq.${encodeURIComponent(profile.id)}&order=updated_at.desc&limit=100`),
    { headers: serviceHeaders() }
  );
  const { isBossCsConversation } = await import("./_conversation-privacy.js");
  const conversations = (Array.isArray(rows) ? rows : []).filter((row) => isBossCsConversation(row));
  if (!conversations.length) return [];

  const orderIds = [...new Set(conversations.map((c) => c.order_id).filter(Boolean))];
  const conversationIds = conversations.map((c) => c.id).filter(Boolean);

  // Batch last-message + orders + unread CS messages (avoid N+1 so /api/chat?action=conversations finishes in <3s).
  const [orders, messagesDesc, unreadRows] = await Promise.all([
    orderIds.length
      ? supabaseJson(
          restUrl(
            "orders",
            `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&select=id,order_no,game,title,status`
          ),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    conversationIds.length
      ? supabaseJson(
          restUrl(
            "messages",
            `?conversation_id=in.(${conversationIds.map(encodeURIComponent).join(",")})&select=conversation_id,content,created_at,sender_role,message_type&order=created_at.desc&limit=400`
          ),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    conversationIds.length
      ? supabaseJson(
          restUrl(
            // mcj_user_role is only boss|companion|customer_service|admin — never include service/system here.
            "messages",
            `?conversation_id=in.(${conversationIds.map(encodeURIComponent).join(",")})&sender_role=in.(customer_service,admin)&read_at=is.null&select=id,conversation_id&limit=2000`
          ),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const orderMap = Object.fromEntries((Array.isArray(orders) ? orders : []).map((o) => [o.id, o]));
  const lastByConv = {};
  for (const msg of Array.isArray(messagesDesc) ? messagesDesc : []) {
    const cid = msg?.conversation_id;
    if (cid && !lastByConv[cid]) lastByConv[cid] = msg;
  }
  const unreadByConv = {};
  for (const row of Array.isArray(unreadRows) ? unreadRows : []) {
    const cid = row?.conversation_id;
    if (!cid) continue;
    unreadByConv[cid] = (unreadByConv[cid] || 0) + 1;
  }

  const mapped = conversations.map((row) => {
    const last = lastByConv[row.id] || null;
    const order = row.order_id ? orderMap[row.order_id] : null;
    return {
      id: row.id,
      conversationId: row.id,
      orderId: row.order_id || "",
      orderNo: order?.order_no || "",
      companionId: row.companion_id || order?.companion_id || "",
      companionName: "",
      game: order?.game || "",
      title: order ? `订单 ${order.order_no || order.id}` : "人工客服咨询",
      conversationType: row.conversation_type || (row.order_id ? "order_support" : "general_support"),
      status: row.status || "",
      customerServiceId: row.customer_service_id || "",
      assignedCustomerServiceId: row.customer_service_id || "",
      updatedAt: row.updated_at || row.created_at || "",
      lastMessage: messagePreviewText(last || { content: "" }),
      lastMessageAt: last?.created_at || row.updated_at || "",
      lastSenderRole: last?.sender_role || "",
      unreadCount: Number(unreadByConv[row.id] || 0),
      unread: Number(unreadByConv[row.id] || 0),
    };
  });

  // One order → one chat thread in the boss list (keep newest / open).
  return dedupeBossConversationsByOrder(mapped);
}

function dedupeBossConversationsByOrder(list = []) {
  const byKey = new Map();
  for (const item of list) {
    const orderId = String(item?.orderId || "").trim();
    const key = orderId ? `order:${orderId}` : `id:${item.id}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const prevClosed = /^(closed|ended)$/i.test(String(prev.status || ""));
    const curClosed = /^(closed|ended)$/i.test(String(item.status || ""));
    let keep = item;
    let drop = prev;
    if (prevClosed && !curClosed) {
      keep = item;
      drop = prev;
    } else if (!prevClosed && curClosed) {
      keep = prev;
      drop = item;
    } else {
      const prevT = Date.parse(prev.lastMessageAt || prev.updatedAt || "") || 0;
      const curT = Date.parse(item.lastMessageAt || item.updatedAt || "") || 0;
      if (curT >= prevT) {
        keep = item;
        drop = prev;
      } else {
        keep = prev;
        drop = item;
      }
    }
    keep.unreadCount = Number(keep.unreadCount || 0) + Number(drop.unreadCount || 0);
    keep.unread = keep.unreadCount;
    byKey.set(key, keep);
  }
  return [...byKey.values()].sort((a, b) =>
    String(b.lastMessageAt || b.updatedAt || "").localeCompare(String(a.lastMessageAt || a.updatedAt || ""))
  );
}

const BOSS_UNREAD_PEER_ROLES = ["customer_service", "admin"];

async function countBossUnreadFromCs(conversationId) {
  if (!conversationId) return 0;
  const rows = await supabaseJson(
    restUrl(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=in.(${BOSS_UNREAD_PEER_ROLES.join(
        ","
      )})&read_at=is.null&select=id&limit=1000`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function markBossReadCsMessages(conversationId) {
  const readAt = nowIso();
  if (!conversationId) return { readAt, unread: 0 };
  const unreadFilter = `?conversation_id=eq.${encodeURIComponent(
    conversationId
  )}&sender_role=in.(${BOSS_UNREAD_PEER_ROLES.join(",")})&read_at=is.null`;
  try {
    await supabaseJson(restUrl("messages", unreadFilter), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ read_at: readAt }),
    });
  } catch (_) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=in.(customer_service,admin)&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
  }
  // Persist conversation read cursor (mirrors CS mark_read). unread_count column is optional.
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ last_read_at: readAt, unread_count: 0, updated_at: readAt }),
    });
  } catch (err) {
    const detail = String(err?.message || err || "");
    if (/unread_count/i.test(detail)) {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ last_read_at: readAt, updated_at: readAt }),
        });
      } catch (_) {}
    }
  }
  // Retry once if rows still unread (race with concurrent CS insert).
  let remaining = await countBossUnreadFromCs(conversationId);
  if (remaining > 0) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=in.(customer_service,admin)&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
    remaining = await countBossUnreadFromCs(conversationId);
  }
  return { readAt, unread: remaining };
}

async function resolveConversation(profile, { conversationId = "", orderId = "", create = true, forceNew = false } = {}) {
  if (conversationId && !forceNew) {
    const existing = await conversationByIdForBoss(profile, conversationId);
    if (!existing) throw Object.assign(new Error("会话不存在或不属于当前账号。"), { status: 404 });
    return { conversation: existing, created: false };
  }
  if (!create && !orderId && !forceNew) {
    return { conversation: null, created: false };
  }
  return getOrCreateConversation(profile, orderId || "", { forceNew: !!forceNew });
}

function productCardContent(product, boss) {
  const item = product || {};
  return JSON.stringify({
    kind: "gameplay_product",
    productId: item.id || item.productId || "",
    name: item.name || "",
    coverUrl: item.cover_url || item.coverUrl || "",
    price: Number(item.price || 0),
    pricingUnit: item.pricing_unit || item.pricingUnit || "每单",
    fixedPrice: item.fixed_price !== false && item.fixedPrice !== false,
    category: item.category || "",
    gamesText: item.games_text || item.gamesText || "",
    bossId: boss?.id || "",
    bossUid: boss?.boss_uid || "",
    bossName: boss?.display_name || boss?.email || "",
  });
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, configured: false, message: "未配置 Supabase，在线客服不能保存真实聊天。" });
  try {
    const profile = await profileFromToken(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(req.method === "GET" ? req.query.action || "list" : body.action || "send").trim();
    if (/update_order|set_order_status|change_order_status|patch_order|order_status/i.test(action)) {
      return json(res, 403, { ok: false, message: "聊天室不能修改订单状态，请走订单/客服流程。" });
    }
    if (body && (body.order_status || body.orderStatus || body.new_status || body.newStatus) && /order/i.test(action)) {
      return json(res, 403, { ok: false, message: "聊天室禁止前端直接篡改订单状态。" });
    }

    if (req.method === "POST" && action === "consult_gameplay") {
      const productId = String(body.productId || body.product_id || body.id || "").trim();
      if (!productId) return json(res, 400, { ok: false, message: "缺少商品 ID。" });
      const product = await loadProduct(productId);
      if (!product) return json(res, 404, { ok: false, message: "商品不存在或已下架。" });
      const status = String(product.status || "published");
      if (status !== "published" || product.deleted_at || product.deletedAt) {
        return json(res, 404, { ok: false, message: "商品已下架。" });
      }
      const created = await getOrCreateConversation(profile, "", { topic: "更多玩法咨询", source: "gameplay_mall" });
      const conversation = created.conversation;
      if (!conversation?.id) return json(res, 500, { ok: false, message: "创建客服会话失败。" });
      const card = productCardContent(product, profile);
      const intro = `我想咨询更多玩法商品：${product.name || "未命名商品"}`;
      await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          conversation_id: conversation.id,
          sender_id: profile.id,
          sender_role: "boss",
          message_type: "text",
          content: intro,
          created_at: nowIso(),
        }),
      });
      const cardRows = await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          conversation_id: conversation.id,
          sender_id: profile.id,
          sender_role: "boss",
          message_type: "product_card",
          content: card,
          created_at: nowIso(),
        }),
      });
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ updated_at: nowIso(), status: conversation.customer_service_id ? conversation.status : "waiting_service" }),
      });
      const presence = await servicePresence();
      const decorated = await decorateConversationPayload(conversation, presence);
      return json(res, 200, {
        ok: true,
        message: "已创建更多玩法咨询，正在接入客服。",
        conversation: decorated.conversation,
        productCard: cardRows?.[0] || null,
        serviceOnline: decorated.serviceOnline,
        serviceStatus: decorated.serviceStatus,
        redirect: `/support.html?conversation=${encodeURIComponent(conversation.id)}&from=gameplay`,
      });
    }

    const orderId = String(
      (req.method === "GET" ? req.query.order_id || req.query.order || "" : body.order_id || body.orderId || body.order || "")
    ).trim();
    const conversationId = String(
      (req.method === "GET"
        ? req.query.conversation_id || req.query.conversation || ""
        : body.conversation_id || body.conversationId || body.conversation || "")
    ).trim();

    if (req.method === "GET" && (action === "conversations" || action === "list_conversations")) {
      const [presence, conversations] = await Promise.all([servicePresence(), listConversations(profile)]);
      const totalUnread = conversations.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);
      return json(res, 200, {
        ok: true,
        conversations,
        unread: totalUnread,
        unreadCount: totalUnread,
        identity: profile._identity || identityView(profile, profile._authUser || {}),
        serviceOnline: !!presence.online,
        serviceStatus: presence.online ? "等待客服接待" : "客服暂时离线",
      });
    }

    if (req.method === "POST" && (action === "mark_read" || action === "read_conversation")) {
      const targetId = String(conversationId || body.conversation_id || body.conversationId || body.id || "").trim();
      if (!targetId) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = await conversationByIdForBoss(profile, targetId);
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在或不属于当前账号。" });
      const marked = await markBossReadCsMessages(existing.id);
      const conversations = await listConversations(profile);
      const totalUnread = conversations.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);
      const current = conversations.find((c) => c.id === existing.id) || {
        id: existing.id,
        unreadCount: marked.unread,
        unread: marked.unread,
      };
      return json(res, 200, {
        ok: true,
        conversation: current,
        conversations,
        unread: totalUnread,
        unreadCount: totalUnread,
        last_read_at: marked.readAt,
      });
    }

    if (req.method === "POST" && (action === "open" || action === "create" || action === "ensure" || action === "reopen")) {
      const forceNew =
        action === "reopen" ||
        String(body.forceNew || body.force_new || body.reopen || "").trim() === "1" ||
        body.forceNew === true;
      const created = await resolveConversation(profile, {
        conversationId: forceNew ? "" : conversationId,
        orderId,
        create: true,
        forceNew,
      });
      const conversation = created.conversation;
      if (!conversation?.id) return json(res, 500, { ok: false, message: "创建客服会话失败。" });
      const presence = await servicePresence();
      const decorated = await decorateConversationPayload(conversation, presence);
      const messages = await loadMessages(conversation.id);
      return json(res, 200, {
        ok: true,
        created: !!created.created,
        conversation: decorated.conversation,
        messages,
        conversations: await listConversations(profile),
        serviceOnline: decorated.serviceOnline,
        serviceStatus: decorated.serviceStatus,
      });
    }

    // Create only when opening by order / sending / explicit thread with ids.
    const shouldCreate =
      !!orderId ||
      action === "send" ||
      (req.method === "POST" && action !== "list") ||
      (req.method === "GET" && !!orderId);
    const resolved = await resolveConversation(profile, {
      conversationId,
      orderId,
      create: shouldCreate,
    });
    let conversation = resolved.conversation;
    if (!conversation?.id) {
      if (req.method === "GET") {
        const presence = await servicePresence();
        return json(res, 200, {
          ok: true,
          conversation: null,
          messages: [],
          conversations: await listConversations(profile),
          serviceOnline: !!presence.online,
          serviceStatus: presence.online ? "等待客服接待" : "客服暂时离线",
        });
      }
      return json(res, 404, { ok: false, message: "会话不存在，请先创建客服会话。" });
    }

    if (req.method === "GET") {
      const presence = await servicePresence();
      const decorated = await decorateConversationPayload(conversation, presence);
      const messages = await loadMessages(conversation.id);
      return json(res, 200, {
        ok: true,
        conversation: decorated.conversation,
        messages,
        serviceOnline: decorated.serviceOnline,
        serviceStatus: decorated.serviceStatus,
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    if (conversation.status === "closed" || conversation.status === "ended") {
      return json(res, 409, {
        ok: false,
        code: "CONVERSATION_CLOSED",
        message: "本次客服会话已结束，请重新发起咨询。",
        conversation: (await decorateConversationPayload(conversation, await servicePresence())).conversation,
      });
    }
    const content = String(body.content || "").trim();
    if (!content) return json(res, 400, { ok: false, message: "请输入消息内容。" });
    let messageType = String(body.messageType || body.message_type || "text").trim() || "text";
    const linkedOrderId = conversation.order_id || orderId || null;
    const createdAt = nowIso();
    const senderName = String(profile.display_name || "").trim() || "老板";
    const basePayload = {
      conversation_id: conversation.id,
      sender_id: profile.id,
      sender_role: "boss",
      order_id: linkedOrderId,
      read_at: null,
      created_at: createdAt,
    };
    const insertFn = (payload) =>
      supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      });

    let row;
    if (messageType === "image") {
      if (!normalizeImageUrl(content)) {
        return json(res, 400, { ok: false, message: "图片消息内容无效。" });
      }
      const saved = await persistImageMessage(insertFn, basePayload, content);
      row = saved.row;
      messageType = "image";
    } else {
      const rows = await insertFn({ ...basePayload, message_type: messageType, content });
      row = Array.isArray(rows) ? rows[0] : rows;
    }

    supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        updated_at: createdAt,
        status: conversation.customer_service_id ? conversation.status || "open" : "waiting_service",
      }),
    }).catch(() => {});

    const message = await decorateChatMessageSigned(row || {}, {
      conversationId: conversation.id,
      senderId: profile.id,
      senderRole: "boss",
      senderName,
      messageType,
      createdAt,
      orderId: linkedOrderId,
    });

    return json(res, 200, {
      ok: true,
      message: "消息已发送",
      row: message,
      conversation,
      messages: null,
      appended: message,
      serviceOnline: !!conversation.customer_service_id,
      serviceStatus: conversation.customer_service_id ? "客服已接入" : "等待客服接待",
    });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "在线客服接口异常" });
  }
}
