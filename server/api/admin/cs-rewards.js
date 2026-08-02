import { loadRewardSettings, saveRewardSettings, listRewards } from "../_cs-dock-rewards.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((k) => process.env[k]);
}
function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
async function sb(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg = body?.message || body?.error_description || body?.msg || `HTTP ${response.status}`;
    throw Object.assign(new Error(msg), { status: response.status });
  }
  return body;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await sb(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await sb(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    throw Object.assign(new Error("没有客服奖励管理权限。"), { status: 403 });
  }
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
async function profileMap(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await sb(
    rest("profiles", `?id=in.(${unique.map(encodeURIComponent).join(",")})&select=id,display_name,email,boss_uid`),
    { headers: serviceHeaders() }
  );
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((p) => {
    map[p.id] = p;
  });
  return map;
}
function mapRecord(r, profiles) {
  return {
    id: r.id,
    serviceId: r.service_id,
    serviceName: profiles[r.service_id]?.display_name || profiles[r.service_id]?.email || r.service_id,
    bossId: r.boss_id,
    bossName: profiles[r.boss_id]?.display_name || profiles[r.boss_id]?.boss_uid || r.boss_id || "-",
    orderId: r.order_id,
    orderNo: r.order_no || r.order_id,
    conversationId: r.conversation_id || "",
    orderAmount: Number(r.order_amount || 0),
    amount: Number(r.amount_cat_food || 0),
    status: r.status,
    statusText:
      ({ pending: "待结算", settled: "已结算", cancelled: "已取消", clawed_back: "已扣回" })[r.status] || r.status,
    settledAt: r.settled_at || "",
    clawbackAt: r.clawback_at || "",
    clawbackReason: r.clawback_reason || "",
    cancelReason: r.cancel_reason || "",
    source: r.source || "",
    isManual: !!r.is_manual,
    refunded: r.status === "clawed_back" || !!r.clawback_at,
    clawed: r.status === "clawed_back",
    createdAt: r.created_at || "",
  };
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, message: "未配置数据库" });

  try {
    const admin = await requireAdmin(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(req.query?.action || body.action || "settings").trim();

    if (req.method === "GET" || action === "get_settings" || action === "settings") {
      if (action === "list" || action === "records") {
        const status = String(req.query?.status || body.status || "").trim();
        const serviceId = String(req.query?.service_id || body.service_id || "").trim();
        const rows = await listRewards({ status, serviceId, limit: 150 });
        const profiles = await profileMap(rows.flatMap((r) => [r.service_id, r.boss_id]));
        return json(res, 200, { ok: true, records: rows.map((r) => mapRecord(r, profiles)) });
      }
      const settings = await loadRewardSettings();
      return json(res, 200, { ok: true, settings });
    }

    if (req.method === "POST") {
      if (action === "save_settings" || action === "save") {
        const payload = body.payload || body.settings || body;
        const saved = await saveRewardSettings(
          {
            enabled: payload.enabled,
            amountCatFood: payload.amountCatFood ?? payload.amount,
            settleNode: payload.settleNode,
            clawbackOnRefund: payload.clawbackOnRefund,
            cancelOnCancel: payload.cancelOnCancel,
            oncePerOrder: payload.oncePerOrder,
            effectiveFrom: payload.effectiveFrom,
            dailyCap: payload.dailyCap,
          },
          admin.id || admin.email || "admin"
        );
        return json(res, 200, { ok: true, message: "客服奖励设置已保存", settings: saved.settings });
      }
      if (action === "list" || action === "records") {
        const status = String(body.status || "").trim();
        const serviceId = String(body.service_id || "").trim();
        const rows = await listRewards({ status, serviceId, limit: 150 });
        const profiles = await profileMap(rows.flatMap((r) => [r.service_id, r.boss_id]));
        return json(res, 200, { ok: true, records: rows.map((r) => mapRecord(r, profiles)) });
      }
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "客服奖励接口异常" });
  }
}
