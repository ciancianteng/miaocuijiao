/**
 * Unified account roles: one email → one profiles.id (auth user id).
 * Roles may include boss + companion on the same user_id.
 *
 * SoT:
 * - auth.users email uniqueness (platform)
 * - profiles.id = auth user id
 * - companion_profiles.user_id unique → companion capability
 * - optional profiles.roles text[] / auth app_metadata.roles
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

/** Derive roles from profile row + optional companion row + auth metadata. */
export function resolveRoles(profile = {}, { companion = null, authUser = null, grantBossWithCompanion = true } = {}) {
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

  const primary = normalizeRoleName(profile?.role);
  if (primary) collected.push(primary);

  if (companion && companion.id) collected.push("companion");

  let roles = uniq(collected);
  // Product rule: companion accounts may use boss portal (shop/order) on the same user_id.
  if (grantBossWithCompanion && roles.includes("companion") && !roles.includes("boss")) {
    roles = uniq([...roles, "boss"]);
  }
  // Staff roles stay exclusive unless explicitly stored.
  if (roles.includes("admin") || roles.includes("super_admin") || roles.includes("customer_service")) {
    return roles;
  }
  if (!roles.length && primary) roles = [primary];
  return roles;
}

export function hasRole(profile, role, opts) {
  const want = normalizeRoleName(role);
  return resolveRoles(profile, opts).includes(want);
}

export function hasBossRole(profile, opts) {
  return hasRole(profile, "boss", opts);
}

export function hasCompanionRole(profile, opts) {
  return hasRole(profile, "companion", opts);
}

export function publicRolesPayload(profile, opts) {
  const roles = resolveRoles(profile, opts);
  return {
    roles,
    hasBoss: roles.includes("boss"),
    hasCompanion: roles.includes("companion"),
    primaryRole: normalizeRoleName(profile?.role) || roles[0] || "",
  };
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

export async function enrichProfileRoles(profile, authUser = null) {
  if (!profile?.id) return { profile, companion: null, roles: [], ...publicRolesPayload({}, {}) };
  const companion = await loadCompanionRowForUser(profile.id);
  const rolesInfo = publicRolesPayload(profile, { companion, authUser });
  return {
    profile: { ...profile, roles: rolesInfo.roles },
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
