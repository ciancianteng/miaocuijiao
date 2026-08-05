/**
 * Account security helpers — never expose password hashes to clients.
 */
import { writeAdminLog } from "./_wallet.js";

function envValue(key, fallback = "") {
  return String(process.env[key] || fallback).trim();
}

function authUrl(path = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/${String(path).replace(/^\//, "")}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY") || envValue("SUPABASE_ANON_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
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
    const detail =
      body?.error_description ||
      body?.msg ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return body;
}

function isMissingColumnError(error) {
  return /column|schema cache|Could not find/i.test(String(error?.message || error || ""));
}

/**
 * Detect whether Auth user has a password — returns boolean only.
 * Never return encrypted_password / hash to callers for client use.
 */
/** @returns {true|false|null} null = probe failed / inconclusive */
export async function authUserHasPassword(userId) {
  if (!userId) return null;
  try {
    const raw = await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      headers: serviceHeaders({ Prefer: "return=representation" }),
    });
    const user = raw?.user && typeof raw.user === "object" ? raw.user : raw;
    if (user?.user_metadata?.has_password === false || user?.app_metadata?.has_password === false) {
      return false;
    }
    if (user?.user_metadata?.has_password === true || user?.app_metadata?.has_password === true) return true;
    if (user?.user_metadata?.password_set_at || user?.app_metadata?.password_set_at) return true;
    const hash = user?.encrypted_password;
    // Presence of a non-empty hash means a password identity exists.
    if (hash && String(hash).length > 3) return true;
    // GoTrue sometimes omits encrypted_password in admin payloads — inconclusive.
    if (hash == null && Object.prototype.hasOwnProperty.call(user || {}, "encrypted_password") === false) {
      return null;
    }
    return false;
  } catch {
    return null;
  }
}

export async function patchProfileSecurity(userId, fields = {}) {
  if (!userId) return null;
  const payload = {};
  if (fields.hasPassword != null) payload.has_password = !!fields.hasPassword;
  if (fields.passwordSetAt != null) payload.password_set_at = fields.passwordSetAt;
  if (fields.mustChangePassword != null) payload.must_change_password = !!fields.mustChangePassword;
  if (fields.lastLoginAt != null) payload.last_login_at = fields.lastLoginAt;
  if (fields.lastLoginIp != null) payload.last_login_ip = String(fields.lastLoginIp || "").slice(0, 64);
  if (!Object.keys(payload).length) return null;
  try {
    const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    // Columns may not exist yet — best-effort without failing password ops.
    const slim = {};
    if (payload.last_login_at) slim.last_login_at = payload.last_login_at;
    if (!Object.keys(slim).length) return null;
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(slim),
      });
      return Array.isArray(rows) ? rows[0] : rows;
    } catch {
      return null;
    }
  }
}

export async function stampPasswordSet(userId, { mustChangePassword = false } = {}) {
  const now = new Date().toISOString();
  // Also stamp user_metadata so has_password survives missing columns.
  try {
    const raw = await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      headers: serviceHeaders(),
    });
    const user = raw?.user && typeof raw.user === "object" ? raw.user : raw;
    const prev = (user?.user_metadata && typeof user.user_metadata === "object" && user.user_metadata) || {};
    // Strip any accidental secret fields if present.
    const nextMeta = { ...prev, has_password: true, password_set_at: now };
    delete nextMeta.password;
    delete nextMeta.password_hash;
    delete nextMeta.encrypted_password;
    await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      method: "PUT",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_metadata: nextMeta,
        app_metadata: {
          ...((user?.app_metadata && typeof user.app_metadata === "object" && user.app_metadata) || {}),
          has_password: true,
        },
      }),
    });
  } catch {
    /* metadata stamp best-effort */
  }
  return patchProfileSecurity(userId, {
    hasPassword: true,
    passwordSetAt: now,
    mustChangePassword: !!mustChangePassword,
  });
}

/** Mark OTP-first accounts that still use an opaque system password (never shown). */
export async function stampPasswordUnset(userId) {
  try {
    const raw = await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      headers: serviceHeaders(),
    });
    const user = raw?.user && typeof raw.user === "object" ? raw.user : raw;
    const prev = (user?.user_metadata && typeof user.user_metadata === "object" && user.user_metadata) || {};
    const nextMeta = { ...prev, has_password: false };
    delete nextMeta.password_set_at;
    delete nextMeta.password;
    delete nextMeta.password_hash;
    delete nextMeta.encrypted_password;
    await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      method: "PUT",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_metadata: nextMeta,
        app_metadata: {
          ...((user?.app_metadata && typeof user.app_metadata === "object" && user.app_metadata) || {}),
          has_password: false,
        },
      }),
    });
  } catch {
    /* best-effort */
  }
  return patchProfileSecurity(userId, {
    hasPassword: false,
    passwordSetAt: null,
    mustChangePassword: false,
  });
}

