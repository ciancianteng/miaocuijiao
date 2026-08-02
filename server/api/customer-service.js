import "./_load-env.js";
import { mapCompanionPublicFields } from "./_companion-public-map.js";
import { ORDER_STATUS_LABELS } from "./_order-status.js";
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ORDER_STATUS_TEXT = { ...ORDER_STATUS_LABELS };
const SERVICE_ROLES = new Set(["customer_service"]);
const ASSIGN_LOCKS = new Map();
const TEST_NOISE_RE = /\[TEST\]|E2E-MSG|E2E[_-]|CHAT-|CS-LINK|SVC-|MSG-|ORDER-CHAT-|acceptance|自动化测试/i;
const GARBLE_RE = /Ã.|Â.|ä¸|æ.|å.|ç.|è.|é.|ðŸ|ï¼|ï½/;

function json(res, status, data) { return res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function serviceHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }; }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const raw = typeof body === "string" ? body : "";
    const detail = body?.error_description || body?.message || body?.hint || body?.details || body?.error || raw || "";
    const code = body?.code ? ` [${body.code}]` : "";
    throw new Error((detail ? `${detail}${code}` : `Supabase 请求失败 (HTTP ${response.status})`) || `Supabase 请求失败 (HTTP ${response.status})`);
  }
  return body;
}
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
function tokenFrom(req) { return String(req.headers["x-mcj-service-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function nowIso() { return new Date().toISOString(); }
function orderNo(prefix = "MCJ") { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}
async function tableRows(table, query = "") { const rows = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() }); return Array.isArray(rows) ? rows : []; }
async function maybeRows(table, query = "") { try { return await tableRows(table, query); } catch { return []; } }
async function profileById(id) {
  if (!isUuid(id)) return null;
  const rows = await tableRows("profiles", `?id=eq.${encodeURIComponent(String(id).trim())}&limit=1`);
  return rows[0] || null;
}
async function profileByBossUid(uid) {
  const value = String(uid || "").trim();
  if (!value) return null;
  const rows = await maybeRows("profiles", `?boss_uid=eq.${encodeURIComponent(value)}&role=eq.boss&limit=1`);
  return rows[0] || null;
}
async function resolveBoss(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (isUuid(value)) return profileById(value);
  if (/^B\d+$/i.test(value)) return profileByBossUid(value.toUpperCase());
  if (/^\d+$/.test(value)) {
    const withPrefix = await profileByBossUid(`B${value}`);
    if (withPrefix) return withPrefix;
  }
  return profileByBossUid(value);
}
async function resolveCompanion(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (isUuid(value)) {
    const byId = await profileById(value);
    if (byId && byId.role === "companion") return byId;
    return null;
  }
  const uid = value.replace(/^P/i, "").trim();
  if (!/^\d+$/.test(uid)) return null;
  const rows = await maybeRows("companion_profiles", `?companion_uid=eq.${encodeURIComponent(uid)}&select=user_id&limit=1`);
  const userId = rows[0]?.user_id;
  if (!isUuid(userId)) return null;
  const profile = await profileById(userId);
  return profile && profile.role === "companion" ? profile : null;
}
async function profileMap(ids) { const uniq = [...new Set((ids || []).filter(isUuid))]; if (!uniq.length) return {}; const rows = await maybeRows("profiles", `?id=in.(${uniq.map(encodeURIComponent).join(",")})&limit=1000`); return rows.reduce((map, row) => { map[row.id] = row; return map; }, {}); }
async function authUserFromToken(token) { return supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) }); }
async function requireService(req) { const token = tokenFrom(req); if (!token) throw Object.assign(new Error("请先登录客服端。"), { status: 401 }); const authUser = await authUserFromToken(token); const profile = await profileById(authUser.id); if (!profile || !SERVICE_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问客服端。"), { status: 403 }); if (profile.status !== "active") throw Object.assign(new Error("该客服账号已被停用，请联系管理员。"), { status: 403 }); return { token, authUser, profile }; }
function safeProfile(row) {
  const bossUid = row.boss_uid || "";
  return {
    id: row.id,
    bossUid,
    boss_uid: bossUid,
    uid: bossUid || row.id,
    name: row.display_name || row.email || "-",
    email: row.email || "",
    phone: row.phone || "",
    avatar: row.avatar_url || "",
    status: row.status || "",
  };
}
function safeOrder(row, profiles = {}, extras = {}) {
  const boss = profiles[row.boss_id] || {};
  const companion = profiles[row.companion_id] || {};
  const service = profiles[row.customer_service_id] || {};
  const bossUid = boss.boss_uid || "";
  const note = String(row.note || row.cancel_reason || "");
  const needsReassign =
    row.status === "pending" && /无法接单|确认超时|拒单|重新安排/.test(note);
  const flowStatus =
    extras.flowStatus ||
    ({
      awaiting_payment: "draft",
      pending: "pending_grab",
      waiting_boss_confirm: "selecting",
      claimed: "pending_companion_confirm",
      confirmed: "confirmed",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    }[row.status] || row.status || "");
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    bossId: row.boss_id || "",
    bossUid,
    bossName: boss.display_name || boss.email || bossUid || row.boss_id || "-",
    companionId: row.companion_id || "",
    companionName: companion.display_name || companion.email || "-",
    serviceId: row.customer_service_id || "",
    serviceName: service.display_name || service.email || "-",
    orderType: row.order_type || "custom",
    game: row.game || "",
    title: row.title || "",
    description: row.description || "",
    hours: money(row.hours),
    unitPrice: money(row.unit_price),
    totalAmount: money(row.total_amount),
    status: row.status || "",
    flowStatus,
    statusText: ORDER_STATUS_TEXT[row.status] || row.status || "-",
    note,
    cancelReason: row.cancel_reason || "",
    needsReassign,
    reassignHint: needsReassign
      ? /确认超时/.test(note)
        ? "陪玩确认超时，需重新指定陪玩"
        : "陪玩无法接单，可更换陪玩 / 推送抢单 / 联系老板 / 发起退款"
      : "",
    grabCount: Number(extras.grabCount != null ? extras.grabCount : 0) || 0,
    grabs: extras.grabs || [],
    bossIntent: extras.bossIntent || null,
    preferredCompanionId: extras.bossIntent?.companionId || "",
    createdAt: row.created_at || "",
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
  };
}
function safeMessage(row, profiles = {}) {
  const sender = profiles[row.sender_id] || {};
  let senderName = "";
  if (row.sender_role === "customer_service") {
    senderName = String(sender.display_name || "").trim() || "客服";
  } else if (row.sender_role === "boss") {
    senderName = String(sender.display_name || sender.boss_uid || "").trim() || "老板";
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName,
    messageType: row.message_type || row.type || "text",
    content: row.content || "",
    orderId: row.order_id || "",
    createdAt: row.created_at || "",
    readAt: row.read_at || "",
  };
}
function unreadRolesForConversation(conversation) {
  const isCompanionSupport =
    String(conversation?.conversation_type || "") === "companion_support" ||
    (!conversation?.boss_id && conversation?.companion_id);
  return isCompanionSupport ? ["companion"] : ["boss"];
}
async function countUnreadBossMessages(conversationId, opts = {}) {
  const roles = Array.isArray(opts.roles) && opts.roles.length ? opts.roles : ["boss"];
  let total = 0;
  for (const role of roles) {
    const rows = await maybeRows(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null&select=id&limit=1000`
    );
    total += Array.isArray(rows) ? rows.length : 0;
  }
  return total;
}
async function markConversationBossMessagesRead(conversationId, opts = {}) {
  const readAt = nowIso();
  const bossId = String(opts.bossId || "").trim();
  const roles = Array.isArray(opts.roles) && opts.roles.length ? opts.roles : unreadRolesForConversation(opts.conversation || {});
  for (const role of roles) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
  }
  // Also mark by boss sender_id in case sender_role was stored inconsistently.
  if (isUuid(bossId) && roles.includes("boss")) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_id=eq.${encodeURIComponent(bossId)}&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
  }
  // Persist CS reading cursor (column may be missing on older DBs).
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ last_read_at: readAt, unread_count: 0, updated_at: readAt }),
    });
  } catch (err) {
    const detail = String(err?.message || "");
    if (/unread_count/i.test(detail)) {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ last_read_at: readAt, updated_at: readAt }),
        });
      } catch (err2) {
        const detail2 = String(err2?.message || "");
        if (!/last_read_at|column|schema cache|PGRST/i.test(detail2)) throw err2;
        try {
          await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ updated_at: readAt }),
          });
        } catch (_) {}
      }
    } else if (!/last_read_at|column|schema cache|PGRST/i.test(detail)) {
      throw err;
    } else {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ updated_at: readAt }),
        });
      } catch (_) {}
    }
  }
  let remaining = await countUnreadBossMessages(conversationId, { roles });
  // One retry if PostgREST returned success but rows still unread (race / filter).
  if (remaining > 0) {
    for (const role of roles) {
      try {
        await supabaseJson(
          restUrl(
            "messages",
            `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null`
          ),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
        );
      } catch (_) {}
    }
    remaining = await countUnreadBossMessages(conversationId, { roles });
  }
  return { readAt, unread: remaining };
}
function isTestNoiseConversation(row, msgs = [], orderNo = "") {
  if (row?.is_test === true || row?.is_test === "true" || row?.meta?.is_test) return true;
  const blob = [
    orderNo,
    row?.last_message,
    row?.title,
    ...(msgs || []).slice(-8).map((m) => m.content || ""),
  ]
    .map((v) => String(v || ""))
    .join("\n");
  if (TEST_NOISE_RE.test(blob)) return true;
  if (GARBLE_RE.test(blob)) return true;
  return false;
}
async function ensureConversation({ boss_id, companion_id = null, customer_service_id = null, order_id = null }) {
  let query = order_id
    ? `?order_id=eq.${encodeURIComponent(order_id)}&limit=1`
    : `?boss_id=eq.${encodeURIComponent(boss_id)}&order_id=is.null&order=updated_at.desc&limit=1`;
  const rows = await maybeRows("conversations", query);
  if (rows[0]) {
    try {
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(rows[0].id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ updated_at: nowIso() }),
      });
    } catch (_) {}
    return rows[0];
  }
  const base = {
    boss_id,
    companion_id,
    customer_service_id,
    order_id,
    status: customer_service_id ? "open" : "waiting_service",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const rich = {
    ...base,
    conversation_type: order_id ? "order_support" : "general_support",
  };
  try {
    const inserted = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(rich),
    });
    return inserted[0] || null;
  } catch (err) {
    if (!/conversation_type|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    const inserted = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(base),
    });
    return inserted[0] || null;
  }
}
async function addMessage(conversation, sender, senderRole, content, messageType = "system", orderId = null) { if (!conversation) return null; const rows = await supabaseJson(restUrl("messages"), { method: "POST", headers: serviceHeaders(), body: JSON.stringify({ conversation_id: conversation.id, sender_id: sender, sender_role: senderRole, message_type: messageType, content: String(content || ""), order_id: orderId || conversation.order_id || null, created_at: nowIso() }) }); await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ updated_at: nowIso() }) }); return rows[0] || null; }
async function allocateBossUid() {
  const rows = await maybeRows("profiles", "?role=eq.boss&select=boss_uid&boss_uid=not.is.null&order=created_at.desc&limit=200");
  let next = 100001;
  for (const row of rows) {
    const match = String(row?.boss_uid || "").trim().match(/^B(\d+)$/i);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `B${next + attempt}`;
    const existing = await maybeRows("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`);
    if (!existing.length) return candidate;
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
async function loadBootstrap(serviceProfile) {
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await expireCompanionConfirmTimeouts({ limit: 50 });
  } catch {
    /* best-effort */
  }
  const [ordersRaw, conversationsRaw, profilesRaw, companionsRaw, reportsRaw, payrollsRaw, workData] = await Promise.all([
    maybeRows("orders", "?order=created_at.desc&limit=300"),
    maybeRows("conversations", "?order=updated_at.desc&limit=300"),
    maybeRows("profiles", "?limit=1000"),
    maybeRows("companion_profiles", "?limit=1000"),
    maybeRows("customer_service_reports", `?customer_service_id=eq.${encodeURIComponent(serviceProfile.id)}&order=created_at.desc&limit=100`),
    maybeRows("staff_payrolls", `?staff_id=eq.${encodeURIComponent(serviceProfile.id)}&order=created_at.desc&limit=100`),
    import("./_customer-service-work.js").then((m) => m.loadServiceWorkData(serviceProfile.id)).catch(() => null),
  ]);
  const convIds = (conversationsRaw || []).map((c) => c.id).filter(Boolean);
  let messagesRawDesc = [];
  if (convIds.length) {
    const chunkSize = 40;
    for (let i = 0; i < convIds.length; i += chunkSize) {
      const chunk = convIds.slice(i, i + chunkSize);
      const rows = await maybeRows(
        "messages",
        `?conversation_id=in.(${chunk.map(encodeURIComponent).join(",")})&order=created_at.desc&limit=1200`
      );
      messagesRawDesc = messagesRawDesc.concat(rows || []);
    }
  } else {
    messagesRawDesc = await maybeRows("messages", "?order=created_at.desc&limit=1500");
  }
  const messagesRaw = (messagesRawDesc || []).slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const profiles = profilesRaw.reduce((map, row) => { map[row.id] = row; return map; }, {});
  // Backfill missing boss_uid so CS pool always shows 老板 UID.
  const bossIdsNeedingUid = [...new Set((conversationsRaw || []).map((c) => c.boss_id).filter((id) => id && profiles[id] && !profiles[id].boss_uid))];
  for (const id of bossIdsNeedingUid.slice(0, 20)) {
    profiles[id] = await ensureBossUid(profiles[id]);
  }
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const { parseBossIntent, enrichGrabCompanions, toFlowStatus } = await import("./_order-flow.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
  const grabEligible = (ordersRaw || []).slice(0, 80).filter((row) =>
    ["pending", "waiting_boss_confirm", "claimed", "confirmed"].includes(row.status)
  );
  const grabNoteMap = Object.fromEntries(grabEligible.map((row) => [row.id, row.note || row.description || ""]));
  const grabMapRaw = await grabsApi.listGrabsBatch(
    grabEligible.map((row) => row.id),
    grabNoteMap
  );
  const needsEnrich = grabEligible.filter((row) => ["pending", "waiting_boss_confirm"].includes(row.status));
  const enrichFlat = needsEnrich.flatMap((row) => grabMapRaw[row.id] || []);
  const enrichedAll = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, enrichFlat).catch(() => enrichFlat);
  const enrichedByKey = Object.fromEntries(
    (enrichedAll || []).map((g) => [String(g.id || g.grabId || `${g.orderId}:${g.companionId}`), g])
  );
  const grabExtras = (ordersRaw || []).slice(0, 80).map((row) => {
    if (!["pending", "waiting_boss_confirm", "claimed", "confirmed"].includes(row.status)) {
      return { id: row.id, grabCount: 0, grabs: [], bossIntent: parseBossIntent(row) };
    }
    const grabs = grabMapRaw[row.id] || [];
    const intent = parseBossIntent(row);
    let enriched = grabs;
    if (["pending", "waiting_boss_confirm"].includes(row.status) && grabs.length) {
      enriched = grabs.map((g) => {
        const key = String(g.id || g.grabId || `${g.orderId}:${g.companionId}`);
        const eg = enrichedByKey[key] || g;
        return {
          ...eg,
          bossPreferred: !!(intent && intent.companionId === eg.companionId),
          companion: eg.companion
            ? { ...eg.companion, bossPreferred: !!(intent && intent.companionId === eg.companionId) }
            : null,
        };
      });
    }
    return { id: row.id, grabCount: grabs.length, grabs: enriched, bossIntent: intent };
  });
  const grabMap = Object.fromEntries(grabExtras.map((g) => [g.id, g]));
  const orders = ordersRaw.map((row) => {
    const extra = grabMap[row.id] || {};
    return safeOrder(row, profiles, {
      grabCount: extra.grabCount || 0,
      grabs: extra.grabs || [],
      bossIntent: extra.bossIntent || null,
      flowStatus: toFlowStatus(row.status),
    });
  }); const msgByConv = messagesRaw.reduce((map, msg) => { (map[msg.conversation_id] = map[msg.conversation_id] || []).push(msg); return map; }, {}); const conversationsMapped = conversationsRaw.map((row) => { const boss = profiles[row.boss_id] || {}; const companionProf = profiles[row.companion_id] || {}; const service = profiles[row.customer_service_id] || {}; const msgs = msgByConv[row.id] || []; const last = msgs[msgs.length - 1] || {}; const bossUid = String(boss.boss_uid || "").trim(); const isCompanionSupport = String(row.conversation_type || "") === "companion_support" || (!row.boss_id && row.companion_id); const isClosed = row.status === "closed" || row.status === "ended"; const convStatus = isClosed ? "已结束" : (row.customer_service_id ? "正在接待" : "待接待"); const lastReadAt = row.last_read_at || ""; const unreadRoles = isCompanionSupport ? ["companion"] : ["boss"]; const unreadBoss = isClosed ? [] : msgs.filter((m) => {
    if (!unreadRoles.includes(m.sender_role) || m.read_at) return false;
    if (lastReadAt && String(m.created_at || "") <= String(lastReadAt)) return false;
    return true;
  }); const companionName = String(companionProf.display_name || "").trim() || "陪玩"; return { id: row.id, bossId: row.boss_id || "", bossUid: bossUid || "", bossName: isCompanionSupport ? `陪玩 · ${companionName}` : (boss.display_name || bossUid || "老板"), companionId: row.companion_id || "", conversationType: row.conversation_type || (isCompanionSupport ? "companion_support" : "general_support"), orderId: row.order_id || "", orderNo: (orders.find((o) => o.id === row.order_id) || {}).orderNo || "", currentServiceId: isClosed ? (row.customer_service_id || "") : (row.customer_service_id || ""), currentServiceName: String(service.display_name || "").trim() || (row.customer_service_id ? "客服" : "待接待"), status: convStatus, rawStatus: isClosed ? "closed" : (row.status || ""), lastMessage: last.content || "", lastTime: last.created_at || row.updated_at || "", unread: unreadBoss.length, unreadCount: unreadBoss.length, closedAt: row.closed_at || "", closedBy: row.closed_by || "", lastReadAt, acceptedAt: row.accepted_at || "", updatedAt: row.updated_at || "" }; }); const conversations = conversationsMapped.filter((c) => !isTestNoiseConversation({ last_message: c.lastMessage, title: c.bossName }, (messagesRaw || []).filter((m) => m.conversation_id === c.id).map((m) => ({ content: m.content })), c.orderNo)); const bosses = profilesRaw.filter((p) => p.role === "boss" && p.status === "active").map(safeProfile); const companions = companionsRaw.map((cp) => { const p = profiles[cp.user_id] || {}; const verified = /approved|verified|passed/.test(String(cp.verification_status || "")); const mapped = mapCompanionPublicFields(cp, p); const onlineRaw = String(cp.online_status || mapped.availabilityStatus || "offline").toLowerCase(); const onlineStatus = verified ? onlineRaw : "offline"; return { id: mapped.id || cp.user_id, companionUid: mapped.companionUid || cp.companion_uid || "", name: mapped.name || "陪玩", game: cp.game || "", level: cp.level_name || "", price: money(cp.price), avatar: mapped.avatar, cover: mapped.cover, cardImageUrl: mapped.cardImageUrl || mapped.cover, status: p.status || "", verificationStatus: mapped.verificationStatus || cp.verification_status || "", onlineStatus, online: onlineStatus === "online", idle: onlineStatus === "online" }; }).filter((p) => isUuid(p.id) && (!p.status || p.status === "active" || p.status === "启用")); const today = new Date().toISOString().slice(0, 10); const receptionStats = await (await import("./_service-receptions.js")).loadReceptionStats(serviceProfile.id, conversations); const summary = { waitingConversations: conversations.filter((c) => !c.currentServiceId && c.rawStatus !== "closed").length, currentReceptions: workData?.summary?.currentReceptions || receptionStats.currentReceptions || 0, todayReceptions: workData?.summary?.todayReceptions || receptionStats.todayReceptions || 0, monthReceptions: receptionStats.monthReceptions || 0, awaitingPayment: orders.filter((o) => o.status === "awaiting_payment").length, pendingOrders: orders.filter((o) => o.status === "pending").length, waitingCompanionConfirm: orders.filter((o) => o.status === "claimed").length, needsReassign: orders.filter((o) => o.needsReassign).length, waitingBossConfirm: orders.filter((o) => o.status === "waiting_boss_confirm").length, inProgress: orders.filter((o) => o.status === "in_progress" || o.status === "confirmed").length, refundRequested: orders.filter((o) => o.status === "refund_requested").length, todayHandled: orders.filter((o) => o.serviceId === serviceProfile.id && String(o.createdAt).slice(0, 10) === today).length, todayCompleted: workData?.summary?.todayCompleted || 0, todayPaid: workData?.summary?.todayPaid || 0, todayRefunds: workData?.summary?.todayRefunds || 0, unreadMessages: workData?.summary?.unreadMessages || 0, monthAttendanceDays: workData?.summary?.monthAttendanceDays || 0, monthLateCount: workData?.summary?.monthLateCount || 0, monthAbsenceCount: workData?.summary?.monthAbsenceCount || 0, estimatedSalary: workData?.summary?.estimatedSalary || 0 }; const payrollStatusText = { draft: "草稿", pending_review: "待审核", approved_pending_pay: "已通过待付款", rejected: "已驳回", paying: "付款处理中", paid_pending_receipt: "已付款待上传收据", completed: "已发放", pay_failed: "付款失败", cancelled: "已撤销" };   const payrolls = (payrollsRaw || []).map((row) => { const snap = row.payment_account_snapshot || {}; return { id: row.id, payrollNo: row.payroll_no, periodStart: row.period_start, periodEnd: row.period_end, baseSalaryRm: money(row.base_salary_rm), bonusRm: money(row.bonus_rm), deductionRm: money(row.deduction_rm), netSalaryRm: money(row.net_salary_rm), accountLast4: snap.account_last4 || "", status: row.status, statusText: payrollStatusText[row.status] || row.status, paidAt: row.paid_at || "", note: row.note || "" }; });
  let dockRewards = [];
  try {
    dockRewards = await maybeRows(
      "cs_dock_rewards",
      `?service_id=eq.${encodeURIComponent(serviceProfile.id)}&order=settled_at.desc.nullslast&limit=80`
    );
  } catch {
    dockRewards = [];
  }
  const settledRewards = (dockRewards || []).filter((r) => r.status === "settled");
  const dockRewardCatFood = settledRewards.reduce((sum, r) => sum + money(r.amount_cat_food), 0);
  summary.dockRewardCatFood = dockRewardCatFood;
  summary.dockRewardCount = settledRewards.length;
  return {
    staff: safeProfile(serviceProfile),
    summary,
    conversations,
    messages: messagesRaw.map((row) => safeMessage(row, profiles)),
    orders,
    bosses,
    companions,
    reports: reportsRaw,
    payrolls,
    dockRewards: (dockRewards || []).slice(0, 40).map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNo: r.order_no || "",
      amount: money(r.amount_cat_food),
      status: r.status,
      settledAt: r.settled_at || "",
      clawbackAt: r.clawback_at || "",
    })),
    orderStatuses: ORDER_STATUS_TEXT,
    workData: workData || null,
  };
}
async function orderById(id) { if (!isUuid(id)) return null; const rows = await tableRows("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`); return rows[0] || null; }
async function patchOrder(id, patch) { if (!isUuid(id)) return null; const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) }); return rows[0] || null; }
async function handler(req, res) { if (!hasDb()) return json(res, req.method === "GET" ? 200 : 503, { ok: req.method === "GET", configured: false, message: "未配置 Supabase，客服端不返回假数据。", data: { staff: {}, summary: { waitingConversations: 0, currentReceptions: 0, todayReceptions: 0, monthReceptions: 0, awaitingPayment: 0, pendingOrders: 0, waitingBossConfirm: 0, inProgress: 0, refundRequested: 0, todayHandled: 0 }, conversations: [], messages: [], orders: [], bosses: [], companions: [], reports: [], orderStatuses: ORDER_STATUS_TEXT } }); try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    if (req.method !== "GET") req.body = body;
    let pathAction = "";
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (/\/customer-service\/accept\/?$/.test(pathname) || /\/accept\/?$/.test(pathname)) pathAction = "accept";
    } catch (_) {}
    let action = String(req.method === "GET" ? (req.query?.action || "bootstrap") : (body.action || req.query?.action || pathAction || "")).trim();
    if (action === "accept") action = "take_conversation";
    if (action === "login") { const email = String(body.account || body.email || "").trim().toLowerCase(); const password = String(body.password || ""); if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" }); let auth; try { auth = await supabaseJson(authUrl("token?grant_type=password"), { method: "POST", headers: anonHeaders(), body: JSON.stringify({ email, password }) }); } catch { return json(res, 401, { ok: false, message: "账号或密码错误。" }); } const profile = await profileById(auth.user?.id); if (!profile || profile.role !== "customer_service") return json(res, 403, { ok: false, message: "无权访问客服端。" }); if (profile.status !== "active") return json(res, 403, { ok: false, message: "该客服账号已被停用，请联系管理员。" }); return json(res, 200, { ok: true, session: { token: auth.access_token, refreshToken: auth.refresh_token || "", expiresAt: auth.expires_at || auth.expires_in || "", user: safeProfile(profile), remember: true } }); }
    const service = await requireService(req); if (req.method === "GET") return json(res, 200, { ok: true, configured: true, data: await loadBootstrap(service.profile) });
    if (action === "bootstrap" || !action) return json(res, 200, { ok: true, configured: true, data: await loadBootstrap(service.profile) });
    if (action === "take_conversation") {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法接待。" });
      }
      if (existing.customer_service_id && existing.customer_service_id !== service.profile.id) {
        const other = await profileById(existing.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 409, { ok: false, message: `该会话已由客服 ${otherName} 接待。` });
      }
      if (existing.customer_service_id === service.profile.id) {
        await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
        return json(res, 200, {
          ok: true,
          message: "你已在接待该会话。",
          conversation: {
            ...existing,
            status: existing.status === "serving" ? "active" : (existing.status || "active"),
            customer_service_id: service.profile.id,
          },
        });
      }
      const nick = String(service.profile.display_name || "").trim() || "客服";
      const acceptedAt = nowIso();
      const claimFilter = `?id=eq.${encodeURIComponent(id)}&customer_service_id=is.null`;
      async function claimWith(patch) {
        const rows = await supabaseJson(restUrl("conversations", claimFilter), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        });
        return Array.isArray(rows) ? rows[0] : null;
      }
      let conversation = null;
      try {
        conversation = await claimWith({
          customer_service_id: service.profile.id,
          status: "active",
          accepted_at: acceptedAt,
          updated_at: acceptedAt,
        });
      } catch (err) {
        const detail = String(err?.message || "");
        if (!/accepted_at|column|schema cache|PGRST/i.test(detail)) throw err;
        try {
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "active",
            updated_at: acceptedAt,
          });
        } catch (err2) {
          const detail2 = String(err2?.message || "");
          if (!/status|check|invalid/i.test(detail2)) throw err2;
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "serving",
            updated_at: acceptedAt,
          });
        }
      }
      if (!conversation) {
        try {
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "serving",
            updated_at: acceptedAt,
          });
        } catch (_) {}
      }
      if (!conversation) {
        const again = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
        if (again?.customer_service_id === service.profile.id) {
          await markConversationBossMessagesRead(id, { bossId: again.boss_id, conversation: again });
          return json(res, 200, { ok: true, message: "你已在接待该会话。", conversation: again });
        }
        const other = again?.customer_service_id ? await profileById(again.customer_service_id) : null;
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 409, { ok: false, message: `该会话已由客服 ${otherName} 接待。` });
      }
      // 有关联订单时绑定当前客服 ID（订单业务状态枚举不含 serving，不改 orders.status）。
      if (conversation.order_id) {
        try {
          await patchOrder(conversation.order_id, { customer_service_id: service.profile.id });
        } catch (_) {}
      }
      try {
        await (await import("./_service-receptions.js")).startReceptionRecord(conversation, service.profile.id);
      } catch (_) {}
      // sender_role 必须是 enum 合法值；系统提示用 message_type=system。
      await addMessage(conversation, service.profile.id, "customer_service", `客服 ${nick} 已接待您。`, "system");
      await markConversationBossMessagesRead(id, { bossId: conversation.boss_id || existing.boss_id, conversation: conversation || existing });
      return json(res, 200, {
        ok: true,
        message: "已接待该会话。",
        conversation: {
          ...conversation,
          status: conversation.status === "serving" ? "active" : (conversation.status || "active"),
          customer_service_id: service.profile.id,
          accepted_at: conversation.accepted_at || acceptedAt,
        },
      });
    }
    if (action === "end_conversation") {
      const id = String(body.id || body.conversation_id || "").trim();
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
        return json(res, 200, { ok: true, message: "会话已结束。", conversation: existing });
      }
      if (!existing.customer_service_id) {
        return json(res, 400, { ok: false, message: "该会话当前无人接待。" });
      }
      if (existing.customer_service_id !== service.profile.id) {
        const other = await profileById(existing.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 403, { ok: false, message: `只有接待中的客服可结束。当前由 ${otherName} 接待。` });
      }
      const closedAt = nowIso();
      const basePatch = {
        status: "closed",
        updated_at: closedAt,
      };
      // Prefer keeping customer_service_id for history; also try optional close metadata columns.
      const richPatch = {
        ...basePatch,
        closed_at: closedAt,
        ended_at: closedAt,
        closed_by: service.profile.id,
        unread_count: 0,
      };
      let conversation = null;
      try {
        const rows = await supabaseJson(
          restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(richPatch) }
        );
        conversation = Array.isArray(rows) ? rows[0] : null;
      } catch (err) {
        const detail = String(err?.message || "");
        if (!/closed_at|closed_by|ended_at|unread_count|schema cache|column/i.test(detail)) throw err;
        try {
          const rows = await supabaseJson(
            restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
            {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                ...basePatch,
                closed_at: closedAt,
                closed_by: service.profile.id,
              }),
            }
          );
          conversation = Array.isArray(rows) ? rows[0] : null;
        } catch (err2) {
          const detail2 = String(err2?.message || "");
          if (!/closed_at|closed_by|schema cache|column/i.test(detail2)) throw err2;
          const rows = await supabaseJson(
            restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
            { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(basePatch) }
          );
          conversation = Array.isArray(rows) ? rows[0] : null;
        }
      }
      if (!conversation) {
        const again = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
        conversation = again || existing;
      }
      try {
        await (await import("./_service-receptions.js")).endReceptionRecord(id, service.profile.id);
      } catch (_) {}
      let rewardEval = null;
      try {
        rewardEval = await (await import("./_cs-dock-rewards.js")).evaluateEndReceptionReward({
          serviceId: service.profile.id,
          conversation: conversation || existing,
        });
      } catch (_) {
        rewardEval = { code: "ERROR", message: "奖励结算检查失败，请稍后在后台核对。", settled: false };
      }
      await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
      await addMessage(conversation || existing, service.profile.id, "customer_service", "客服已结束本次接待。", "system");
      await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
      const endMessage = rewardEval?.message || "已结束接待。";
      return json(res, 200, {
        ok: true,
        message: endMessage,
        reward: rewardEval,
        conversation: {
          ...(conversation || existing),
          status: "closed",
          closed_at: closedAt,
          closed_by: service.profile.id,
        },
      });
    }
    if (action === "mark_read" || action === "read_conversation") {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      const roles = unreadRolesForConversation(existing);
      const marked = await markConversationBossMessagesRead(id, {
        bossId: existing.boss_id,
        conversation: existing,
        roles,
      });
      return json(res, 200, {
        ok: true,
        message: "已标记已读。",
        conversation: {
          ...existing,
          last_read_at: marked.readAt,
          unread: marked.unread,
          unreadCount: marked.unread,
        },
        unread: marked.unread,
        unreadCount: marked.unread,
        last_read_at: marked.readAt,
      });
    }
    if (action === "list_messages" || action === "conversation_messages") {
      const id = String(body.id || body.conversation_id || body.conversationId || req.query?.conversation_id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      const rows = await maybeRows(
        "messages",
        `?conversation_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=500`
      );
      const ids = [...new Set((rows || []).map((m) => m.sender_id).filter(Boolean))];
      const profiles = await profileMap(ids.concat([existing.boss_id, existing.companion_id, existing.customer_service_id]));
      return json(res, 200, {
        ok: true,
        conversationId: id,
        messages: (rows || []).map((row) => safeMessage(row, profiles)),
      });
    }
    if (action === "poll_updates" || action === "chat_poll") {
      const activeId = String(body.conversation_id || body.conversationId || body.id || "").trim();
      const since = String(body.since || "").trim();
      // Prefer incremental conversation query when since is provided.
      let convQuery = "?order=updated_at.desc&limit=80";
      if (since) {
        convQuery = `?updated_at=gt.${encodeURIComponent(since)}&order=updated_at.desc&limit=80`;
      }
      const convRows = await maybeRows("conversations", convQuery);
      // When incremental returns few rows, still refresh top active pool lightly for status drift.
      let visible = (convRows || []).filter((row) => !isTestNoiseConversation(row, [], ""));
      if (since && visible.length < 5) {
        const top = await maybeRows("conversations", "?order=updated_at.desc&limit=40");
        const byId = {};
        (top || []).concat(visible).forEach((r) => {
          if (r?.id) byId[r.id] = r;
        });
        visible = Object.keys(byId).map((k) => byId[k]);
      }
      const profileIds = [
        ...new Set(
          visible
            .flatMap((c) => [c.boss_id, c.companion_id, c.customer_service_id])
            .filter(Boolean)
        ),
      ];
      const profiles = await profileMap(profileIds);
      let msgQuery = activeId
        ? `?conversation_id=eq.${encodeURIComponent(activeId)}&order=created_at.desc&limit=80`
        : `?order=created_at.desc&limit=120`;
      if (since) {
        msgQuery = activeId
          ? `?conversation_id=eq.${encodeURIComponent(activeId)}&created_at=gt.${encodeURIComponent(since)}&order=created_at.asc&limit=80`
          : `?created_at=gt.${encodeURIComponent(since)}&order=created_at.asc&limit=120`;
      }
      const msgRows = await maybeRows("messages", msgQuery);
      const orderIds = [...new Set(visible.map((c) => c.order_id).filter(Boolean))];
      const ordersRaw = orderIds.length
        ? await maybeRows("orders", `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&limit=80`)
        : [];
      const orderNoById = (ordersRaw || []).reduce((m, o) => {
        m[o.id] = o.order_no || o.id;
        return m;
      }, {});
      const conversations = visible.map((row) => {
        const boss = profiles[row.boss_id] || {};
        const companionProf = profiles[row.companion_id] || {};
        const serviceProf = profiles[row.customer_service_id] || {};
        const isCompanionSupport =
          String(row.conversation_type || "") === "companion_support" || (!row.boss_id && row.companion_id);
        const isClosed = row.status === "closed" || row.status === "ended";
        const unreadRoles = isCompanionSupport ? ["companion"] : ["boss"];
        return {
          id: row.id,
          bossId: row.boss_id || "",
          bossUid: boss.boss_uid || "",
          bossName: isCompanionSupport
            ? `陪玩 · ${companionProf.display_name || "陪玩"}`
            : boss.display_name || boss.boss_uid || "老板",
          companionId: row.companion_id || "",
          conversationType: row.conversation_type || (isCompanionSupport ? "companion_support" : "general_support"),
          orderId: row.order_id || "",
          orderNo: orderNoById[row.order_id] || "",
          currentServiceId: isClosed ? row.customer_service_id || "" : row.customer_service_id || "",
          currentServiceName: String(serviceProf.display_name || "").trim() || (row.customer_service_id ? "客服" : "待接待"),
          status: isClosed ? "已结束" : row.customer_service_id ? "正在接待" : "待接待",
          rawStatus: isClosed ? "closed" : row.status || "",
          lastMessage: "",
          lastTime: row.updated_at || "",
          unread: 0,
          unreadCount: 0,
          lastReadAt: row.last_read_at || "",
          closedAt: row.closed_at || "",
          closedBy: row.closed_by || "",
          updatedAt: row.updated_at || "",
          _unreadRoles: unreadRoles,
        };
      });
      const messages = (msgRows || [])
        .slice()
        .reverse()
        .map((row) => safeMessage(row, profiles));
      // Light unread recount for listed conversations using last_read_at + recent messages sample.
      const byConv = messages.reduce((m, msg) => {
        (m[msg.conversationId] = m[msg.conversationId] || []).push(msg);
        return m;
      }, {});
      for (const c of conversations) {
        const list = byConv[c.id] || [];
        if (list.length) {
          const last = list[list.length - 1];
          c.lastMessage = last.content || "";
          c.lastTime = last.createdAt || c.lastTime;
        }
        const roles = c._unreadRoles || ["boss"];
        c.unread = list.filter((m) => {
          if (!roles.includes(m.senderRole) || m.readAt) return false;
          if (c.lastReadAt && String(m.createdAt || "") <= String(c.lastReadAt)) return false;
          return true;
        }).length;
        c.unreadCount = c.unread;
        delete c._unreadRoles;
      }
      // Accurate unread for active conversation.
      if (activeId) {
        const active = conversations.find((c) => c.id === activeId);
        if (active) {
          const roles = unreadRolesForConversation({
            conversation_type: active.conversationType,
            boss_id: active.bossId,
            companion_id: active.companionId,
          });
          active.unread = await countUnreadBossMessages(activeId, { roles });
          active.unreadCount = active.unread;
        }
      }
      const orders = (ordersRaw || []).map((row) => safeOrder(row, profiles));
      return json(res, 200, {
        ok: true,
        data: {
          conversations,
          messages,
          orders,
          polledAt: nowIso(),
          incremental: !!since,
        },
      });
    }
    if (action === "send_message") {
      const conversation = (await tableRows("conversations", `?id=eq.${encodeURIComponent(String(body.conversation_id || body.id || ""))}&limit=1`))[0];
      if (!conversation) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (conversation.status === "closed" || conversation.status === "ended") {
        return json(res, 403, { ok: false, message: "会话已结束，无法继续发送消息。" });
      }
      if (!conversation.customer_service_id) {
        return json(res, 403, { ok: false, message: "请先点击接待后再回复。" });
      }
      if (conversation.customer_service_id !== service.profile.id) {
        return json(res, 403, { ok: false, message: "该会话已由其他客服接待。" });
      }
      let messageType = String(body.messageType || body.message_type || "text").trim() || "text";
      let content = String(body.content || "").trim();
      if (!content) return json(res, 400, { ok: false, message: "请输入消息内容。" });
      if (messageType === "image" && !(/^https?:\/\//i.test(content) || content.startsWith("__IMG__:"))) {
        return json(res, 400, { ok: false, message: "图片消息内容无效。" });
      }
      let msg = null;
      try {
        msg = await addMessage(conversation, service.profile.id, "customer_service", content, messageType);
      } catch (err) {
        if (messageType === "image" && /enum|invalid input|message_type/i.test(String(err.message || ""))) {
          content = content.startsWith("__IMG__:") ? content : `__IMG__:${content}`;
          msg = await addMessage(conversation, service.profile.id, "customer_service", content, "text");
          messageType = "text";
        } else {
          throw err;
        }
      }
      const messageRow = msg
        ? Object.assign({}, safeMessage(msg, { [service.profile.id]: service.profile }), {
            senderName: String(service.profile.display_name || "").trim() || "客服",
            messageType: msg.message_type || messageType,
          })
        : null;
      return json(res, 200, { ok: true, message: "消息已发送。", messageRow });
    }
    if (action === "clock_in" || action === "clock_out") {
      const t0 = Date.now();
      const workApi = await import("./_customer-service-work.js");
      // Fast path only: no loadBootstrap / wage / conversation reload.
      const cfg = body.config || body.shiftConfig || null;
      const result =
        action === "clock_in"
          ? await workApi.clockInService(service.profile.id, { config: cfg })
          : await workApi.clockOutService(service.profile.id, { config: cfg });
      if (!result?.meta?.clockInAt && action === "clock_in") {
        return json(res, 500, { ok: false, message: "上班打卡未写入数据库，请重试。" });
      }
      if (action === "clock_out" && !result?.meta?.clockOutAt && !result?.already) {
        return json(res, 500, { ok: false, message: "下班打卡未写入数据库，请重试。" });
      }
      const attendance = result.meta;
      const totalMs = Date.now() - t0;
      return json(res, 200, {
        ok: true,
        message:
          action === "clock_in"
            ? result?.already
              ? "今日已上班打卡。"
              : "上班打卡成功。"
            : result?.already
              ? "今日已下班打卡。"
              : "下班打卡成功。",
        attendance,
        already: !!result?.already,
        persisted: true,
        rowId: result?.row?.id || "",
        elapsedMs: result?.elapsedMs ?? totalMs,
        totalMs,
      });
    }
    if (action === "create_order") {
      const o = body.order || body;
      const rawBossId = String(o.boss_id || o.bossId || o.boss || "").trim();
      const rawBossUid = String(o.boss_uid || o.bossUid || "").trim();
      const bossInput = isUuid(rawBossId) ? rawBossId : (rawBossUid || rawBossId);
      const boss = await resolveBoss(bossInput);
      if (!boss || boss.role !== "boss" || !isUuid(boss.id)) {
        return json(res, 400, { ok: false, message: "请选择真实老板账号（支持老板 UID / UUID）。" });
      }
      const bossId = boss.id;
      const hours = Math.max(0.5, money(o.hours || o.duration || 1) || 1);
      const companionInput = String(o.companion_id || o.companionId || "").trim();
      let companionId = null;
      let unit = 0;
      if (companionInput) {
        const companion = await resolveCompanion(companionInput);
        if (!companion || !isUuid(companion.id)) {
          return json(res, 400, { ok: false, message: "指定陪玩无效，请选择真实陪玩账号（UUID / 陪玩 UID）。" });
        }
        companionId = companion.id;
        const { priceForGame } = await import("./_game-prices.js");
        const cpRows = await supabaseJson(
          restUrl(
            "companion_profiles",
            `?user_id=eq.${encodeURIComponent(companionId)}&select=price,game_prices,tags,game,main_service,service_ids&limit=1`
          ),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const cp = Array.isArray(cpRows) ? cpRows[0] : null;
        const gameName = String(o.game || "").trim();
        unit = money(priceForGame(cp || {}, gameName, String(o.service_id || o.serviceId || "").trim()));
        if (!(unit > 0)) unit = money(cp?.price);
      }
      // Without companion catalog price, CS may quote — but total is always recomputed server-side from unit×hours.
      if (!(unit > 0)) unit = money(o.unit_price || o.unitPrice || o.price);
      const total = Math.round(unit * hours * 100) / 100;
      if (!o.game || (!o.description && !o.title) || total <= 0 || !(unit > 0)) {
        return json(res, 400, { ok: false, message: "请完整填写游戏、需求和金额。" });
      }
      const clientTotal = money(o.total_amount || o.totalAmount || o.amount);
      if (clientTotal > 0 && Math.abs(clientTotal - total) > 0.05) {
        return json(res, 400, { ok: false, message: `金额已按单价×时长重算为 ${total}，请刷新后重试。` });
      }
      const idempotencyKey = String(o.idempotencyKey || o.idempotency_key || "").trim();
      if (idempotencyKey) {
        try {
          const existing = await supabaseJson(
            restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          );
          if (existing?.[0]) {
            return json(res, 200, { ok: true, message: "订单已存在（幂等）。", order: existing[0], deduped: true });
          }
        } catch (_) {
          /* column may be missing */
        }
      }
      const payload = {
        order_no: orderNo("CS"),
        boss_id: bossId,
        companion_id: companionId,
        customer_service_id: service.profile.id,
        order_type: String(o.order_type || o.orderType || "customer_service"),
        game: String(o.game || ""),
        title: String(o.title || o.description || "客服创建订单"),
        description: String(o.description || o.requirements || o.title || ""),
        hours,
        unit_price: unit,
        total_amount: total,
        status: "awaiting_payment",
        created_at: nowIso(),
      };
      if (idempotencyKey) payload.idempotency_key = idempotencyKey;
      let rows;
      try {
        rows = await supabaseJson(restUrl("orders"), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(payload) });
      } catch (insertErr) {
        if (idempotencyKey && /duplicate|unique|idempotency/i.test(String(insertErr.message || ""))) {
          const existing = await supabaseJson(
            restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          ).catch(() => []);
          if (existing?.[0]) return json(res, 200, { ok: true, message: "订单已存在（幂等）。", order: existing[0], deduped: true });
        }
        if (idempotencyKey && /column|schema cache|PGRST/i.test(String(insertErr.message || ""))) {
          const { idempotency_key: _ik, ...rest } = payload;
          rows = await supabaseJson(restUrl("orders"), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(rest) });
        } else {
          throw insertErr;
        }
      }
      const order = rows[0];
      const conversation = await ensureConversation({
        boss_id: bossId,
        companion_id: order.companion_id || null,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      const companionLabel = companionId
        ? (await profileById(companionId).then((p) => p?.display_name).catch(() => "")) || "指定陪玩"
        : "未指定（公开抢单）";
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `新订单已提交，等待支付，指定陪玩为 ${companionLabel}。订单：${order.order_no} / ${order.game} / ${money(order.total_amount).toFixed(2)} 猫粮。`,
        "system",
        order.id
      );
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `订单卡片：${order.order_no} / ${order.game} / ${money(order.total_amount).toFixed(2)} 猫粮。请确认付款。`,
        "order_card",
        order.id
      );
      return json(res, 200, { ok: true, message: "订单已创建，进入待付款。", order });
    }
    if (action === "confirm_payment") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (order.status !== "awaiting_payment") return json(res, 400, { ok: false, message: "只有待付款确认订单可以确认付款。" });
      const amount = money(order.total_amount);
      if (!(amount > 0)) return json(res, 400, { ok: false, message: "订单金额无效，无法确认付款。" });
      // Must debit boss wallet — never mark paid on CS click alone.
      try {
        const walletApi = await import("./_wallet.js");
        await walletApi.debitWallet({
          bossId: order.boss_id,
          amount,
          transactionType: "order_payment",
          idempotencyKey: `order-pay:${order.order_no || order.id}`,
          reason: `客服确认付款 ${order.order_no || order.id}`,
          relatedOrderId: order.id,
          operatorId: service.profile.id,
        });
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (/insufficient|余额不足|not enough/i.test(msg)) {
          return json(res, 400, { ok: false, code: "INSUFFICIENT_BALANCE", message: "老板猫粮余额不足，无法确认付款。请先充值。" });
        }
        if (/idempotency|duplicate|already/i.test(msg)) {
          /* already debited — continue to status transition */
        } else {
          return json(res, e.status || 400, { ok: false, message: msg || "扣款失败，未确认付款。" });
        }
      }
      /* 指定陪玩：claimed→陪玩接单；无陪玩：pending→抢单大厅 */
      const next = order.companion_id ? "claimed" : "pending";
      const { transitionOrderStatus } = await import("./_order-status.js");
      const patched =
        (await transitionOrderStatus(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: order.id,
            filterQuery: `?id=eq.${encodeURIComponent(order.id)}&status=eq.awaiting_payment`,
            fromStatus: "awaiting_payment",
            toStatus: next,
            patch: {
              customer_service_id: service.profile.id,
              ...(next === "claimed" ? { accepted_at: nowIso() } : {}),
            },
            operatorRole: "customer_service",
            operatorId: service.profile.id,
            note: "cs confirm_payment with wallet debit",
          }
        )) || (await patchOrder(order.id, { status: next, customer_service_id: service.profile.id, ...(next === "claimed" ? { accepted_at: nowIso() } : {}) }));
      if (!patched || patched.status === "awaiting_payment") {
        return json(res, 409, { ok: false, message: "订单状态已变更，请刷新后重试。" });
      }
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: order.companion_id,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      const sysMsg = order.companion_id
        ? "客服已确认付款，订单已支付，正在等待陪玩确认接单。"
        : "客服已确认付款，订单已进入抢单大厅。";
      await addMessage(conversation, service.profile.id, "customer_service", sysMsg, "system", order.id);
      let reward = null;
      try {
        reward = await (await import("./_cs-dock-rewards.js")).trySettleDockReward(
          { ...order, ...patched, customer_service_id: service.profile.id, status: next },
          { source: "cs_confirm_payment", forceServiceId: service.profile.id }
        );
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        message: order.companion_id ? "已确认付款，等待陪玩确认接单。" : "已确认付款。",
        order: patched,
        reward,
      });
    }
    if (action === "list_grabs" || action === "grab_applicants") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const { enrichGrabCompanions, parseBossIntent } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
      const intent = parseBossIntent(order);
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      return json(res, 200, {
        ok: true,
        grabCount: enriched.length,
        bossIntent: intent,
        grabs: enriched.map((g) => ({
          ...g,
          bossPreferred: !!(intent && intent.companionId === g.companionId),
          companion: g.companion
            ? { ...g.companion, bossPreferred: !!(intent && intent.companionId === g.companionId) }
            : null,
        })),
        order: safeOrder(order, await profileMap([order.boss_id, order.companion_id, order.customer_service_id]), {
          grabCount: enriched.length,
          grabs: enriched,
          bossIntent: intent,
        }),
      });
    }
    if (action === "assign_companion" || action === "push_companion" || action === "dispatch_companion" || action === "confirm_grab_assignment") {
      const order = await orderById(String(body.id || body.order_id || ""));
      const companion = await resolveCompanion(String(body.companion_id || body.companionId || body.companion_uid || ""));
      if (!order || !companion || !isUuid(companion.id)) return json(res, 400, { ok: false, message: "订单或陪玩不存在。" });
      const companionId = companion.id;
      const lockKey = `${order.id}:${companionId}`;
      if (ASSIGN_LOCKS.get(lockKey) && Date.now() - ASSIGN_LOCKS.get(lockKey) < 8000) {
        return json(res, 409, { ok: false, message: "指定请求处理中，请勿重复点击。" });
      }
      ASSIGN_LOCKS.set(lockKey, Date.now());
      try {
        const { createOrderGrabHelpers } = await import("./_order-grabs.js");
        const { clearBossIntent, parseBossIntent, patchOrderNoteField } = await import("./_order-flow.js");
        const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
        const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
        const fromGrabs =
          body.from_grabs === true ||
          body.fromGrabs === true ||
          action === "confirm_grab_assignment" ||
          ["pending", "waiting_boss_confirm"].includes(order.status);
        if (fromGrabs && grabs.length) {
          const hit = grabs.find((g) => g.companionId === companionId);
          if (!hit) {
            return json(res, 409, { ok: false, message: "只能从已抢单陪玩中指定。请先查看抢单人列表。" });
          }
          if (hit.status === "not_selected") {
            return json(res, 409, { ok: false, message: "该陪玩已被标记为未选中。" });
          }
        }
        // After payment: push companion into claimed (waiting companion confirm). Before payment keep awaiting_payment with companion bound.
        let nextStatus = "claimed";
        if (order.status === "awaiting_payment") nextStatus = "awaiting_payment";
        else if (order.status === "pending" || order.status === "claimed" || order.status === "waiting_boss_confirm") nextStatus = "claimed";
        else if (order.status === "confirmed" || order.status === "in_progress" || order.status === "completed") {
          return json(res, 400, { ok: false, message: "当前订单状态不能重新派单。" });
        }
        const sameAlready =
          String(order.companion_id || "") === companionId &&
          String(order.status || "") === nextStatus &&
          nextStatus === "claimed";
        if (sameAlready) {
          return json(res, 200, {
            ok: true,
            message: "指定成功",
            order: await (async () => {
              const profiles = await profileMap([order.boss_id, companionId, service.profile.id]);
              return safeOrder(order, profiles);
            })(),
            deduped: true,
          });
        }
        if (grabs.length && nextStatus === "claimed") {
          await grabsApi.finalizeGrabSelection(order, companionId);
        }
        const { transitionOrderStatus } = await import("./_order-status.js");
        const deps = { restUrl, supabaseJson, serviceHeaders };
        const patched =
          (await transitionOrderStatus(deps, {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: nextStatus,
            patch: {
              companion_id: companionId,
              customer_service_id: service.profile.id,
              // Do NOT set accepted_at — companion must confirm.
              accepted_at: null,
            },
            operatorRole: "customer_service",
            operatorId: service.profile.id,
            note: `指定陪玩 ${companion.display_name || companion.email || companionId}`,
          })) ||
          (await patchOrder(order.id, {
            companion_id: companionId,
            customer_service_id: service.profile.id,
            status: nextStatus,
            accepted_at: null,
          }));
        try {
          await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, order.id, (text) => clearBossIntent(text));
        } catch {
          /* ignore */
        }
        const conversation = await ensureConversation({
          boss_id: order.boss_id,
          companion_id: companionId,
          customer_service_id: service.profile.id,
          order_id: order.id,
        });
        const companionName = companion.display_name || companion.email || "陪玩";
        const intent = parseBossIntent(order);
        await addMessage(
          conversation,
          service.profile.id,
          "customer_service",
          `客服已确认指定陪玩：${companionName}。订单进入待陪玩确认。${
            intent && intent.companionId === companionId ? "（与老板意向一致）" : intent ? `（老板意向为 ${intent.companionName || "其他陪玩"}）` : ""
          }`,
          "system",
          order.id
        );
        const profiles = await profileMap([patched?.boss_id || order.boss_id, companionId, service.profile.id]);
        return json(res, 200, {
          ok: true,
          message: "指定成功，其他抢单陪玩已标记为未选中。",
          order: safeOrder(patched || { ...order, companion_id: companionId, status: nextStatus }, profiles, {
            grabCount: grabs.length,
          }),
        });
      } finally {
        setTimeout(() => ASSIGN_LOCKS.delete(lockKey), 3000);
      }
    }
    if (action === "update_order_status") {
      const id = String(body.id || body.order_id || "");
      const status = String(body.status || "");
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { assertCsStatusTransition, transitionOrderStatus, CS_STATUS_ACTION_LABELS } = await import("./_order-status.js");
      let transition;
      try {
        transition = assertCsStatusTransition(order.status, status);
      } catch (err) {
        return json(res, err.status || 400, { ok: false, message: err.message || "非法状态跳转。" });
      }
      const patch = { customer_service_id: service.profile.id };
      if (transition.to === "completed") patch.completed_at = nowIso();
      if (transition.to === "cancelled") patch.cancelled_at = nowIso();
      if (transition.to === "in_progress") patch.started_at = order.started_at || nowIso();
      const deps = { restUrl, supabaseJson, serviceHeaders };
      const patched = await transitionOrderStatus(deps, {
        orderId: order.id,
        fromStatus: transition.from,
        toStatus: transition.to,
        patch,
        operatorRole: "customer_service",
        operatorId: service.profile.id,
        note: String(body.note || "客服改状态"),
      });
      const conversation = patched
        ? await ensureConversation({
            boss_id: patched.boss_id,
            companion_id: patched.companion_id,
            customer_service_id: service.profile.id,
            order_id: patched.id,
          })
        : null;
      const label = CS_STATUS_ACTION_LABELS[transition.to] || ORDER_STATUS_TEXT[transition.to] || transition.to;
      await addMessage(conversation, service.profile.id, "customer_service", `订单状态已更新为：${label}`, "system", id);
      let reward = null;
      try {
        const rewardsApi = await import("./_cs-dock-rewards.js");
        if (transition.to === "cancelled" || transition.to === "refunded") {
          reward = await rewardsApi.clawbackOrCancelReward(patched || { ...order, status: transition.to }, {
            reason: transition.to === "refunded" ? "订单退款" : "订单取消",
            mode: transition.to === "refunded" ? "refund" : "cancel",
          });
        } else {
          reward = await rewardsApi.trySettleDockReward(patched || { ...order, status: transition.to }, {
            source: "cs_status_update",
            forceServiceId: service.profile.id,
          });
        }
      } catch (_) {}
      return json(res, 200, { ok: true, message: "订单状态已更新。", order: patched, reward });
    }
    if (action === "allowed_order_statuses") {
      const id = String(body.id || body.order_id || req.query?.id || "").trim();
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { allowedCsNextStatuses, CS_STATUS_ACTION_LABELS } = await import("./_order-status.js");
      const next = allowedCsNextStatuses(order.status);
      const options = {};
      next.forEach((k) => {
        options[k] = CS_STATUS_ACTION_LABELS[k] || ORDER_STATUS_TEXT[k] || k;
      });
      return json(res, 200, {
        ok: true,
        current: order.status,
        currentText: CS_STATUS_ACTION_LABELS[order.status] || ORDER_STATUS_TEXT[order.status] || order.status,
        options,
      });
    }
    if (action === "refund_decision") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order || order.status !== "refund_requested") return json(res, 400, { ok: false, message: "只有退款申请中的订单可以处理退款。" });
      const decision = String(body.decision || "");
      const note = String(body.note || "");
      if (!note) return json(res, 400, { ok: false, message: "退款处理必须填写备注。" });
      if (decision === "approve") {
        const patched = await patchOrder(order.id, { status: "refunded", customer_service_id: service.profile.id });
        try {
          const walletApi = await import("./_wallet.js");
          const amount = money(order.total_amount);
          if (amount > 0) {
            await walletApi.creditWallet({
              bossId: order.boss_id,
              transactionType: "refund",
              amount,
              balanceType: "paid",
              idempotencyKey: `refund-paid:${order.id}`,
              reason: note || "订单退款",
              relatedOrderId: order.id,
              operatorId: service.profile.id,
            });
          }
        } catch (e) {
          await supabaseJson(restUrl("transactions"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify({
              user_id: order.boss_id,
              order_id: order.id,
              transaction_type: "refund",
              amount: money(order.total_amount),
              status: "completed",
              note,
              created_at: nowIso(),
            }),
          }).catch(() => null);
        }
        // Claw back companion income so wallet netGross deducts refunded orders.
        if (order.companion_id) {
          try {
            const incomeRows = await supabaseJson(
              restUrl(
                "transactions",
                `?order_id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(order.companion_id)}&transaction_type=eq.companion_income&status=neq.cancelled&select=id,amount&limit=5`
              ),
              { headers: serviceHeaders() }
            );
            const claw = (incomeRows || []).reduce((n, r) => n + money(r.amount), 0);
            if (claw > 0) {
              const existing = await supabaseJson(
                restUrl(
                  "transactions",
                  `?order_id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(order.companion_id)}&transaction_type=eq.refund&select=id&limit=1`
                ),
                { headers: serviceHeaders() }
              ).catch(() => []);
              if (!(existing || []).length) {
                await supabaseJson(restUrl("transactions"), {
                  method: "POST",
                  headers: serviceHeaders(),
                  body: JSON.stringify({
                    user_id: order.companion_id,
                    order_id: order.id,
                    transaction_type: "refund",
                    amount: claw,
                    status: "completed",
                    note: note || "订单退款扣回陪玩收入",
                    created_at: nowIso(),
                  }),
                });
              }
            }
          } catch (e) {
            /* keep refund approve even if clawback insert fails */
          }
        }
        try {
          const pop = await import("./_popularity.js");
          pop.scheduleRecomputeSoft();
        } catch (e) {
          /* optional */
        }
        let reward = null;
        try {
          reward = await (await import("./_cs-dock-rewards.js")).clawbackOrCancelReward(
            patched || { ...order, status: "refunded" },
            { reason: note || "订单退款，扣回奖励", mode: "refund" }
          );
        } catch (_) {}
        return json(res, 200, { ok: true, message: "退款已批准。", order: patched, reward });
      }
      const restore = ["in_progress", "completed", "cancelled"].includes(String(body.restore_status))
        ? String(body.restore_status)
        : "in_progress";
      const patched = await patchOrder(order.id, { status: restore, customer_service_id: service.profile.id });
      return json(res, 200, { ok: true, message: "退款已拒绝。", order: patched });
    }
    if (action === "submit_report") { return json(res, 400, { ok: false, message: "客服不能自行填写应付工资。请查看工资记录，如有异议请提交申诉。" }); }
    if (action === "appeal_payroll") {
      const payrollId = String(body.payrollId || body.payroll_id || body.id || "").trim();
      const reason = String(body.reason || "").trim();
      if (!payrollId || !reason) return json(res, 400, { ok: false, message: "请选择工资单并填写申诉原因。" });
      const rows = await maybeRows("staff_payrolls", `?id=eq.${encodeURIComponent(payrollId)}&staff_id=eq.${encodeURIComponent(service.profile.id)}&limit=1`);
      if (!rows[0]) return json(res, 404, { ok: false, message: "工资单不存在。" });
      const inserted = await supabaseJson(restUrl("staff_payroll_appeals"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ payroll_id: payrollId, staff_id: service.profile.id, reason, status: "pending", created_at: nowIso() }),
      });
      return json(res, 200, { ok: true, message: "工资申诉已提交，等待管理员处理。", appeal: inserted[0] || null });
    }
    if (action === "apply_compensation") {
      try {
        const settings = await (await import("./_wallet.js")).getWalletSettings();
        if (settings.allow_cs_apply === false) return json(res, 403, { ok: false, message: "系统已关闭客服补偿申请。" });
        const bossInput = String(body.boss_id || body.bossId || body.bossUid || body.boss_uid || "").trim();
        const boss = await resolveBoss(bossInput);
        if (!boss || boss.role !== "boss" || !isUuid(boss.id)) return json(res, 400, { ok: false, message: "请填写真实老板 UID / UUID。" });
        const amount = money(body.suggested_amount || body.suggestedAmount || body.amount);
        const maxReq = money(settings.cs_max_per_request != null ? settings.cs_max_per_request : 100);
        if (amount <= 0) return json(res, 400, { ok: false, message: "建议补偿数量必须大于 0。" });
        if (amount > maxReq) return json(res, 400, { ok: false, message: `单笔申请不能超过 ${maxReq} 猫粮。` });
        const reason = String(body.reason || "").trim();
        if (!reason) return json(res, 400, { ok: false, message: "请填写差评或投诉原因。" });
        const today = new Date().toISOString().slice(0, 10);
        const todayRows = await maybeRows(
          "compensation_requests",
          `?applicant_id=eq.${encodeURIComponent(service.profile.id)}&created_at=gte.${encodeURIComponent(today + "T00:00:00.000Z")}&select=suggested_amount`
        );
        const todaySum = todayRows.reduce((n, r) => n + money(r.suggested_amount), 0);
        const maxDay = money(settings.cs_max_per_day != null ? settings.cs_max_per_day : 300);
        if (todaySum + amount > maxDay) return json(res, 400, { ok: false, message: `今日申请额度不足（上限 ${maxDay}）。` });
        const relatedOrderId = String(body.related_order_id || body.relatedOrderId || body.order_id || "").trim();
        const rows = await supabaseJson(restUrl("compensation_requests"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            boss_id: boss.id,
            related_order_id: isUuid(relatedOrderId) ? relatedOrderId : null,
            request_type: String(body.request_type || body.requestType || "bad_review"),
            suggested_amount: amount,
            balance_type: "bonus",
            reason,
            staff_note: String(body.staff_note || body.staffNote || body.note || ""),
            evidence_urls: String(body.evidence_urls || body.evidenceUrls || ""),
            status: "pending",
            applicant_id: service.profile.id,
            notify_boss: body.notify_boss !== false,
            created_at: nowIso(),
          }),
        });
        return json(res, 200, { ok: true, message: "补偿申请已提交，等待管理员审核。", request: rows[0] || null });
      } catch (error) {
        const real = String(error?.message || error || "").trim();
        const text = `${real} ${JSON.stringify(error?.body || "")}`;
        if (error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text)) {
          // Do NOT swallow the real Supabase error. Compensation failure must not break CS bootstrap/dashboard.
          return json(res, 503, {
            ok: false,
            message:
              "补偿申请表 public.compensation_requests 不存在。请到 Supabase SQL Editor 执行 supabase/service-compensation.sql 后再提交。" +
              (real ? `（Supabase：${real}）` : ""),
            supabaseMessage: real || null,
            table: "compensation_requests",
            sqlFile: "supabase/service-compensation.sql",
          });
        }
        throw error;
      }
    }
    return json(res, 400, { ok: false, message: "未知客服端操作。" }); } catch (error) { return json(res, error.status || 500, { ok: false, message: error.message || "客服端接口异常。" }); } }
export default handler;
