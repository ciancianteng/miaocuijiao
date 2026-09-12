/**
 * Shared boss/customer identity for boss-facing APIs (orders, chat, recharge, …).
 * Frontend storage may label the same account as "customer" while DB uses "boss".
 */
const BOSS_ROLE_ALIASES = new Set(["boss", "customer", "owner", "user"]);
const NON_BOSS_ROLES = new Set([
  "companion",
  "player",
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

export function isStaffOrAdminRole(role) {
  return NON_BOSS_ROLES.has(normalizeRole(role));
}

export function bossIdentityError(role) {
  const r = normalizeRole(role);
  if (r === "companion" || r === "player") {
    return Object.assign(new Error("当前登录的是陪玩账号，请使用老板账号打开老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
  }
  if (r === "customer_service" || r === "service") {
    return Object.assign(new Error("当前登录的是客服账号，请使用老板账号打开老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
  }
  if (r === "admin" || r === "super_admin") {
    return Object.assign(new Error("当前登录的是管理账号，请使用老板账号打开老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
  }
  return Object.assign(new Error("当前账号不是老板客户身份，无法使用老板端在线客服。"), { status: 403, code: "NOT_BOSS" });
}

/**
 * Accept boss aliases; optionally allow auth users who already own orders as boss_id.
 * Returns a profile object with role normalized to "boss".
 */
export async function assertBossProfile(profile, opts = {}) {
  if (!profile || !profile.id) {
    throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403, code: "NO_PROFILE" });
  }
  const status = String(profile.status || "active").trim().toLowerCase();
  if (status && status !== "active") {
    throw Object.assign(new Error("账号未启用。"), { status: 403, code: "INACTIVE" });
  }

  const role = normalizeRole(profile.role);
  if (isBossLikeRole(role) || String(profile.boss_uid || "").trim()) {
    return { ...profile, role: "boss" };
  }

  if (isStaffOrAdminRole(role)) {
    throw bossIdentityError(role);
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

  throw bossIdentityError(role);
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
