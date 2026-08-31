/**
 * Auth ↔ profiles orphan heal helpers.
 * Pure classification + boss_uid max math — safe to unit-test without Supabase.
 */

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Collect role strings from Auth user metadata (app + user). */
export function collectAuthRoleHints(authUser = {}) {
  const roles = new Set();
  const push = (v) => {
    for (const item of asArray(v)) {
      const r = String(item || "").trim().toLowerCase();
      if (r) roles.add(r);
    }
  };
  push(authUser?.app_metadata?.roles);
  push(authUser?.user_metadata?.roles);
  push(authUser?.app_metadata?.role);
  push(authUser?.user_metadata?.role);
  const primary = String(authUser?.app_metadata?.primary_role || authUser?.user_metadata?.primary_role || "")
    .trim()
    .toLowerCase();
  if (primary) roles.add(primary);
  return roles;
}

/**
 * Classify an Auth-only (or Auth+missing profile) user for heal eligibility.
 * @returns {'boss'|'companion'|'staff'|'unknown'}
 */
export function classifyAuthPortalIntent(authUser = {}) {
  const roles = collectAuthRoleHints(authUser);
  const hasStaff = [...roles].some((r) => r === "admin" || r === "super_admin" || r === "customer_service" || r === "cs");
  if (hasStaff) return "staff";
  const hasCompanion = roles.has("companion") || roles.has("player") || roles.has("pw");
  const hasBoss = [...roles].some((r) => r === "boss" || r === "customer" || r === "owner" || r === "user");
  if (hasCompanion && !hasBoss) return "companion";
  if (hasBoss) return "boss";
  // Boss register historically may leave empty roles — treat as boss-eligible orphan.
  if (roles.size === 0) return "boss";
  return "unknown";
}

/** True only when it is safe to auto-create a Boss profiles row. */
export function shouldHealAsBoss(authUser = {}) {
  if (!authUser?.id) return false;
  if (authUser?.banned_until || authUser?.banned === true) return false;
  return classifyAuthPortalIntent(authUser) === "boss";
}

export function repairDeniedMessage(intent) {
  if (intent === "companion") {
    return "该账号资料不完整，请使用陪玩端修复或联系客服，不能在此自动创建老板资料。";
  }
  if (intent === "staff") {
    return "该账号资料不完整，请联系管理员修复，不能自动提权。";
  }
  return "账号资料不完整，请联系客服修复后再登录。";
}

/**
 * Parse max MCJ / legacy B numeric from a list of boss_uid strings.
 * @param {Iterable<string>} uids
 * @param {(raw: string) => number|null|undefined} parseBossCodeNumber
 */
export function maxBossUidNumberFromList(uids, parseBossCodeNumber) {
  let max = 0;
  for (const raw of uids || []) {
    const n = Number(parseBossCodeNumber(raw) || 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Next sequence last_value semantics: setval(max, true) ⇒ next nextval is max+1. */
export function nextBossUidAfterMax(maxN) {
  const max = Math.max(0, Number(maxN) || 0);
  return max + 1;
}

export default {
  collectAuthRoleHints,
  classifyAuthPortalIntent,
  shouldHealAsBoss,
  repairDeniedMessage,
  maxBossUidNumberFromList,
  nextBossUidAfterMax,
};
