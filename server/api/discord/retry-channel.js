/**
 * POST /api/discord/retry-channel { orderId }
 * Idempotent retry for Discord voice channel creation after error.
 */
import { requireAuthProfile } from "../_discord-auth.js";
import { ensureOrderVoiceChannel, resolveVoiceOwnerOrder } from "../_discord-voice-orders.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function envUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
}
function envKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}
function serviceHeaders() {
  const key = envKey();
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
}
function restUrl(table, query = "") {
  return `${envUrl()}/rest/v1/${table}${query}`;
}
async function supabaseJson(endpoint, opts = {}) {
  const response = await fetch(endpoint, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || text || `HTTP ${response.status}`), { status: response.status, body });
  }
  return body;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
  let profile;
  try {
    profile = await requireAuthProfile(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "请先登录" });
  }
  const body = await readBody(req);
  const orderId = String(body.orderId || body.order_id || body.id || "").trim();
  if (!orderId) return json(res, 400, { ok: false, message: "缺少订单 ID" });
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const order = rows?.[0];
  if (!order) return json(res, 404, { ok: false, message: "订单不存在" });
  const isBoss = String(order.boss_id) === String(profile.id);
  const isCompanion = String(order.companion_id) === String(profile.id);
  if (!isBoss && !isCompanion) return json(res, 403, { ok: false, message: "无权操作此订单" });
  const owner = await resolveVoiceOwnerOrder(order);
  const result = await ensureOrderVoiceChannel(owner || order, {
    companionUserId: isCompanion ? profile.id : order.companion_id,
  });
  return json(res, result.ok ? 200 : 502, {
    ok: !!result.ok,
    ...result,
    message: result.ok
      ? result.created
        ? "Discord 语音房已创建"
        : result.reused
          ? "Discord 语音房已就绪"
          : "已处理"
      : result.message || "语音房创建失败，请稍后重试",
  });
}
