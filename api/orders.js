import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnv();

function loadLocalEnv() {
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(apiDir, "..", ".env.local");
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
}const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "orders";
const STATUS_TEXT = {
  awaiting_payment: "待付款",
  pending: "待客服安排",
  claimed: "待客服安排",
  waiting_boss_confirm: "待我确认",
  confirmed: "进行中",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "售后"
};

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => envValue(key)); }
function anonHeaders(extra = {}) { return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) { const key = envValue("SUPABASE_SERVICE_ROLE_KEY"); const base = { apikey: key, "Content-Type": "application/json", Prefer: "return=representation", "User-Agent": "MCJ-Server/1.0", ...extra }; if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`; return base; }
function restUrl(table, query = "") { return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${envValue("SUPABASE_URL")}/auth/v1/${path}`; }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function nowIso() { return new Date().toISOString(); }
function orderNo() { return `MCJ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

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
  if (!response.ok) throw new Error(body?.error_description || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || "Supabase 请求失败");
  return body;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号。"), { status: 401 });
  const authUser = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403 });
  if (profile.role !== "boss") throw Object.assign(new Error("只有老板账号可以执行该操作。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("老板账号未启用。"), { status: 403 });
  return profile;
}
function viewOrder(row = {}) {
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    order_no: row.order_no || row.id,
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    customerServiceId: row.customer_service_id || "",
    orderType: row.order_type || "custom",
    game: row.game || "",
    title: row.title || "",
    description: row.description || "",
    hours: Number(row.hours || 0),
    unitPrice: money(row.unit_price),
    totalAmount: money(row.total_amount),
    amount: money(row.total_amount),
    status: row.status || "awaiting_payment",
    statusText: STATUS_TEXT[row.status] || row.status || "待付款确认",
    createdAt: row.created_at || "",
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
    companion: row.companion || null,
    customerService: row.customerService || null
  };
}
async function loadOrders(profile, id = "") {
  const query = id
    ? `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=1`
    : `?boss_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=200`;
  const rows = await supabaseJson(restUrl(TABLE, query), { headers: serviceHeaders() });
  const orders = Array.isArray(rows) ? rows : [];
  const companionIds = [...new Set(orders.map((row) => row.companion_id).filter(Boolean))];
  const serviceIds = [...new Set(orders.map((row) => row.customer_service_id).filter(Boolean))];
  let companions = [];
  let services = [];
  if (companionIds.length) companions = await supabaseJson(restUrl("profiles", `?id=in.(${companionIds.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() });
  if (serviceIds.length) services = await supabaseJson(restUrl("profiles", `?id=in.(${serviceIds.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() });
  const companionMap = Object.fromEntries((companions || []).map((p) => [p.id, p]));
  const serviceMap = Object.fromEntries((services || []).map((p) => [p.id, p]));
  return orders.map((row) => viewOrder({ ...row, companion: companionMap[row.companion_id] || null, customerService: serviceMap[row.customer_service_id] || null }));
}
async function ensureConversation(order, bossId) {
  const existing = await supabaseJson(restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`), { headers: serviceHeaders() });
  if (existing?.[0]) return existing[0];
  const rows = await supabaseJson(restUrl("conversations"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ boss_id: bossId, companion_id: order.companion_id || null, customer_service_id: order.customer_service_id || null, order_id: order.id, status: "open", created_at: nowIso(), updated_at: nowIso() })
  });
  return rows?.[0] || null;
}
async function addSystemMessage(order, bossId, content) {
  const conversation = await ensureConversation(order, bossId);
  if (!conversation) return;
  await supabaseJson(restUrl("messages"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ conversation_id: conversation.id, sender_id: bossId, sender_role: "boss", message_type: "system", content, order_id: order.id, created_at: nowIso() })
  });
}
async function patchOwnedOrder(profile, id, allowedStatuses, patch, message) {
  const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  if (allowedStatuses && !allowedStatuses.includes(before.status)) throw Object.assign(new Error("当前订单状态不能执行该操作。"), { status: 409 });
  const rows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) });
  const saved = rows?.[0] || { ...before, ...patch };
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
      return json(res, 200, { ok: true, configured: true, orders, statusText: STATUS_TEXT });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "create");
    if (action === "create") {
      const order = body.order || body;
      const hours = Math.max(1, money(order.hours || order.duration || 1));
      const unitPrice = money(order.unit_price || order.unitPrice || order.price || order.budget || 0);
      const totalAmount = money(order.total_amount || order.totalAmount) || unitPrice * hours;
      if (!order.game || !order.description && !order.requirements && !order.title) return json(res, 400, { ok: false, message: "请填写游戏和需求说明。" });
      const row = {
        order_no: orderNo(),
        boss_id: profile.id,
        companion_id: order.companion_id || order.companionId || null,
        customer_service_id: null,
        order_type: String(order.order_type || order.orderType || "custom"),
        game: String(order.game || ""),
        title: String(order.title || "自定义订单"),
        description: String(order.description || order.requirements || order.service_content || ""),
        hours,
        unit_price: unitPrice,
        total_amount: totalAmount,
        status: "awaiting_payment",
        created_at: nowIso()
      };
      const rows = await supabaseJson(restUrl(TABLE), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(row) });
      const saved = rows?.[0] || row;
      await addSystemMessage(saved, profile.id, "订单已提交，请联系客服确认付款。");
      return json(res, 200, { ok: true, message: "订单已提交，请联系客服确认付款。", order: viewOrder(saved) });
    }
    const id = String(body.id || body.order_id || body.orderId || "");
    if (!id) return json(res, 400, { ok: false, message: "缺少订单 ID。" });
    if (action === "confirm_companion") {
      const order = await patchOwnedOrder(profile, id, ["waiting_boss_confirm"], { status: "confirmed" }, "老板已确认陪玩，客服会继续跟进订单。");
      return json(res, 200, { ok: true, message: "已确认陪玩。", order });
    }
    if (action === "reject_companion") {
      const order = await patchOwnedOrder(profile, id, ["waiting_boss_confirm"], { status: "pending", companion_id: null, accepted_at: null }, "老板已选择换一个陪玩，请客服重新安排。");
      return json(res, 200, { ok: true, message: "已选择换一个陪玩，客服将重新安排。", order });
    }
    if (action === "cancel_order") {
      const order = await patchOwnedOrder(profile, id, ["awaiting_payment", "pending", "claimed", "waiting_boss_confirm", "confirmed"], { status: "cancelled", cancelled_at: nowIso() }, "老板已取消订单。");
      return json(res, 200, { ok: true, message: "订单已取消。", order });
    }
    if (action === "request_refund") {
      const order = await patchOwnedOrder(profile, id, ["confirmed", "in_progress", "completed"], { status: "refund_requested" }, "老板已申请退款，等待客服处理。");
      return json(res, 200, { ok: true, message: "退款申请已提交。", order });
    }
    return json(res, 400, { ok: false, message: "未知订单操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "订单接口异常" });
  }
}







