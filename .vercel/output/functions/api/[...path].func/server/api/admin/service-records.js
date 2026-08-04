const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

function json(res, status, data) {
  return res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
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
    throw Object.assign(new Error(body?.error_description || body?.message || body?.hint || body?.details || "Supabase 请求失败"), {
      status: response.status,
    });
  }
  return body;
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

async function requireAdmin(req) {
  const headerRole = roleFrom(req);
  const token = tokenFrom(req);
  if (!token) {
    if (ADMIN_ROLES.has(headerRole) && !hasDb()) return { role: headerRole };
    throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  }
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    throw Object.assign(new Error("无权查看接待记录。"), { status: 403 });
  }
  if (profile.status !== "active") {
    throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  }
  return profile;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) {
    return json(res, 200, {
      ok: true,
      configured: false,
      records: [],
      message: "未配置 Supabase，接待记录为空。",
    });
  }
  try {
    await requireAdmin(req);
    const { listServiceRecords } = await import("../_service-receptions.js");
    const records = await listServiceRecords({ limit: 500 });
    return json(res, 200, {
      ok: true,
      configured: true,
      records,
      message: records.length ? "" : "暂无接待记录",
    });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "接待记录接口异常。" });
  }
}
