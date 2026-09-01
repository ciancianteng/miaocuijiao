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
 * Empty metadata is NOT treated as Boss — requires explicit boss role hints.
 * Any companion / staff trace blocks Boss auto-heal.
 * @returns {'boss'|'companion'|'staff'|'unknown'}
 */
export function classifyAuthPortalIntent(authUser = {}, extras = {}) {
  const roles = collectAuthRoleHints(authUser);
  const hasStaff = [...roles].some((r) => r === "admin" || r === "super_admin" || r === "customer_service" || r === "cs");
  if (hasStaff) return "staff";

  const hasCompanionMeta = roles.has("companion") || roles.has("player") || roles.has("pw");
  const hasCompanionTrace =
    hasCompanionMeta || extras?.companionProfileExists === true || extras?.hasCompanionTrace === true;
  // Any companion trace → never Boss-heal (even if dual-role metadata also lists boss).
  if (hasCompanionTrace) return "companion";

  const hasBoss = [...roles].some((r) => r === "boss" || r === "customer" || r === "owner" || r === "user");
  if (hasBoss) return "boss";
  // Empty / unrecognized metadata → do not guess Boss.
  return "unknown";
}

/** True only when it is safe to auto-create a Boss profiles row. */
export function shouldHealAsBoss(authUser = {}, extras = {}) {
  if (!authUser?.id) return false;
  if (authUser?.banned_until || authUser?.banned === true) return false;
  if (extras?.companionProfileExists === true || extras?.hasCompanionTrace === true) return false;
  return classifyAuthPortalIntent(authUser, extras) === "boss";
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

/**
 * Sync target must never regress sequence.
 * @returns {{ target: number, shouldSetval: boolean, setvalTo: number|null }}
 */
export function computeBossUidSeqSyncPlan(lastValue, profilesMax) {
  const cur = Math.max(0, Number(lastValue) || 0);
  const maxN = Math.max(0, Number(profilesMax) || 0);
  const target = Math.max(cur, maxN);
  if (target < 1) {
    return { target: 0, shouldSetval: true, setvalTo: 1, isCalled: false };
  }
  // Only bump when profiles max is ahead of sequence.
  if (maxN > cur) {
    return { target, shouldSetval: true, setvalTo: maxN, isCalled: true };
  }
  return { target, shouldSetval: false, setvalTo: null, isCalled: null };
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
  computeBossUidSeqSyncPlan,
  nextBossUidAfterMax,
};
