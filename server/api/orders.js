import fs from "node:fs";
import path from "node:path";
import { assertBossProfile, identityView } from "./_boss-identity.js";
import { resolvePlatformCommission } from "./_commission-rates.js";
import { priceForGame } from "./_game-prices.js";
import {
  ORDER_STATUS_LABELS,
  allowPreviewTestPay,
  normalizeOrderStatus,
  orderStatusLabel,
  writeOrderStatusLog,
  transitionOrderStatus,
} from "./_order-status.js";

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
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "orders";
const STATUS_TEXT = ORDER_STATUS_LABELS;
const ORDER_TYPE_TEXT = {
  customer_service: "客服派单",
  direct_companion: "指定陪玩",
  open_grab: "公开抢单",
  custom: "自定义订单",
  gameplay_mall: "固定玩法订单",
  gameplay: "固定玩法订单"
};

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => envValue(key)); }
function anonHeaders(extra = {}) { return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
}
function restUrl(table, query = "") { return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${envValue("SUPABASE_URL")}/auth/v1/${path}`; }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function nowIso() { return new Date().toISOString(); }
function orderNo() { return `MCJ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function paymentMethodLabel(method) {
  const key = String(method || "").toLowerCase();
  if (/tng/.test(key)) return "TNG";
  if (/bank|银行/.test(key)) return "银行卡";
  if (/alipay|支付宝/.test(key)) return "支付宝";
  if (/cat.?food|wallet|猫粮|余额/.test(key)) return "猫粮余额";
  return method || "猫粮余额";
}
function isWalletMethod(method) {
  return /cat.?food|wallet|猫粮|余额/.test(String(method || "").toLowerCase());
}
function isPreviewTestMethod(method) {
  return /tng|bank|银行|card|银行卡|alipay|支付宝/.test(String(method || "").toLowerCase());
}

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
    const detail =
      body?.error_description ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      "";
    const code = body?.code ? ` [${body.code}]` : "";
    const err = new Error((detail ? `${detail}${code}` : `Supabase 请求失败${code} (HTTP ${response.status})`) || "Supabase 请求失败");
    err.status = response.status;
    err.code = body?.code || "";
    err.body = body;
    throw err;
  }
  return body;
}
function isMissingWalletRpc(error) {
  const text = `${error?.message || ""} ${error?.code || ""} ${JSON.stringify(error?.body || {})}`;
  return (
    error?.status === 404 ||
    /Could not find the function|schema cache|PGRST202|function .* does not exist|mcj_wallet_debit/i.test(text)
  );
}
function isWalletBalanceError(error) {
  const text = String(error?.message || "");
  return /余额不足|insufficient balance|wallet is frozen|账户冻结|钱包冻结/i.test(text);
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录后查看我的订单。"), { status: 401, code: "NO_SESSION" });
  const authUser = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  if (!authUser?.id) throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401, code: "EXPIRED" });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号资料加载失败，请重试。"), { status: 403, code: "NO_PROFILE" });
  const boss = await assertBossProfile(profile, {
    lookupOwnedOrder: async (bossId) => {
      const owned = await supabaseJson(
        restUrl(TABLE, `?boss_id=eq.${encodeURIComponent(bossId)}&select=id&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      return !!(Array.isArray(owned) && owned[0]);
    },
  });
  boss._identity = identityView(boss, authUser);
  return boss;
}
function bossHint(row = {}) {
  const status = row.status || "";
  const note = String(row.note || row.cancel_reason || "");
  if (status === "claimed") return "订单已付款，正在等待陪玩确认接单";
  if (status === "confirmed") return "陪玩已确认，可以开始服务";
  if (status === "in_progress") return "服务进行中";
  if (status === "pending" && /陪玩确认超时|确认超时/.test(note)) return "陪玩暂未响应，客服正在处理中";
  if (status === "pending" && /无法接单|拒单/.test(note)) return "陪玩暂时无法接单，客服正在处理中";
  if (status === "pending") return "客服正在重新安排陪玩";
  return "";
}
function paymentStatusLabel(row = {}) {
  const s = row.status || "";
  if (s === "awaiting_payment") return "待付款";
  if (s === "cancelled") return "已取消";
  return "已付款";
}
function acceptStatusLabel(row = {}) {
  const s = row.status || "";
  const note = String(row.note || row.cancel_reason || "");
  if (s === "awaiting_payment") return "尚未付款";
  if (s === "claimed") return "待陪玩确认";
  if (s === "confirmed") return "待开始";
  if (s === "in_progress") return "进行中";
  if (s === "waiting_boss_confirm") return "选择陪玩中";
  if (s === "completed" || s === "reviewed") return "已完成";
  if (s === "pending" && /陪玩确认超时|确认超时/.test(note)) return "陪玩确认超时";
  if (s === "pending" && /无法接单|拒单/.test(note)) return "陪玩无法接单，等待重新安排";
  if (s === "pending") return row.companion_id ? "待接单" : "待接单";
  if (s === "cancelled") return "已取消";
  return STATUS_TEXT[s] || s || "-";
}
function viewOrder(row = {}) {
  const reviewed = !!(row.reviewed || row.review_id || row.reviewId);
  const status = reviewed && row.status === "completed" ? "reviewed" : row.status || "awaiting_payment";
  const description = String(row.description || "");
  const gameIdFromDesc = (description.match(/游戏ID[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const payFromDesc = (description.match(/付款方式[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const companionFromDesc = (description.match(/指定陪玩[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const notesFromDesc = description.split("\n")[0] || "";
  const serviceName = String(row.service_name || row.serviceName || row.game || row.title || "").trim();
  const gameId = String(row.game_id_value || row.game_id || row.gameId || gameIdFromDesc || "").trim();
  const paymentMethod = String(row.payment_method || row.paymentMethod || payFromDesc || "").trim();
  const companionName =
    (row.companion && (row.companion.display_name || row.companion.nickname || row.companion.email)) ||
    row.companion_name ||
    row.companionName ||
    companionFromDesc ||
    "";
  const bossNotes = String(row.notes || "").trim() || notesFromDesc;
  const completionPending =
    String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
    String(row.description || "").includes("[[COMPLETION_PENDING]]");
  let statusText = STATUS_TEXT[status] || STATUS_TEXT[row.status] || row.status || "待付款";
  if (status === "in_progress" && completionPending) statusText = "陪玩已完成，待确认";
  const grabCount = Array.isArray(row.grabs)
    ? row.grabs.length
    : Number(row.grabCount != null ? row.grabCount : row.grab_count || 0) || 0;
  const bossIntent = row.bossIntent || null;
  const flowStatus =
    row.flowStatus ||
    ({
      awaiting_payment: "draft",
      pending: "pending_grab",
      waiting_boss_confirm: "selecting",
      claimed: "pending_companion_confirm",
      confirmed: "confirmed",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    }[status] || status);
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    order_no: row.order_no || row.id,
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    companionName,
    customerServiceId: row.customer_service_id || "",
    orderType: ORDER_TYPE_TEXT[row.order_type] || row.order_type || "自定义订单",
    orderTypeKey: row.order_type || "custom",
    game: row.game || "",
    title: row.title || "",
    description,
    notes: bossNotes,
    bossNotes,
    serviceType: serviceName || row.game || "",
    serviceName: serviceName || row.game || "",
    gameId,
    game_id: gameId,
    paymentMethod: paymentMethod || "线下确认",
    payment_method: paymentMethod || "线下确认",
    hours: Number(row.hours || 0),
    unitPrice: money(row.unit_price),
    totalAmount: money(row.total_amount),
    amount: money(row.total_amount),
    paidCatFood: money(row.paid_cat_food || (status !== "awaiting_payment" && status !== "cancelled" ? row.total_amount : 0)),
    status,
    dbStatus: row.status || "awaiting_payment",
    flowStatus,
    statusText,
    completionPending,
    grabs: row.grabs || [],
    grabCount,
    bossIntent,
    preferredCompanionId: bossIntent?.companionId || "",
    paymentStatus: paymentStatusLabel(row),
    acceptStatus: acceptStatusLabel(row),
    bossHint: bossHint(row),
    cancelReason: row.cancel_reason || "",
    note: row.note || "",
    reviewed,
    reviewId: row.review_id || row.reviewId || "",
    reviewRating: row.review_rating != null ? Number(row.review_rating) : null,
    reviewContent: row.review_content || "",
    canReview: row.status === "completed" && !reviewed && !!row.companion_id,
    createdAt: row.created_at || "",
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
    companion: row.companion
      ? { ...row.companion, display_name: row.companion.display_name || companionName || row.companion.email }
      : companionName
        ? { display_name: companionName }
        : null,
    customerService: row.customerService || null
  };
}
async function loadOrders(profile, id = "") {
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await Promise.race([
      expireCompanionConfirmTimeouts({ limit: 30 }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* best-effort SLA — never block boss list */
  }
  // Core columns + note when available (boss intent / grab markers).
  const selectCore =
    "id,order_no,boss_id,companion_id,customer_service_id,order_type,game,title,description,hours,unit_price,total_amount,status,created_at,accepted_at,started_at,completed_at,cancelled_at";
  const selectRich = selectCore + ",note,cancel_reason";
  const queryOf = (sel) =>
    id
      ? `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&select=${sel}&order=created_at.desc&limit=1`
      : `?boss_id=eq.${encodeURIComponent(profile.id)}&select=${sel}&order=created_at.desc&limit=80`;
  let rows;
  try {
    rows = await supabaseJson(restUrl(TABLE, queryOf(selectRich)), { headers: serviceHeaders() });
  } catch (err) {
    if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    rows = await supabaseJson(restUrl(TABLE, queryOf(selectCore)), { headers: serviceHeaders() });
  }
  const orders = Array.isArray(rows) ? rows : [];
  const companionIds = [...new Set(orders.map((row) => row.companion_id).filter(Boolean))];
  const serviceIds = [...new Set(orders.map((row) => row.customer_service_id).filter(Boolean))];
  const orderIds = orders.map((row) => row.id).filter(Boolean);

  const [companions, services, reviews] = await Promise.all([
    companionIds.length
      ? supabaseJson(
          restUrl("profiles", `?id=in.(${companionIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,avatar_url,role`),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    serviceIds.length
      ? supabaseJson(
          restUrl("profiles", `?id=in.(${serviceIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,role`),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    orderIds.length
      ? supabaseJson(
          restUrl(
            "companion_reviews",
            `?order_id=in.(${orderIds.map(encodeURIComponent).join(",")})&boss_id=eq.${encodeURIComponent(profile.id)}&select=id,order_id,rating,content,created_at&order=created_at.desc&limit=200`
          ),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const companionMap = Object.fromEntries((companions || []).map((p) => [p.id, p]));
  const serviceMap = Object.fromEntries((services || []).map((p) => [p.id, p]));
  const reviewByOrder = {};
  for (const rev of Array.isArray(reviews) ? reviews : []) {
    if (rev?.order_id && !reviewByOrder[rev.order_id]) reviewByOrder[rev.order_id] = rev;
  }
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const { enrichGrabCompanions, parseBossIntent, toFlowStatus, isOrderExpired } = await import("./_order-flow.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });

  const grabEligible = orders.filter((row) =>
    ["waiting_boss_confirm", "pending", "claimed", "confirmed"].includes(row.status)
  );
  const grabNoteMap = Object.fromEntries(grabEligible.map((row) => [row.id, row.note || row.description || ""]));
  const grabMapRaw = await grabsApi.listGrabsBatch(
    grabEligible.map((row) => row.id),
    grabNoteMap
  );
  const allGrabsFlat = grabEligible.flatMap((row) => grabMapRaw[row.id] || []);
  const enrichedAll = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, allGrabsFlat).catch(() => allGrabsFlat);
  const enrichedById = Object.fromEntries((enrichedAll || []).map((g) => [String(g.id || g.grabId || `${g.orderId}:${g.companionId}`), g]));

  async function grabsFor(row) {
    if (!["waiting_boss_confirm", "pending", "claimed", "confirmed"].includes(row.status)) return [];
    try {
      const grabs = grabMapRaw[row.id] || [];
      const intent = parseBossIntent(row);
      return grabs.map((g) => {
        const key = String(g.id || g.grabId || `${g.orderId}:${g.companionId}`);
        const enriched = enrichedById[key] || g;
        return {
          ...enriched,
          companion: enriched.companion
            ? { ...enriched.companion, bossPreferred: !!(intent && intent.companionId === enriched.companionId) }
            : null,
          bossPreferred: !!(intent && intent.companionId === enriched.companionId),
        };
      });
    } catch {
      return [];
    }
  }

  // Parallelize grab enrichment so list GET stays under Preview cold-start budgets.
  const grabLists = await Promise.all(orders.map((row) => grabsFor(row)));
  return orders.map((row, index) => {
    const rev = reviewByOrder[row.id];
    const grabs = grabLists[index] || [];
    const intent = parseBossIntent(row);
    return viewOrder({
      ...row,
      grabs,
      grabCount: grabs.length,
      bossIntent: intent,
      flowStatus: toFlowStatus(row.status, { expired: isOrderExpired(row) }),
      companion: companionMap[row.companion_id] || null,
      customerService: serviceMap[row.customer_service_id] || null,
      reviewed: !!rev,
      review_id: rev?.id || "",
      review_rating: rev?.rating,
      review_content: rev?.content || "",
    });
  });
}
async function ensureConversation(order, bossId) {
  const existing = await supabaseJson(restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`), { headers: serviceHeaders() });
  if (existing?.[0]) {
    // Keep 1:1 order_id binding; refresh updated_at so CS list sorts correctly.
    try {
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ updated_at: nowIso() }),
      });
    } catch (_) {}
    return existing[0];
  }
  const base = {
    boss_id: bossId,
    companion_id: order.companion_id || null,
    customer_service_id: order.customer_service_id || null,
    order_id: order.id,
    status: "open",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const rich = { ...base, conversation_type: "order_support", last_message_at: nowIso() };
  try {
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(rich),
    });
    return rows?.[0] || null;
  } catch (err) {
    if (!/conversation_type|last_message_at|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(base),
    });
    return rows?.[0] || null;
  }
}
async function touchConversation(conversationId, patch = {}) {
  if (!conversationId) return;
  const body = { updated_at: nowIso(), ...patch };
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ ...body, last_message_at: body.updated_at }),
    });
  } catch (err) {
    if (!/last_message_at|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ updated_at: body.updated_at }),
    });
  }
}
async function addSystemMessage(order, bossId, content) {
  const conversation = await ensureConversation(order, bossId);
  if (!conversation) return;
  await supabaseJson(restUrl("messages"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      conversation_id: conversation.id,
      sender_id: bossId,
      sender_role: "boss",
      message_type: "system",
      content,
      order_id: order.id,
      created_at: nowIso(),
    }),
  });
  await touchConversation(conversation.id);
}
async function patchOwnedOrder(profile, id, allowedStatuses, patch, message) {
  const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  if (allowedStatuses && !allowedStatuses.includes(before.status)) throw Object.assign(new Error("当前订单状态不能执行该操作。"), { status: 409 });
  const nextStatus = patch.status ? normalizeOrderStatus(patch.status) : before.status;
  const body = { ...patch, ...(patch.status ? { status: nextStatus } : {}) };
  const rows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(body) });
  const saved = rows?.[0] || { ...before, ...body };
  if (patch.status && patch.status !== before.status) {
    await writeOrderStatusLog(
      { restUrl, supabaseJson, serviceHeaders },
      {
        orderId: id,
        fromStatus: before.status,
        toStatus: nextStatus,
        operatorRole: "boss",
        operatorId: profile.id,
        note: message || "",
      }
    );
  }
  if (message) await addSystemMessage(saved, profile.id, message);
  return viewOrder(saved);
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, configured: false, message: "未配置 Supabase，老板订单不能读取或保存真实数据库。" });
  }
  try {
    const profile = await profileFromToken(req);
    if (req.method === "GET") {
      const orders = await loadOrders(profile, String(req.query.id || ""));
      return json(res, 200, {
        ok: true,
        configured: true,
        orders,
        statusText: STATUS_TEXT,
        identity: profile._identity || null,
        allowTestPay: allowPreviewTestPay(),
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "create");
    if (action === "create" || action === "place_order") {
      const order = body.order || body;
      let companionId = String(order.companion_id || order.companionId || body.companionId || "").trim();
      if (action === "place_order" && !companionId) {
        return json(res, 400, { ok: false, message: "缺少陪玩信息，无法下单。" });
      }
      const quantity = Math.max(1, Math.floor(money(order.quantity || 1) || 1));
      const baseHours = Math.max(0.5, money(order.hours || order.duration || 1));
      const hours = Math.round(baseHours * quantity * 100) / 100;
      const serviceType = String(order.serviceType || order.service_type || order.serviceName || order.service || "陪玩").trim() || "陪玩";
      const companionName = String(order.companionName || order.companion_name || "").trim();
      const gameId = String(order.gameId || order.game_id || order.gameIdValue || order.game_id_value || "").trim();
      const couponCode = String(order.couponCode || order.coupon || "").trim();
      const paymentMethod = String(order.paymentMethod || order.payment_method || "catfood").trim().toLowerCase();
      const notes = String(order.notes || order.remark || order.description || "").trim();
      const game = String(order.game || serviceType || "陪玩").trim();
      let unitPrice = 0;
      let totalAmount = 0;

      if (companionId) {
        let companions = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(companionId)}&limit=1`), { headers: serviceHeaders() });
        let companion = Array.isArray(companions) ? companions[0] : null;
        if (!companion || companion.role !== "companion") {
          try {
            const cpRows = await supabaseJson(
              restUrl("companion_profiles", `?id=eq.${encodeURIComponent(companionId)}&select=id,user_id&limit=1`),
              { headers: serviceHeaders() }
            );
            const userId = Array.isArray(cpRows) && cpRows[0] ? cpRows[0].user_id : "";
            if (userId) {
              companions = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`), { headers: serviceHeaders() });
              companion = Array.isArray(companions) ? companions[0] : null;
              if (companion && companion.role === "companion") companionId = companion.id;
            }
          } catch (_) {
            /* keep original 404 path */
          }
        }
        if (!companion || companion.role !== "companion") {
          return json(res, 404, { ok: false, message: "指定陪玩不存在或不可下单。" });
        }
      }

      if (action === "place_order") {
        if (!gameId) return json(res, 400, { ok: false, message: "请填写游戏 ID。" });
        // Server-authoritative unit price from companion_profiles — never trust client unit/total.
        const cpRows = await supabaseJson(
          restUrl(
            "companion_profiles",
            `?user_id=eq.${encodeURIComponent(companionId)}&select=price,game_prices,tags,game,main_service,service_ids,pricing_unit&limit=1`
          ),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const cp = Array.isArray(cpRows) ? cpRows[0] : null;
        const serviceId = String(order.serviceId || order.service_id || "").trim();
        unitPrice = money(priceForGame(cp || {}, game, serviceId));
        if (!(unitPrice > 0)) unitPrice = money(cp?.price);
        if (!(unitPrice > 0)) return json(res, 400, { ok: false, message: "陪玩单价无效，请刷新后重试。" });
        totalAmount = Math.round(unitPrice * hours * 100) / 100;
        const clientUnit = money(order.unit_price || order.unitPrice || order.price || order.budget || 0);
        const clientTotal = money(order.total_amount || order.totalAmount);
        if (clientUnit > 0 && Math.abs(clientUnit - unitPrice) > 0.05) {
          return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（单价 ${unitPrice}）` });
        }
        if (clientTotal > 0 && Math.abs(clientTotal - totalAmount) > 0.05) {
          return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（应付 ${totalAmount}）` });
        }
        if (!(totalAmount > 0)) return json(res, 400, { ok: false, message: "订单金额无效。" });
      } else {
        if (!order.game || (!order.description && !order.requirements && !order.title)) {
          return json(res, 400, { ok: false, message: "请填写游戏和需求说明。" });
        }
        unitPrice = money(order.unit_price || order.unitPrice || order.price || order.budget || 0);
        totalAmount = money(order.total_amount || order.totalAmount);
        if (!(totalAmount > 0)) totalAmount = Math.round(unitPrice * hours * 100) / 100;
      }

      const useWallet = action === "place_order" && isWalletMethod(paymentMethod);
      // 统一支付链路：下单只创建待付款订单，真正支付在 payment-confirm 完成。
      let status = "awaiting_payment";
      const title = companionName
        ? `${serviceType} · ${companionName} · ${hours}小时`
        : String(order.title || `${serviceType} · ${hours}小时`);
      const descriptionParts =
        action === "place_order"
          ? [
              notes || `${serviceType}订单`,
              gameId ? `游戏ID：${gameId}` : "",
              couponCode ? `优惠券：${couponCode}` : "",
              `付款方式：${paymentMethodLabel(paymentMethod)}`,
              companionName ? `指定陪玩：${companionName}` : "",
            ].filter(Boolean)
          : [
              String(order.description || order.requirements || order.service_content || notes || ""),
              gameId && !String(order.description || "").includes("游戏ID") ? `游戏ID：${gameId}` : "",
            ].filter(Boolean);

      const row = {
        order_no: orderNo(),
        boss_id: profile.id,
        companion_id: companionId || null,
        customer_service_id: null,
        order_type: companionId ? "direct_companion" : String(order.order_type || order.orderType || "custom"),
        game: action === "place_order" ? game : String(order.game || game || ""),
        title: action === "place_order" ? title : String(order.title || "自定义订单"),
        description: descriptionParts.join("\n"),
        hours,
        unit_price: unitPrice,
        total_amount: totalAmount,
        status,
        created_at: nowIso()
      };
      // Optional marketplace columns (ignore if schema missing).
      const enriched = {
        ...row,
        service_name: serviceType,
        game_id_value: gameId || String(order.game_id || "").trim(),
        notes: notes || descriptionParts.join("\n"),
        quantity,
        pricing_unit: String(order.pricingUnit || order.pricing_unit || "小时"),
      };
      let rows;
      try {
        rows = await supabaseJson(restUrl(TABLE), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(enriched) });
      } catch (insertErr) {
        if (!/column|schema cache|PGRST/i.test(String(insertErr.message || ""))) throw insertErr;
        rows = await supabaseJson(restUrl(TABLE), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(row) });
      }
      let saved = rows?.[0] || enriched;

      const companionLabel = companionName || companionId || "未指定（公开抢单）";
      const notify = `新订单已提交，等待支付，指定陪玩为 ${companionLabel}。支付方式：${paymentMethodLabel(paymentMethod)}；服务：${serviceType}；时长：${hours}小时；金额：${totalAmount} 猫粮。`;
      await addSystemMessage(saved, profile.id, notify);
      const okMessage = useWallet ? "订单已创建，请完成支付。" : "订单已提交，请完成支付。";
      return json(res, 200, {
        ok: true,
        message: okMessage,
        order: viewOrder(saved),
      });
    }
    const id = String(body.id || body.order_id || body.orderId || "");
    if (!id) return json(res, 400, { ok: false, message: "缺少订单 ID。" });
    if (action === "pay_order") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (normalizeOrderStatus(before.status) !== "awaiting_payment") {
        return json(res, 409, { ok: false, message: "当前订单无需再次支付。", order: viewOrder(before) });
      }
      const paymentMethod = String(body.paymentMethod || body.payment_method || viewOrder(before).paymentMethod || "").trim().toLowerCase();
      const previewTest =
        String(body.preview_test || body.previewTest || "").trim() === "1" ||
        String(body.test_pay || "").trim() === "1";
      const previewAllowed = allowPreviewTestPay();
      if (previewTest && !previewAllowed) {
        return json(res, 403, { ok: false, message: "正式环境不允许使用测试支付。" });
      }

      let usedTestPay = false;
      if (isWalletMethod(paymentMethod) && !previewTest) {
        try {
          const walletApi = await import("./_wallet.js");
          await walletApi.debitWallet({
            bossId: profile.id,
            amount: money(before.total_amount),
            transactionType: "order_payment",
            idempotencyKey: `order-pay:${before.order_no || before.id}`,
            reason: `订单支付 ${before.order_no || before.id}`,
            relatedOrderId: before.id,
            operatorId: profile.id,
          });
        } catch (e) {
          // Preview: wallet missing / empty → allow explicit TEST pay only (never silent fake).
          if (previewAllowed && (isMissingWalletRpc(e) || isWalletBalanceError(e))) {
            return json(res, 400, {
              ok: false,
              code: "USE_TEST_PAY",
              message: "猫粮支付不可用或余额不足。Preview 请点击「测试支付成功（TEST）」完成状态流转。",
              allowTestPay: true,
            });
          }
          if (isMissingWalletRpc(e)) {
            return json(res, 503, { ok: false, code: "WALLET_UNAVAILABLE", message: "猫粮支付暂不可用" });
          }
          if (isWalletBalanceError(e)) {
            return json(res, 400, { ok: false, code: "INSUFFICIENT_BALANCE", message: e.message || "猫粮余额不足", rechargeUrl: "/recharge.html" });
          }
          throw e;
        }
      } else if (previewTest && previewAllowed) {
        usedTestPay = true;
      } else if (!isPreviewTestMethod(paymentMethod)) {
        if (previewAllowed) {
          return json(res, 400, {
            ok: false,
            code: "USE_TEST_PAY",
            message: "当前支付方式未接通真实网关。Preview 请使用「测试支付成功（TEST）」。",
            allowTestPay: true,
          });
        }
        return json(res, 400, { ok: false, message: "当前支付方式不支持自动支付，请联系客服确认。" });
      } else if (!previewAllowed) {
        return json(res, 400, { ok: false, message: "正式环境请使用已接通的支付渠道。" });
      } else {
        usedTestPay = true;
      }

      const nextStatus = before.companion_id ? "claimed" : "pending";
      const acceptedAt = nextStatus === "claimed" ? nowIso() : null;
      const deps = { restUrl, supabaseJson, serviceHeaders };
      let saved;
      try {
        saved = await transitionOrderStatus(deps, {
          orderId: before.id,
          filterQuery: `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&status=eq.awaiting_payment`,
          fromStatus: before.status,
          toStatus: nextStatus,
          patch: { accepted_at: acceptedAt },
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success" : "boss wallet/gateway pay success",
        });
      } catch (e) {
        // Retry without accepted_at if column missing (should not happen on init.sql).
        if (!/accepted_at|column|schema cache|PGRST/i.test(String(e.message || ""))) throw e;
        saved = await transitionOrderStatus(deps, {
          orderId: before.id,
          filterQuery: `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&status=eq.awaiting_payment`,
          fromStatus: before.status,
          toStatus: nextStatus,
          patch: {},
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success" : "boss pay success",
        });
      }
      if (!saved) {
        const again = await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
          { headers: serviceHeaders() }
        );
        saved = again?.[0] || { ...before, status: nextStatus, accepted_at: acceptedAt };
        await writeOrderStatusLog(deps, {
          orderId: before.id,
          fromStatus: before.status,
          toStatus: nextStatus,
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success (empty patch return)" : "boss pay success",
        });
      }

      const companionLabel =
        viewOrder(saved).companionName ||
        saved.companion_id ||
        (before.companion_id ? "指定陪玩" : "公开抢单");
      try {
        await addSystemMessage(
          saved,
          profile.id,
          nextStatus === "claimed"
            ? `${usedTestPay ? "[TEST] " : ""}订单已支付，指定陪玩为 ${companionLabel}，等待陪玩确认。`
            : `${usedTestPay ? "[TEST] " : ""}订单已支付，已进入待客服安排 / 公开抢单。`
        );
      } catch (_) {
        /* chat soft-fail — status already persisted */
      }
      let reward = null;
      try {
        reward = await (await import("./_cs-dock-rewards.js")).trySettleDockReward(saved, {
          source: usedTestPay ? "boss_test_pay" : "boss_pay",
        });
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        testPay: usedTestPay,
        message: usedTestPay
          ? nextStatus === "claimed"
            ? "测试支付成功（TEST）。订单已进入等待陪玩确认。"
            : "测试支付成功（TEST）。订单已进入待客服安排。"
          : nextStatus === "claimed"
            ? "支付成功，订单已进入等待陪玩确认。"
            : "支付成功，订单已进入待客服安排。",
        order: viewOrder(saved),
        allowTestPay: previewAllowed,
        reward,
      });
    }
    if (action === "list_grabs" || action === "grab_applicants") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(before.id, before.note || before.description || "");
      const companionIds = [...new Set(grabs.map((g) => g.companionId).filter(Boolean))];
      let companions = [];
      if (companionIds.length) {
        const profiles = await supabaseJson(
          restUrl("profiles", `?id=in.(${companionIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,avatar_url`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const cps = await supabaseJson(
          restUrl("companion_profiles", `?user_id=in.(${companionIds.map(encodeURIComponent).join(",")})`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const pMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
        const cMap = Object.fromEntries((cps || []).map((c) => [c.user_id, c]));
        companions = companionIds.map((cid) => {
          const p = pMap[cid] || {};
          const c = cMap[cid] || {};
          return {
            id: cid,
            nickname: c.nickname || p.display_name || p.email || "陪玩",
            avatarUrl: c.avatar_url || p.avatar_url || "",
            level: c.level_name || "",
            onlineStatus: c.online_status || "offline",
            price: money(c.price),
            tags: c.tags || c.tag_list || "",
            mainGame: c.game || c.main_game || "",
            rating: money(c.rating || c.score || 0),
            completedOrders: Number(c.completed_orders || c.order_count || 0) || 0,
            voiceUrl: c.voice_url || c.voice_sample_url || "",
          };
        });
      }
      return json(res, 200, {
        ok: true,
        grabs: grabs.map((g) => ({
          ...g,
          companion: companions.find((c) => c.id === g.companionId) || null,
        })),
        order: viewOrder(before),
      });
    }
    if (action === "confirm_companion" || action === "select_grabber" || action === "set_boss_intent") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (!["waiting_boss_confirm", "pending"].includes(before.status)) {
        return json(res, 409, { ok: false, message: "当前订单状态不能选择意向陪玩。" });
      }
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const {
        enrichGrabCompanions,
        parseBossIntent,
        withBossIntent,
        patchOrderNoteField,
        toFlowStatus,
      } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(before.id, before.note || before.description || "");
      // Boss intent only — never auto-lock companion; CS must confirm.
      let selectedId = String(body.companion_id || body.companionId || body.grab_companion_id || "").trim();
      const grabId = String(body.grab_id || body.grabId || "").trim();
      if (!selectedId && grabId) {
        selectedId = (grabs.find((g) => g.grabId === grabId || g.id === grabId) || {}).companionId || "";
      }
      if (!selectedId) {
        return json(res, 400, { ok: false, message: "请手动选择一位抢单陪玩作为意向。" });
      }
      const pendingOk = grabs.some((g) => g.companionId === selectedId && g.status === "pending_customer_selection");
      if (!pendingOk && grabs.length) {
        return json(res, 409, { ok: false, message: "该陪玩未抢单或状态无效，请从抢单列表中选择。" });
      }
      if (!grabs.length) {
        return json(res, 409, { ok: false, message: "暂无陪玩抢单，请等待陪玩申请后再选择。" });
      }
      // Keep selecting: pending → waiting_boss_confirm if needed; do NOT bind companion_id.
      let order = before;
      if (before.status === "pending") {
        const rows = await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "waiting_boss_confirm" }),
          }
        );
        order = rows?.[0] || { ...before, status: "waiting_boss_confirm" };
        await writeOrderStatusLog(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: id,
            fromStatus: before.status,
            toStatus: "waiting_boss_confirm",
            operatorRole: "boss",
            operatorId: profile.id,
            note: "boss intent selection opened selecting state",
          }
        );
      }
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      const pick = enriched.find((g) => g.companionId === selectedId);
      const pickName = pick?.companion?.nickname || "陪玩";
      order = await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, id, (text) =>
        withBossIntent(text, {
          companion_id: selectedId,
          companion_name: pickName,
          at: nowIso(),
          by: "boss",
        })
      );
      await addSystemMessage(
        order,
        profile.id,
        `老板选择了陪玩 ${pickName}（意向）。请客服确认指定后，订单才会锁定。`
      );
      const intent = parseBossIntent(order);
      const marked = enriched.map((g) => ({
        ...g,
        bossPreferred: g.companionId === selectedId,
        companion: g.companion ? { ...g.companion, bossPreferred: g.companionId === selectedId } : null,
      }));
      return json(res, 200, {
        ok: true,
        message: `已提交意向：${pickName}。等待客服确认指定。`,
        intentOnly: true,
        order: viewOrder({
          ...order,
          status: order.status || "waiting_boss_confirm",
          companion_id: null,
          grabs: marked,
          grabCount: marked.length,
          bossIntent: intent,
          flowStatus: toFlowStatus(order.status || "waiting_boss_confirm"),
        }),
      });
    }
    if (action === "reject_companion") {
      const order = await patchOwnedOrder(profile, id, ["waiting_boss_confirm", "pending"], { status: "pending", companion_id: null, accepted_at: null }, "老板已选择换一个陪玩，请客服重新安排。");
      return json(res, 200, { ok: true, message: "已选择换一个陪玩，客服将重新安排。", order });
    }
    if (action === "confirm_completion" || action === "confirm_complete") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (before.status !== "in_progress") {
        return json(res, 409, { ok: false, message: "当前订单不能确认完成。" });
      }
      if (/refunded|refund_requested|cancelled/.test(String(before.status || ""))) {
        return json(res, 409, { ok: false, message: "订单已退款或取消，不能结算。" });
      }
      if (String(before.settlement_status || "") === "settled") {
        return json(res, 200, {
          ok: true,
          message: "订单已结算，无需重复结算。",
          order: viewOrder(before),
          duplicate: true,
        });
      }
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      if (!grabsApi.orderHasCompletionPending(before)) {
        return json(res, 409, { ok: false, message: "陪玩尚未申请完成服务。" });
      }
      const completedAt = nowIso();
      await grabsApi.clearCompletionPending(before);
      let rows;
      try {
        rows = await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&status=eq.in_progress`),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ status: "completed", completed_at: completedAt }) }
        );
      } catch (err) {
        throw err;
      }
      const saved = rows?.[0] || { ...before, status: "completed", completed_at: completedAt };
      await addSystemMessage(saved, profile.id, "老板已确认完成订单。");
      if (saved.companion_id) {
        try {
          const existingTx = await supabaseJson(
            restUrl(
              "transactions",
              `?order_id=eq.${encodeURIComponent(saved.id)}&user_id=eq.${encodeURIComponent(saved.companion_id)}&transaction_type=eq.companion_income&limit=1`
            ),
            { headers: serviceHeaders() }
          ).catch(() => []);
          if (!existingTx?.[0]) {
            const cp = (
              await supabaseJson(
                restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(saved.companion_id)}&limit=1`),
                { headers: serviceHeaders() }
              ).catch(() => [])
            )?.[0] || {};
            const amount = money(saved.total_amount);
            const { platformRate, companionShareRate } = resolvePlatformCommission(cp.commission_rate, 20);
            const companionNet = Math.round((amount * companionShareRate) / 100 * 100) / 100;
            const platformFee = Math.round((amount - companionNet) * 100) / 100;
            const settlement = {
              orderId: saved.id,
              orderNo: saved.order_no,
              companionNetCatFood: companionNet,
              platformCommissionCatFood: platformFee,
              platformCommissionRate: platformRate,
              companionShareRate,
              completedAt,
            };
            await supabaseJson(restUrl("transactions"), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify({
                user_id: saved.companion_id,
                order_id: saved.id,
                transaction_type: "companion_income",
                amount: companionNet,
                status: "completed",
                note: `MCJ_SETTLEMENT:${JSON.stringify(settlement)}`,
                created_at: completedAt,
              }),
            });
            try {
              await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(saved.id)}`), {
                method: "PATCH",
                headers: serviceHeaders(),
                body: JSON.stringify({
                  settlement_note: `MCJ_SETTLEMENT:${JSON.stringify(settlement)}`,
                  companion_income: companionNet,
                  platform_fee: platformFee,
                  settlement_status: "settled",
                }),
              });
            } catch (_) {}
          }
        } catch (_) {}
      }
      let reward = null;
      try {
        reward = await (await import("./_cs-dock-rewards.js")).trySettleDockReward(
          { ...saved, status: "completed" },
          { source: "boss_confirm_complete" }
        );
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        message: "已确认完成，订单已完成。",
        order: viewOrder(saved),
        reward,
      });
    }
    if (action === "cancel_order") {
      const order = await patchOwnedOrder(profile, id, ["awaiting_payment", "pending", "claimed", "waiting_boss_confirm", "confirmed"], { status: "cancelled", cancelled_at: nowIso() }, "老板已取消订单。");
      try {
        await (await import("./_cs-dock-rewards.js")).clawbackOrCancelReward(
          { id: order?.id || id, status: "cancelled" },
          { reason: "老板取消订单", mode: "cancel" }
        );
      } catch (_) {}
      return json(res, 200, { ok: true, message: "订单已取消。", order });
    }
    if (action === "request_refund") {
      const order = await patchOwnedOrder(profile, id, ["confirmed", "in_progress", "completed"], { status: "refund_requested" }, "老板已申请退款，等待客服处理。");
      return json(res, 200, { ok: true, message: "退款申请已提交。", order });
    }
    if (action === "submit_review") {
      const beforeRows = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const order = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (String(order.status) !== "completed") return json(res, 400, { ok: false, message: "只有已完成订单可以评价。" });
      if (!order.companion_id) return json(res, 400, { ok: false, message: "该订单没有可评价的陪玩。" });
      const rating = Math.max(1, Math.min(5, Number(body.rating || body.stars || 0) || 0));
      if (!(rating >= 1 && rating <= 5)) return json(res, 400, { ok: false, message: "请选择 1-5 星评分。" });
      const content = String(body.content || body.comment || body.note || "").trim();
      const existing = await supabaseJson(
        restUrl(
          "companion_reviews",
          `?order_id=eq.${encodeURIComponent(order.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&select=id&limit=1`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      if (Array.isArray(existing) && existing[0]) {
        return json(res, 200, {
          ok: true,
          message: "该订单已评价。",
          review: existing[0],
          already: true,
          order: viewOrder({
            ...order,
            reviewed: true,
            review_id: existing[0].id,
            review_rating: existing[0].rating,
            review_content: existing[0].content || "",
          }),
        });
      }
      let rows;
      try {
        rows = await supabaseJson(restUrl("companion_reviews"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            order_id: order.id,
            boss_id: profile.id,
            companion_id: order.companion_id,
            rating,
            content,
            status: "published",
            created_at: nowIso(),
          }),
        });
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (/companion_reviews|schema cache|PGRST|does not exist/i.test(msg)) {
          return json(res, 503, {
            ok: false,
            message: "评价表未初始化。请在 Supabase 执行 supabase/popularity-ranking.sql。",
          });
        }
        throw e;
      }
      try {
        const pop = await import("./_popularity.js");
        if (typeof pop.scheduleRecomputeSoft === "function") pop.scheduleRecomputeSoft();
      } catch (_) {}
      const review = rows?.[0] || null;
      return json(res, 200, {
        ok: true,
        message: "评价已提交。",
        review,
        order: viewOrder({
          ...order,
          reviewed: true,
          review_id: review?.id || "",
          review_rating: rating,
          review_content: content,
        }),
      });
    }
    return json(res, 400, { ok: false, message: "未知订单操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "订单接口异常" });
  }
}







