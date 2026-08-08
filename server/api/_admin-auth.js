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
  return { apikey: env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

/** Normalize DB / metadata role strings to canonical admin roles. */
export function normalizeAdminRole(role) {
  const raw = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "superadmin" || raw === "super_admin" || raw === "root") return "super_admin";
  if (raw === "admin" || raw === "administrator") return "admin";
  if (raw === "finance_admin" || raw === "finance") return "finance_admin";
  return raw;
}

export function isAdminRoleName(role) {
  const n = normalizeAdminRole(role);
  return n === "admin" || n === "super_admin";
}

/**
 * Module permission helper.
 * super_admin → all modules.
 * admin → all modules unless an explicit deny list is provided later.
 * Granular keys accepted: players | companion | companion_management | player_management
 */
export function adminHasModule(profile, moduleKey) {
  const role = normalizeAdminRole(profile?.role);
  if (role === "super_admin") return true;
  if (!isAdminRoleName(role)) return false;
  const key = String(moduleKey || "")
    .trim()
    .toLowerCase();
  if (!key) return true;
  const aliases = new Set(
    [key, key.replace(/_/g, ""), key.replace(/-/g, "_")].filter(Boolean)
  );
  if (aliases.has("players") || aliases.has("companion") || aliases.has("companionmanagement") || aliases.has("companion_management") || aliases.has("player_management") || aliases.has("playermanagement")) {
    // Current product: any active admin/super_admin may manage companions.
    // Fine-grained deny lists can be added later without splitting list vs detail.
    return true;
  }
  return true;
}

export function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export async function requireAdmin(req, { allowRoles = ADMIN_ROLES, module = "" } = {}) {
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
  if (!rowsRes.ok) {
    throw Object.assign(new Error("无法读取管理员资料，请稍后重试。"), {
      status: rowsRes.status >= 400 ? rowsRes.status : 503,
    });
  }
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) {
    throw Object.assign(new Error("账号未绑定管理员资料。"), { status: 403 });
  }
  const normalized = normalizeAdminRole(profile.role);
  const roles = allowRoles instanceof Set ? allowRoles : new Set(allowRoles || []);
  const allowedNormalized = new Set([...roles].map((r) => normalizeAdminRole(r)));
  if (!allowedNormalized.has(normalized)) {
    throw Object.assign(new Error("没有后台管理权限。"), { status: 403 });
  }
  if (profile.status && String(profile.status).toLowerCase() !== "active") {
    throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  }
  if (module && !adminHasModule({ ...profile, role: normalized }, module)) {
    throw Object.assign(new Error("没有陪玩管理权限"), { status: 403 });
  }
  return { ...profile, role: normalized };
}

export { ADMIN_ROLES };
