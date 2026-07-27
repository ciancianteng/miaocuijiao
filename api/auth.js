const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const VALID_ROLES = new Set(["boss", "companion", "customer_service", "admin"]);

function json(res, status, data) {
  res.status(status).json(data);
}

function envStatus() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  return { configured: missing.length === 0, missing };
}

function headersWithServiceRole(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function authHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...extra,
  };
}

function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.error_description || body?.message || body?.hint || body?.details || "Supabase 请求失败");
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
  const action = String(req.method === "GET" ? req.query.action || "health" : (req.body?.action || "")).trim();
  const env = envStatus();

  if (req.method === "GET" && action === "health") {
    return json(res, 200, {
      ok: true,
      configured: env.configured,
      missing: env.missing,
      tables: ["profiles", "companion_profiles", "orders", "conversations", "messages", "transactions", "banners", "announcements", "customer_service_reports"],
    });
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
    if (String(body.action || "login") !== "login") return json(res, 400, { ok: false, message: "未知登录操作" });
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
