/**
 * Shared boss/customer identity for boss-facing APIs (orders, chat, recharge, …).
 * Frontend storage may label the same account as "customer" while DB uses "boss".
 *
 * Unified account: the same user_id may hold companion + boss. Companion role alone
 * may shop as boss on the same account (no second email / user_id).
 */
const BOSS_ROLE_ALIASES = new Set(["boss", "customer", "owner", "user"]);
const COMPANION_ALIASES = new Set(["companion", "player", "pw"]);
const STAFF_ROLES = new Set([
  "customer_service",
  "service",
  "admin",
  "super_admin",
]);

export function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function isBossLikeRole(role) {
  return BOSS_ROLE_ALIASES.has(normalizeRole(role));
}

export function isCompanionLikeRole(role) {
  return COMPANION_ALIASES.has(normalizeRole(role));
}

export function isStaffOrAdminRole(role) {
  return STAFF_ROLES.has(normalizeRole(role));
}

export function bossIdentityError(role) {
  const r = normalizeRole(role);
  if (r === "customer_service" || r === "service") {
    return Object.assign(new Error("当前登录的是客服账号，请使用老板账号打开老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
  }
  if (r === "admin" || r === "super_admin") {
    return Object.assign(new Error("当前登录的是管理账号，请使用老板账号打开老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
  }
  return Object.assign(new Error("当前账号不是老板客户身份，无法使用老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
}

function profileHasBossCapability(profile = {}) {
  const roles = Array.isArray(profile.roles) ? profile.roles.map(normalizeRole) : [];
  if (roles.some((r) => BOSS_ROLE_ALIASES.has(r) || COMPANION_ALIASES.has(r))) return true;
  const role = normalizeRole(profile.role);
  if (isBossLikeRole(role) || isCompanionLikeRole(role)) return true;
  if (String(profile.boss_uid || "").trim()) return true;
  return false;
}

/**
 * Accept boss aliases and multi-role companion accounts that shop as the same user_id.
 * Returns a profile object with role normalized to "boss" for boss-facing APIs.
 */
export async function assertBossProfile(profile, opts = {}) {
  if (!profile || !profile.id) {
    throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403, code: "NO_PROFILE" });
  }
  const status = String(profile.status || "active").trim().toLowerCase();
  if (status && status !== "active") {
    throw Object.assign(new Error("账号未启用。"), { status: 403, code: "INACTIVE" });
  }

  if (profileHasBossCapability(profile)) {
    return { ...profile, role: "boss" };
  }

  if (isStaffOrAdminRole(profile.role)) {
    throw bossIdentityError(profile.role);
  }

  // Last resort: ownership of boss orders proves this auth user is the customer_id/boss_id.
  if (typeof opts.lookupOwnedOrder === "function") {
    try {
      const owned = await opts.lookupOwnedOrder(profile.id);
      if (owned) return { ...profile, role: "boss" };
    } catch {
      /* ignore lookup errors; fall through */
    }
  }

  throw bossIdentityError(profile.role);
}

export function identityView(profile, authUser = {}) {
  return {
    authUserId: authUser.id || profile.id || "",
    customerId: profile.id || "",
    bossId: profile.id || "",
    bossUid: profile.boss_uid || "",
    role: profile.role || "",
    email: profile.email || authUser.email || "",
    displayName: profile.display_name || "",
  };
}