export async function markMustChangePassword(userId, value = true) {
  try {
    const user = await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      headers: serviceHeaders(),
    });
    const prev = (user?.user_metadata && typeof user.user_metadata === "object" && user.user_metadata) || {};
    await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
      method: "PUT",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_metadata: { ...prev, must_change_password: !!value },
        app_metadata: {
          ...((user?.app_metadata && typeof user.app_metadata === "object" && user.app_metadata) || {}),
          must_change_password: !!value,
        },
      }),
    });
  } catch {
    /* ignore */
  }
  return patchProfileSecurity(userId, { mustChangePassword: !!value });
}

/** Revoke all Auth sessions for a user (other devices). */
export async function revokeUserSessions(userId) {
  if (!userId) return { ok: false };
  const attempts = [
    () =>
      supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}/logout`), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: "{}",
      }),
    () =>
      supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}/logout?scope=global`), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: "{}",
      }),
  ];
  for (const run of attempts) {
    try {
      await run();
      return { ok: true };
    } catch {
      /* try next */
    }
  }
  // Fallback: bump token version via ban/unban is too invasive; password update already
  // invalidates many refresh tokens. Return soft failure.
  return { ok: false };
}

export async function touchLastLogin(userId, ip = "") {
  return patchProfileSecurity(userId, {
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: ip || "",
  });
}

/**
 * Resolve hasPassword without ever leaking hash.
 * Returns true | false | null (null = unknown — do not treat as unset).
 */
export async function resolveHasPassword(profile = {}, authUser = {}, { probeAuth = true } = {}) {
  // Explicit false wins — OTP-first accounts may have an opaque Auth password
  // that must never count as a user-chosen login password.
  if (profile?.has_password === false || profile?.hasPassword === false) return false;
  if (
    authUser?.user_metadata?.has_password === false ||
    authUser?.app_metadata?.has_password === false
  ) {
    return false;
  }

  if (profile?.has_password === true || profile?.hasPassword === true) return true;
  if (
    authUser?.user_metadata?.has_password === true ||
    authUser?.app_metadata?.has_password === true ||
    authUser?.user_metadata?.password_set_at ||
    authUser?.app_metadata?.password_set_at
  ) {
    return true;
  }
  if (profile?.password_set_at || profile?.passwordSetAt) return true;

  let probed = null;
  if (probeAuth) {
    const id = profile?.id || authUser?.id;
    if (id) {
      probed = await authUserHasPassword(id);
      if (probed === true) return true;
      if (probed === false) return false;
    }
  }

  return null;
}

export function resolveMustChangePassword(profile = {}, authUser = {}) {
  if (profile?.must_change_password === true || profile?.mustChangePassword === true) return true;
  if (authUser?.user_metadata?.must_change_password === true) return true;
  if (authUser?.app_metadata?.must_change_password === true) return true;
  return false;
}

export function securityPublicFields(profile = {}, authUser = {}, hasPassword = false) {
  return {
    hasPassword: !!hasPassword,
    has_password: !!hasPassword,
    passwordSetAt: profile.password_set_at || profile.passwordSetAt || authUser?.user_metadata?.password_set_at || "",
    password_set_at: profile.password_set_at || profile.passwordSetAt || authUser?.user_metadata?.password_set_at || "",
    mustChangePassword: resolveMustChangePassword(profile, authUser),
    must_change_password: resolveMustChangePassword(profile, authUser),
    lastLoginAt: profile.last_login_at || profile.lastLoginAt || authUser?.last_sign_in_at || "",
    last_login_at: profile.last_login_at || profile.lastLoginAt || authUser?.last_sign_in_at || "",
    lastLoginIp: profile.last_login_ip || profile.lastLoginIp || "",
    last_login_ip: profile.last_login_ip || profile.lastLoginIp || "",
  };
}

export async function logSecurityAdminAction({
  operatorId,
  operatorRole = "admin",
  targetId,
  targetType = "user",
  action,
  reason = "",
  result = "ok",
  before = null,
  after = null,
}) {
  try {
    await writeAdminLog({
      module: "account_security",
      action: String(action || "security"),
      targetType,
      targetId: String(targetId || ""),
      operatorId: String(operatorId || ""),
      operatorRole: String(operatorRole || "admin"),
      reason: String(reason || result || ""),
      before,
      after: { ...(after || {}), result: String(result || "ok") },
    });
  } catch {
    /* never block security ops on log failure */
  }
}

export const NO_PASSWORD_LOGIN_MESSAGE =
  "该账号尚未设置密码，请使用验证码登录后前往账号安全设置密码。";

export const RESET_EMAIL_GENERIC_MESSAGE = "如该邮箱已注册，系统将发送重置邮件。";
