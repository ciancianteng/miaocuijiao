/**
 * Shared admin auth — NEVER trust x-mcj-admin-role alone.
 * Always: Bearer token → auth/v1/user → profiles.role ∈ ADMIN_ROLES.
 */
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function rest(table, query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${env("SUPABASE_URL")}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: env("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

export function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export async function requireAdmin(req, { allowRoles = ADMIN_ROLES } = {}) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const userRes = await fetch(authUrl("user"), {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const userText = await userRes.text();
  let user = null;
  try {
    user = userText ? JSON.parse(userText) : null;
  } catch {
    user = null;
  }
  if (!userRes.ok || !user?.id) {
    throw Object.assign(new Error("登录已失效，请重新登录后台。"), { status: 401 });
  }
  const rowsRes = await fetch(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const rowsText = await rowsRes.text();
  let rows = null;
  try {
    rows = rowsText ? JSON.parse(rowsText) : null;
  } catch {
    rows = null;
  }
  const profile = Array.isArray(rows) ? rows[0] : null;
  const roles = allowRoles instanceof Set ? allowRoles : new Set(allowRoles || []);
  if (!profile || !roles.has(profile.role)) {
    throw Object.assign(new Error("没有后台管理权限。"), { status: 403 });
  }
  if (profile.status && profile.status !== "active") {
    throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  }
  return profile;
}

export { ADMIN_ROLES };
