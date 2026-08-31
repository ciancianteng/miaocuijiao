/**
 * Unified account roles / capabilities: one email → one profiles.id (auth user id).
 * Capabilities may include boss + companion on the same user_id (additive, not exclusive).
 *
 * SoT:
 * - auth.users email uniqueness (platform)
 * - profiles.id = auth user id
 * - companion_profiles.user_id unique → companion capability
 * - optional profiles.roles text[] / auth app_metadata.roles
 * - hasBoss / hasCompanion are the portal gate authorities (not primary role alone)
 */
import { envValue, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

function authUrl(path = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/${String(path).replace(/^\//, "")}`;
}

function headersWithServiceRole(extra = {}) {
  return serviceHeaders(extra);
}

const BOSS_ALIASES = new Set(["boss", "customer", "owner", "user"]);

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function normalizeRoleName(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  if (r === "player" || r === "pw") return "companion";
  if (BOSS_ALIASES.has(r)) return "boss";
  if (r === "cs" || r === "service") return "customer_service";
  return r;
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const r = normalizeRoleName(raw);
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function collectRoleHints(profile = {}, authUser = null) {
  const collected = [];
  const fromCol = profile?.roles;
  if (Array.isArray(fromCol)) collected.push(...fromCol);
  else if (typeof fromCol === "string" && fromCol.trim()) {
    try {
      const parsed = JSON.parse(fromCol);
      if (Array.isArray(parsed)) collected.push(...parsed);
      else collected.push(...String(fromCol).split(/[,\s]+/));
    } catch {
      collected.push(...String(fromCol).split(/[,\s|]+/));
    }
  }
  const metaRoles = authUser?.app_metadata?.roles || authUser?.user_metadata?.roles;
  if (Array.isArray(metaRoles)) collected.push(...metaRoles);
  const primaryMeta = authUser?.app_metadata?.primary_role || authUser?.user_metadata?.primary_role;
  if (primaryMeta) collected.push(primaryMeta);
  const primary = normalizeRoleName(profile?.role);
  if (primary) collected.push(primary);
  return uniq(collected);
}

function hasValidBossUid(profile = {}, authUser = null) {
  const raw = String(
    profile?.boss_uid || authUser?.user_metadata?.boss_uid || authUser?.app_metadata?.boss_uid || ""
  ).trim();
  return /^MCJ[0-9]+$/i.test(raw) || /^B[0-9]+$/i.test(raw);
}

/**
 * Explicit Boss capability evidence (never boss_uid alone).
 * @typedef {object} BossEvidence
 * @property {boolean} [hasBossOrders] — user appeared as orders.boss_id
 * @property {number} [bossOrderCount]
 * @property {boolean} [hasBossWallet] — reserved for wallet/account proof
 * @property {boolean} [forceBoss] — explicit operator / repair flag
 */
export function evaluateBossEvidence(evidence = {}) {
  if (evidence?.forceBoss === true) return true;
  if (evidence?.hasBossOrders === true) return true;
  if (Number(evidence?.bossOrderCount || 0) > 0) return true;
  if (evidence?.hasBossWallet === true) return true;
  return false;
}

/**
 * Derive role list from profile + companion + auth metadata (+ optional evidence).
 * Additive: boss and companion may both be present.
 * Do NOT auto-grant boss to every companion (boss_uid alone is insufficient).
 */
export function resolveRoles(profile = {}, { companion = null, authUser = null, grantBossWithCompanion = false, evidence = null } = {}) {
  const collected = collectRoleHints(profile, authUser);
  if (companion && companion.id) collected.push("companion");

  let roles = uniq(collected);
  // Strong Boss business evidence upgrades capability even when primary was overwritten to companion.
  if (evaluateBossEvidence(evidence) && !roles.includes("boss")) {
    roles = uniq([...roles, "boss"]);
  }
  // Opt-in only (default false). Legacy callers may still pass true.
  if (grantBossWithCompanion && roles.includes("companion") && !roles.includes("boss")) {
    roles = uniq([...roles, "boss"]);
  }
  // Staff roles stay exclusive unless explicitly stored.
  if (roles.includes("admin") || roles.includes("super_admin") || roles.includes("customer_service")) {
    return roles;
  }
  const primary = normalizeRoleName(profile?.role);
  if (!roles.length && primary) roles = [primary];
  return roles;
}

/**
 * Authoritative capability computation for portal gates.
 *
 * hasCompanion:
 *   companion_profiles row exists OR role/roles/meta say companion
 *
 * hasBoss:
 *   role/roles/meta say boss  OR  evaluateBossEvidence(evidence)
 *   NOT: boss_uid alone
 *   (boss_uid + Boss orders/wallet/meta/roles is covered via evidence or role hints)
 */
export function computeCapabilities(profile = {}, opts = {}) {
  const companion = opts.companion || null;
  const authUser = opts.authUser || null;
  const evidence = opts.evidence || null;
  const roles = resolveRoles(profile, { companion, authUser, grantBossWithCompanion: !!opts.grantBossWithCompanion, evidence });
  const hasCompanion =
    !!(companion && companion.id) ||
    roles.includes("companion") ||
    normalizeRoleName(profile?.role) === "companion";
  const hasBoss =
    roles.includes("boss") ||
    BOSS_ALIASES.has(normalizeRoleName(profile?.role)) ||
    evaluateBossEvidence(evidence);
  // Preferred primary for dual accounts: keep boss when hasBoss.
  let primaryRole = normalizeRoleName(profile?.role) || roles[0] || "";
  if (hasBoss && primaryRole === "companion") {
    primaryRole = "boss";
  }
  return {
    roles: uniq([
      ...roles,
      ...(hasBoss ? ["boss"] : []),
      ...(hasCompanion ? ["companion"] : []),
    ]),
    hasBoss: !!hasBoss,
    hasCompanion: !!hasCompanion,
    primaryRole,
    hasBossUid: hasValidBossUid(profile, authUser),
    bossUidAlone: hasValidBossUid(profile, authUser) && !hasBoss,
  };
}

export function hasRole(profile, role, opts) {
  const want = normalizeRoleName(role);
  return resolveRoles(profile, opts).includes(want);
}

export function hasBossRole(profile, opts = {}) {
  return computeCapabilities(profile, opts).hasBoss;
}

export function hasCompanionRole(profile, opts = {}) {
  return computeCapabilities(profile, opts).hasCompanion;
}

export function publicRolesPayload(profile, opts = {}) {
  return computeCapabilities(profile, opts);
}

/** Prefer boss primary when user already has Boss capability. */
export function preferredPrimaryRole(profile = {}, opts = {}) {
  const caps = computeCapabilities(profile, opts);
  if (caps.hasBoss) return "boss";
  if (caps.hasCompanion) return "companion";
  return normalizeRoleName(profile?.role) || caps.primaryRole || "";
}

/**
 * Profile patch when activating a companion listing.
 * NEVER overwrites profiles.role — status only.
 */
export function companionActivationProfilePatch({ hasBossCapability = false } = {}) {
  const patch = { status: "active" };
  // Callers that still need a role for brand-new companion-only rows pass role separately.
  void hasBossCapability;
  return patch;
}

export async function loadCompanionRowForUser(userId) {
  if (!userId) return null;
  try {
    const rows = await supabaseJson(
      restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=1`),
      { headers: headersWithServiceRole() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

/** Best-effort: did this user ever place orders as Boss? */
export async function loadBossOrderEvidence(userId) {
  const id = String(userId || "").trim();
  if (!id) return { hasBossOrders: false, bossOrderCount: 0 };
  try {
    const rows = await supabaseJson(
      restUrl("orders", `?boss_id=eq.${encodeURIComponent(id)}&select=id&limit=1`),
      { headers: headersWithServiceRole() }
    );
    const count = Array.isArray(rows) ? rows.length : 0;
    return { hasBossOrders: count > 0, bossOrderCount: count };
  } catch {
    return { hasBossOrders: false, bossOrderCount: 0 };
  }
}

/**
 * Enrich profile with additive capabilities.
 * Does NOT strip boss when primary is companion.
 * When primary=companion and boss_uid exists, probe Boss order evidence so dual users regain hasBoss at login.
 */
export async function enrichProfileRoles(profile, authUser = null, options = {}) {
  if (!profile?.id) return { profile, companion: null, roles: [], ...publicRolesPayload({}, {}) };
  const companion = options.companion !== undefined ? options.companion : await loadCompanionRowForUser(profile.id);
  let evidence = options.evidence || null;
  const primary = normalizeRoleName(profile?.role);
  const needsEvidenceProbe =
    !evidence &&
    primary === "companion" &&
    hasValidBossUid(profile, authUser) &&
    options.skipOrderProbe !== true;
  if (needsEvidenceProbe) {
    evidence = await loadBossOrderEvidence(profile.id);
  }
  const rolesInfo = publicRolesPayload(profile, {
    companion,
    authUser,
    grantBossWithCompanion: false,
    evidence,
  });

  // Soft repair preference: if dual capability but primary stuck on companion, persist boss primary.
  // Never deletes companion capability. Best-effort only.
  if (
    options.persistPrimaryRepair !== false &&
    rolesInfo.hasBoss &&
    rolesInfo.hasCompanion &&
    primary === "companion"
  ) {
    try {
      await persistRoles(profile.id, rolesInfo.roles, { primaryRole: "boss" });
    } catch {
      /* best-effort */
    }
  }

  return {
    profile: {
      ...profile,
      roles: rolesInfo.roles,
      role: rolesInfo.hasBoss && primary === "companion" ? "boss" : profile.role,
    },
    companion,
    evidence: evidence || null,
    ...rolesInfo,
  };
}

/** Persist roles to auth app_metadata + profiles.roles when column exists. */
export async function persistRoles(userId, rolesInput, { primaryRole = "" } = {}) {
  const roles = uniq(rolesInput);
  if (!userId || !roles.length) return roles;
  // Never demote boss primary when roles still include boss.
  let nextPrimary = primaryRole ? normalizeRoleName(primaryRole) : "";
  if (roles.includes("boss") && nextPrimary === "companion") {
    nextPrimary = "boss";
  }
  try {
    await supabaseJson(authUrl(`admin/users/${userId}`), {
      method: "PUT",
      headers: headersWithServiceRole(),
      body: JSON.stringify({
        app_metadata: { roles },
        user_metadata: { roles },
      }),
    });
  } catch (err) {
    try {
      await supabaseJson(authUrl(`admin/users/${userId}`), {
        method: "PATCH",
        headers: headersWithServiceRole(),
        body: JSON.stringify({ app_metadata: { roles }, user_metadata: { roles } }),
      });
    } catch {
      console.warn("[account-roles] auth metadata roles persist failed", err?.message || err);
    }
  }
  const patch = { roles };
  if (nextPrimary) patch.role = nextPrimary;
  try {
    await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: headersWithServiceRole({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
  } catch (err) {
    if (/roles|column|schema cache|PGRST/i.test(String(err?.message || ""))) {
      if (nextPrimary) {
        try {
          await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
            method: "PATCH",
            headers: headersWithServiceRole({ Prefer: "return=minimal" }),
            body: JSON.stringify({ role: nextPrimary }),
          });
        } catch {
          /* ignore */
        }
      }
    } else {
      console.warn("[account-roles] profiles.roles persist failed", err?.message || err);
    }
  }
  return roles;
}

export async function addRoleToUser(userId, roleToAdd, { primaryRole = "", existingProfile = null, authUser = null } = {}) {
  const add = normalizeRoleName(roleToAdd);
  const companion = add === "companion" ? await loadCompanionRowForUser(userId) : null;
  const current = resolveRoles(existingProfile || { id: userId, role: primaryRole }, { companion, authUser });
  const next = uniq([...current, add]);
  // If adding companion to an existing Boss, keep boss primary.
  const existingPrimary = normalizeRoleName(existingProfile?.role || primaryRole || "");
  const keepPrimary =
    current.includes("boss") || BOSS_ALIASES.has(existingPrimary)
      ? "boss"
      : primaryRole || existingProfile?.role || add;
  await persistRoles(userId, next, { primaryRole: keepPrimary });
  return next;
}

/**
 * Same human: boss profile id === companion profile user id (orders.companion_id stores profiles.id).
 */
export function isSamePerson(bossUserId, companionUserId) {
  const a = String(bossUserId || "").trim();
  const b = String(companionUserId || "").trim();
  return !!a && !!b && a === b;
}

export function assertNotSelfTrade(bossUserId, companionUserId, actionLabel = "该操作") {
  if (isSamePerson(bossUserId, companionUserId)) {
    const err = new Error(`不能${actionLabel}：老板与陪玩属于同一账号（user_id）。`);
    err.status = 403;
    err.code = "SELF_TRADE_FORBIDDEN";
    throw err;
  }
}

export async function resolveCompanionUserIdFlexible(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  try {
    const byUser = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=id,role&limit=1`),
      { headers: headersWithServiceRole() }
    );
    if (Array.isArray(byUser) && byUser[0]?.id) {
      const cp = await loadCompanionRowForUser(byUser[0].id);
      if (cp) return byUser[0].id;
    }
  } catch {
    /* continue */
  }
  try {
    const byCpId = await supabaseJson(
      restUrl("companion_profiles", `?id=eq.${encodeURIComponent(id)}&select=user_id&limit=1`),
      { headers: headersWithServiceRole() }
    );
    if (Array.isArray(byCpId) && byCpId[0]?.user_id) return byCpId[0].user_id;
  } catch {
    /* continue */
  }
  const code = id.toUpperCase();
  if (/^PW\d+$/i.test(code) || /^P\d+$/i.test(code)) {
    try {
      const byCode = await supabaseJson(
        restUrl("companion_profiles", `?companion_code=eq.${encodeURIComponent(code)}&select=user_id&limit=1`),
        { headers: headersWithServiceRole() }
      );
      if (Array.isArray(byCode) && byCode[0]?.user_id) return byCode[0].user_id;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export async function findProfilesByEmail(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return [];
  const selects = [
    "id,email,role,roles,status,display_name,created_at,boss_uid",
    "id,email,role,status,display_name,created_at,boss_uid",
    "id,email,role,status,display_name,created_at",
  ];
  for (const select of selects) {
    try {
      const rows = await supabaseJson(
        restUrl("profiles", `?email=eq.${encodeURIComponent(email)}&select=${select}&limit=20`),
        { headers: headersWithServiceRole() }
      );
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      if (!/roles|column|schema cache|PGRST/i.test(String(err?.message || ""))) return [];
    }
  }
  return [];
}

/** Block invite/bind rebate when beneficiary is the same user_id. */
export function assertNotSelfRebate(beneficiaryUserId, sourceUserId, label = "返利") {
  if (isSamePerson(beneficiaryUserId, sourceUserId)) {
    const err = new Error(`不能产生自己给自己的${label}。`);
    err.status = 403;
    err.code = "SELF_REBATE_FORBIDDEN";
    throw err;
  }
}

/**
 * Scan profiles for duplicate normalized emails (trim+lower).
 * Does not mutate data — returns groups for safe merge planning.
 */
export async function scanDuplicateEmails({ limit = 2000 } = {}) {
  const selects = [
    "id,email,role,roles,status,display_name,created_at,boss_uid",
    "id,email,role,status,display_name,created_at,boss_uid",
    "id,email,role,status,display_name,created_at",
  ];
  let rows = [];
  for (const select of selects) {
    try {
      rows = await supabaseJson(
        restUrl("profiles", `?email=not.is.null&select=${select}&order=created_at.asc&limit=${Math.max(50, Number(limit) || 2000)}`),
        { headers: headersWithServiceRole() }
      );
      if (Array.isArray(rows)) break;
    } catch (err) {
      if (!/roles|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    }
  }
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeEmail(row.email);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const duplicates = [];
  for (const [email, list] of map.entries()) {
    if (list.length > 1) duplicates.push({ email, count: list.length, users: list });
  }
  return { scanned: Array.isArray(rows) ? rows.length : 0, duplicateGroups: duplicates };
}

export default {
  computeCapabilities,
  evaluateBossEvidence,
  preferredPrimaryRole,
  companionActivationProfilePatch,
  hasBossRole,
  hasCompanionRole,
  enrichProfileRoles,
  resolveRoles,
  publicRolesPayload,
};
