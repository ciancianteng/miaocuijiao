import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_ROLES = new Set(["boss", "companion", "customer_service", "admin"]);
const TABLES = ["profiles", "companion_profiles", "orders", "conversations", "messages", "transactions", "banners", "announcements", "customer_service_reports"];

loadLocalEnv();

function loadLocalEnv() {
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(apiDir, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

function envStatus() {
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !envValue(key));
  return { configured: missing.length === 0, missing };
}

function json(res, status, data) {
  res.status(status).json(data);
}

function headersWithServiceRole(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authHeaders(extra = {}) {
  return {
    apikey: envValue("SUPABASE_ANON_KEY"),
    "Content-Type": "application/json",
    ...extra,
  };
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function redirectFor(role) {
  return {
    boss: "/index.html",
    companion: "/companion/",
    customer_service: "/customer-service/",
    admin: "/admin/",
  }[role] || "/index.html";
}

function safeProfile(profile = {}, authUser = {}) {
  const role = String(profile.role || "").trim();
  return {
    id: profile.id || authUser.id || "",
    role,
    displayName: profile.display_name || authUser.user_metadata?.display_name || authUser.email || "",
    email: profile.email || authUser.email || "",
    phone: profile.phone || authUser.phone || "",
    avatarUrl: profile.avatar_url || "",
    status: profile.status || "pending",
    createdAt: profile.created_at || authUser.created_at || "",
  };
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
    const detail = body?.error_description || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return body;
}

async function profileFor(userId) {
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`), {
    headers: headersWithServiceRole(),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function userFromToken(token) {
  return supabaseJson(authUrl("user"), {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
}

export default async function handler(req, res) {
  const action = String(req.method === "GET" ? req.query.action || "health" : req.body?.action || "").trim();
  const env = envStatus();

  if (req.method === "GET" && action === "health") {
    return json(res, 200, { ok: true, configured: env.configured, missing: env.missing, tables: TABLES });
  }

  if (!env.configured) {
    return json(res, 503, {
      ok: false,
      configured: false,
      message: `未配置 ${env.missing.join(" / ")}，无法进行真实数据库登录。`,
      missing: env.missing,
    });
  }

  try {
    if (req.method === "GET" && action === "me") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
      const user = safeProfile(profile, authUser);
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      return json(res, 200, { ok: true, user, redirect: redirectFor(user.role) });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const requestedAction = String(body.action || "login");
    if (requestedAction === "update_profile") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      const patch = {};
      if (typeof body.displayName === "string") patch.display_name = body.displayName.trim().slice(0, 40);
      if (typeof body.phone === "string") patch.phone = body.phone.trim().slice(0, 30);
      if (typeof body.avatarUrl === "string") patch.avatar_url = body.avatarUrl.trim().slice(0, 500);
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, message: "没有可保存的资料。" });
      const savedRows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}`), {
        method: "PATCH",
        headers: headersWithServiceRole({ Prefer: "return=representation" }),
        body: JSON.stringify(patch),
      });
      const saved = Array.isArray(savedRows) ? savedRows[0] : { ...profile, ...patch };
      return json(res, 200, { ok: true, message: "资料已保存", user: safeProfile(saved, authUser), redirect: redirectFor(saved.role) });
    }
    if (requestedAction !== "login") return json(res, 400, { ok: false, message: "未知登录操作" });
    const email = String(body.email || body.account || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" });

    const auth = await supabaseJson(authUrl("token?grant_type=password"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const authUser = auth.user;
    const profile = await profileFor(authUser.id);
    if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
    const user = safeProfile(profile, authUser);
    if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
    if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });

    return json(res, 200, {
      ok: true,
      session: {
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        expiresAt: auth.expires_at,
        user,
      },
      redirect: redirectFor(user.role),
    });
  } catch (error) {
    return json(res, 401, { ok: false, message: error.message || "账号或密码错误。" });
  }
}


