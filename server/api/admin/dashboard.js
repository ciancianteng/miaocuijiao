import { hasPlatformDb, loadPlatformStats } from "../_platform-stats.js";

const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const REQUIRED_AUTH_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) {
  return res.status(status).json(data);
}

function hasAuthDb() {
  return REQUIRED_AUTH_ENV.every((key) => process.env[key]);
}

function restUrl(table, query = "") {
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

function supabaseError(body, response) {
  const parts = [
    body?.error_description,
    body?.msg,
    body?.message,
    body?.error,
    body?.hint,
    body?.details,
    typeof body === "string" ? body : "",
  ].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
  return body;
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问后台。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasAuthDb() || !hasPlatformDb()) {
    return json(res, 200, {
      ok: true,
      configured: false,
      stats: {},
      trends: { days: [], orders: [], revenue: [], profit: [] },
      pending: { companionAudits: 0, withdrawals: 0, refunds: 0, tickets: 0 },
      message: "未配置 Supabase，后台首页只显示 0，不返回假统计。",
    });
  }
  try {
    await requireAdmin(req);
    const payload = await loadPlatformStats();
    return json(res, 200, {
      ok: true,
      configured: payload.configured !== false,
      date: payload.date,
      timezone: payload.timezone,
      stats: payload.stats || {},
      trends: payload.trends || { days: [], orders: [], revenue: [], profit: [] },
      pending: payload.pending || { companionAudits: 0, withdrawals: 0, refunds: 0, tickets: 0 },
      message: payload.message || undefined,
    });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "后台统计接口异常。" });
  }
}
