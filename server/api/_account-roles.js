/**
 * Unified account roles / capabilities: one email → one profiles.id (auth user id).
 * Capabilities may include boss + companion on the same user_id (additive, not exclusive).
 *
 * SoT:
 * - auth.users email uniqueness (platform)
 * - profiles.id = auth user id
 * - profiles.role = primary role column (always present)
 * - companion_profiles.user_id unique → companion capability
 * - optional in-memory / auth metadata roles (profiles.roles column may be absent — never require it)
 * - hasBoss / hasCompanion are the single portal-gate authorities
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

export function isBossLikeRole(role) {
  return BOSS_ALIASES.has(normalizeRoleName(role)) || normalizeRoleName(role) === "boss";
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

function pushRoleHints(collected, value) {
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) pushRoleHints(collected, item);
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          pushRoleHints(collected, parsed);
          return;
        }
      } catch {
        /* fall through */
      }
    }
    for (const part of trimmed.split(/[,\s|]+/)) {
      if (part) collected.push(part);
    }
    return;
  }
  collected.push(value);
}

/**
 * Collect role hints from profiles.role (required column), optional profile.roles if present
 * on the object, and Auth app/user metadata (roles arrays + singular role / primary_role).
 * Never assumes a profiles.roles DB column exists.
 */
export function collectRoleHints(profile = {}, authUser = null) {
  const collected = [];
  // Primary DB column — authoritative when set.
  pushRoleHints(collected, profile?.role);
  // Optional in-memory / legacy column if API returned it (ignore if absent).
  if (Object.prototype.hasOwnProperty.call(profile || {}, "roles")) {
    pushRoleHints(collected, profile.roles);
  }
  const app = authUser?.app_metadata || authUser?.raw_app_meta_data || {};
  const user = authUser?.user_metadata || authUser?.raw_user_meta_data || {};
  pushRoleHints(collected, app.roles);
  pushRoleHints(collected, user.roles);
  pushRoleHints(collected, app.role);
  pushRoleHints(collected, user.role);
  pushRoleHints(collected, app.primary_role);
  pushRoleHints(collected, user.primary_role);
  return uniq(collected);
}

/**
 * Single Boss capability resolver used by OTP login, password login, auth/me, and portal gates.
 *
 * hasBoss when ANY of:
 * - profiles.role is boss-like (boss/customer/owner/user)
 * - optional roles list / auth metadata explicitly includes boss-like role
 * - evidence.hasBossOrders / forceBoss (optional, never boss_uid alone)
 *
 * hasCompanion when companion_profiles exists OR role/meta says companion.
 */
export function computeCapabilities(profile = {}, opts = {}) {
  const companion = opts.companion || null;
  const authUser = opts.authUser || null;
  const evidence = opts.evidence || null;
  const hints = collectRoleHints(profile, authUser);
  if (companion && companion.id) hints.push("companion");

  let roles = uniq(hints);
  const primary = normalizeRoleName(profile?.role);
  const evidenceBoss =
    evidence?.forceBoss === true ||
    evidence?.hasBossOrders === true ||
    Number(evidence?.bossOrderCount || 0) > 0 ||
    evidence?.hasBossWallet === true;
  if (evidenceBoss && !roles.includes("boss")) roles = uniq([...roles, "boss"]);

  // profiles.role === boss (and aliases) ALWAYS grants hasBoss — never overridden by metadata noise.
  const roleIsBoss = isBossLikeRole(profile?.role);
  const metaOrListBoss = roles.includes("boss");
  const hasBoss = !!(roleIsBoss || metaOrListBoss || evidenceBoss);

  const hasCompanion =
    !!(companion && companion.id) ||
    roles.includes("companion") ||
    primary === "companion";

  if (hasBoss && !roles.includes("boss")) roles = uniq([...roles, "boss"]);
  if (hasCompanion && !roles.includes("companion")) roles = uniq([...roles, "companion"]);

  let primaryRole = primary || roles[0] || "";
  if (hasBoss && primaryRole === "companion") primaryRole = "boss";

  return {
    roles,
    hasBoss,
    hasCompanion,
    primaryRole,
  };
}

/** Portal gate helper — same rules for backend + shared with session user objects. */
export function userCanAccessPortal(userOrCaps = {}, portal = "") {
  const p = String(portal || "").trim().toLowerCase();
  const hasBoss = userOrCaps?.hasBoss === true || isBossLikeRole(userOrCaps?.role) || isBossLikeRole(userOrCaps?.primaryRole);
  const hasCompanion =
    userOrCaps?.hasCompanion === true ||
    normalizeRoleName(userOrCaps?.role) === "companion" ||
    normalizeRoleName(userOrCaps?.primaryRole) === "companion";
  const role = normalizeRoleName(userOrCaps?.role || userOrCaps?.primaryRole || "");
  if (p === "boss") return !!(hasBoss || role === "boss");
  if (p === "companion") return !!(hasCompanion || role === "companion");
  if (p === "customer_service") return role === "customer_service";
  if (p === "admin") return role === "admin" || role === "super_admin";
  return false;
}

/**
 * Derive roles list (compat). Prefer computeCapabilities for portal gates.
 */
export function resolveRoles(profile = {}, opts = {}) {
  return computeCapabilities(profile, opts).roles;
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

/**
 * Enrich profile with additive capabilities.
 * NEVER strips boss when primary is companion (capabilities are additive).
 * Does not require profiles.roles DB column.
 */
export async function enrichProfileRoles(profile, authUser = null, options = {}) {
  if (!profile?.id) return { profile, companion: null, roles: [], ...publicRolesPayload({}, {}) };
  const companion = options.companion !== undefined ? options.companion : await loadCompanionRowForUser(profile.id);
  const rolesInfo = publicRolesPayload(profile, {
    companion,
    authUser,
    evidence: options.evidence || null,
  });
  // Session-facing primary: if Boss capable, expose boss for portal gates even when DB primary was companion.
  const sessionRole =
    rolesInfo.hasBoss && normalizeRoleName(profile.role) === "companion" ? "boss" : profile.role;
  return {
    profile: {
      ...profile,
      role: sessionRole,
      ...(Array.isArray(rolesInfo.roles) ? { roles: rolesInfo.roles } : {}),
    },
    companion,
    ...rolesInfo,
  };
}

/** Persist roles to auth app_metadata + profiles.roles when column exists. */
export async function persistRoles(userId, rolesInput, { primaryRole = "" } = {}) {
  const roles = uniq(rolesInput);
  if (!userId || !roles.length) return roles;
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
    // Some projects require PATCH merge — try best-effort.
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
  if (primaryRole) patch.role = normalizeRoleName(primaryRole);
  try {
    await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: headersWithServiceRole({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
  } catch (err) {
    if (/roles|column|schema cache|PGRST/i.test(String(err?.message || ""))) {
      if (primaryRole) {
        try {
          await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}`), {
            method: "PATCH",
            headers: headersWithServiceRole({ Prefer: "return=minimal" }),
            body: JSON.stringify({ role: normalizeRoleName(primaryRole) }),
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
  await persistRoles(userId, next, { primaryRole: primaryRole || existingProfile?.role || add });
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
  // Direct profile id
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
