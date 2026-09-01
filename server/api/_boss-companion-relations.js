/**
 * Boss ↔ Companion 直属关系（运营关系 SoT）。
 * Independent from invitation / referral / orders / capability.
 *
 * Invariant (verified on Staging): auth.uid() === profiles.id
 * API still resolves profiles by auth user id explicitly (same as requireAdmin/requireBoss).
 *
 * Capability: bind/rebind MUST use hasBossRole / hasCompanionRole from _account-roles.js.
 * This module NEVER mutates profiles.role / companion capability / auth metadata.
 */
import {
  hasBossRole,
  hasCompanionRole,
  loadCompanionRowForUser,
} from "./_account-roles.js";
import {
  resolveBossPublicCode,
  resolveCompanionPublicCode,
} from "./_account-codes.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const REL_TABLE = "boss_companion_relations";
const EVT_TABLE = "boss_companion_relation_events";
const ACTIVE = "active";
const UNBOUND = "unbound";
const REPLACED = "replaced";

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function isRelationsMissing(error) {
  return isMissingRelation(error);
}

export function viewRelation(row = {}, extras = {}) {
  const boss = extras.boss || null;
  const companion = extras.companion || null;
  const companionProfile = extras.companionProfile || null;
  return {
    id: row.id || "",
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    status: row.status || "",
    boundAt: row.bound_at || "",
    unboundAt: row.unbound_at || null,
    boundBy: row.bound_by || null,
    remark: row.remark || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    boss: boss
      ? {
          id: boss.id,
          displayName: boss.display_name || boss.nickname || boss.email || "",
          bossUid: resolveBossPublicCode(boss),
          email: boss.email || "",
          role: boss.role || "",
        }
      : null,
    companion: companion
      ? {
          id: companion.id,
          displayName: companion.display_name || companion.nickname || companion.email || "",
          companionCode: resolveCompanionPublicCode(companionProfile || companion, companion),
          email: companion.email || "",
          role: companion.role || "",
        }
      : null,
  };
}

export function viewEvent(row = {}, extras = {}) {
  return {
    id: row.id || "",
    relationId: row.relation_id || null,
    companionId: row.companion_id || "",
    fromBossId: row.from_boss_id || null,
    toBossId: row.to_boss_id || null,
    action: row.action || "",
    operatorId: row.operator_id || null,
    remark: row.remark || "",
    createdAt: row.created_at || "",
    fromBoss: extras.fromBoss
      ? {
          id: extras.fromBoss.id,
          displayName: extras.fromBoss.display_name || extras.fromBoss.nickname || "",
          bossUid: resolveBossPublicCode(extras.fromBoss),
        }
      : null,
    toBoss: extras.toBoss
      ? {
          id: extras.toBoss.id,
          displayName: extras.toBoss.display_name || extras.toBoss.nickname || "",
          bossUid: resolveBossPublicCode(extras.toBoss),
        }
      : null,
  };
}

async function loadProfile(id) {
  if (!id) return null;
  const rows = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadProfilesByIds(ids = []) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await supabaseJson(
    restUrl(
      "profiles",
      `?id=in.(${uniq.map((id) => `"${id}"`).join(",")})&select=*`
    ),
    { headers: serviceHeaders() }
  );
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}

async function loadCompanionProfilesByUserIds(ids = []) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await supabaseJson(
    restUrl(
      "companion_profiles",
      `?user_id=in.(${uniq.map((id) => `"${id}"`).join(",")})&select=*`
    ),
    { headers: serviceHeaders() }
  );
  const map = new Map();
  for (const row of rows || []) {
    if (row?.user_id && !map.has(row.user_id)) map.set(row.user_id, row);
  }
  return map;
}

export async function enrichRelations(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const bossIds = list.map((r) => r.boss_id);
  const companionIds = list.map((r) => r.companion_id);
  const [profiles, companions] = await Promise.all([
    loadProfilesByIds([...bossIds, ...companionIds]),
    loadCompanionProfilesByUserIds(companionIds),
  ]);
  return list.map((row) =>
    viewRelation(row, {
      boss: profiles.get(row.boss_id) || null,
      companion: profiles.get(row.companion_id) || null,
      companionProfile: companions.get(row.companion_id) || null,
    })
  );
}

export async function enrichEvents(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const bossIds = [...list.map((r) => r.from_boss_id), ...list.map((r) => r.to_boss_id)];
  const profiles = await loadProfilesByIds(bossIds);
  return list.map((row) =>
    viewEvent(row, {
      fromBoss: row.from_boss_id ? profiles.get(row.from_boss_id) || null : null,
      toBoss: row.to_boss_id ? profiles.get(row.to_boss_id) || null : null,
    })
  );
}

/**
 * Assert bind targets have required capabilities (#128 shared resolver).
 * Does not write any capability fields.
 */
export async function assertBindCapabilities(bossId, companionId) {
  const [boss, companion, companionRow] = await Promise.all([
    loadProfile(bossId),
    loadProfile(companionId),
    loadCompanionRowForUser(companionId),
  ]);
  if (!boss) throw httpError("老板账号不存在", 404);
  if (!companion) throw httpError("陪玩账号不存在", 404);
  if (bossId === companionId) throw httpError("不能绑定自己", 400);

  if (!hasBossRole(boss)) {
    throw httpError("目标账号没有 Boss 能力（hasBoss=false），禁止绑定", 400, {
      code: "BOSS_CAPABILITY_REQUIRED",
    });
  }
  if (!hasCompanionRole(companion, { companion: companionRow })) {
    throw httpError("目标账号没有 Companion 能力（hasCompanion=false），禁止绑定", 400, {
      code: "COMPANION_CAPABILITY_REQUIRED",
    });
  }
  return { boss, companion, companionRow };
}

async function insertEvent(payload) {
  const rows = await supabaseJson(restUrl(EVT_TABLE), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function getActiveRelationForCompanion(companionId) {
  if (!companionId) return null;
  const rows = await supabaseJson(
    restUrl(
      REL_TABLE,
      `?companion_id=eq.${encodeURIComponent(companionId)}&status=eq.${ACTIVE}&order=bound_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function listActiveRelationsForBoss(bossId) {
  if (!bossId) return [];
  const rows = await supabaseJson(
    restUrl(
      REL_TABLE,
      `?boss_id=eq.${encodeURIComponent(bossId)}&status=eq.${ACTIVE}&order=bound_at.desc&limit=500`
    ),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function listRelations({
  status = "",
  bossId = "",
  companionId = "",
  limit = 100,
} = {}) {
  const parts = [`select=*`, `order=bound_at.desc`, `limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`];
  if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
  if (bossId) parts.push(`boss_id=eq.${encodeURIComponent(bossId)}`);
  if (companionId) parts.push(`companion_id=eq.${encodeURIComponent(companionId)}`);
  const rows = await supabaseJson(restUrl(REL_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listRelationEvents({
  companionId = "",
  relationId = "",
  limit = 100,
} = {}) {
  const parts = [`select=*`, `order=created_at.desc`, `limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`];
  if (companionId) parts.push(`companion_id=eq.${encodeURIComponent(companionId)}`);
  if (relationId) parts.push(`relation_id=eq.${encodeURIComponent(relationId)}`);
  const rows = await supabaseJson(restUrl(EVT_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Resolve profile ids from display codes / email / name for admin search.
 * boss_uid is display/search only — FK always uses profiles.id.
 */
export async function searchProfileIds({ q = "", roleHint = "" } = {}) {
  const query = String(q || "").trim();
  if (!query) return { bossIds: [], companionIds: [], profileIds: [] };

  const ids = new Set();
  const bossIds = new Set();
  const companionIds = new Set();

  // Exact id
  if (/^[0-9a-f-]{36}$/i.test(query)) {
    ids.add(query);
  }

  // Boss UID search
  if (/^MCJ/i.test(query) || roleHint === "boss") {
    const bossUid = /^MCJ/i.test(query) ? query.toUpperCase() : query;
    try {
      const rows = await supabaseJson(
        restUrl(
          "profiles",
          `?boss_uid=ilike.*${encodeURIComponent(bossUid)}*&select=id,boss_uid,role&limit=50`
        ),
        { headers: serviceHeaders() }
      );
      for (const row of rows || []) {
        ids.add(row.id);
        bossIds.add(row.id);
      }
    } catch {
      /* ignore */
    }
  }

  // Companion code → companion_profiles
  if (/^PW/i.test(query) || /^P\d+$/i.test(query) || roleHint === "companion") {
    try {
      const code = query.toUpperCase().replace(/^P(\d+)$/i, (_, n) => `PW${String(n).padStart(5, "0")}`);
      const rows = await supabaseJson(
        restUrl(
          "companion_profiles",
          `?or=(companion_code.ilike.*${encodeURIComponent(code)}*,companion_code.eq.${encodeURIComponent(code)})&select=user_id,companion_code,companion_uid&limit=50`
        ),
        { headers: serviceHeaders() }
      );
      for (const row of rows || []) {
        if (row.user_id) {
          ids.add(row.user_id);
          companionIds.add(row.user_id);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Email / display_name fuzzy
  try {
    const like = encodeURIComponent(`*${query}*`);
    const rows = await supabaseJson(
      restUrl(
        "profiles",
        `?or=(email.ilike.${like},display_name.ilike.${like},nickname.ilike.${like})&select=id,role,email,display_name&limit=50`
      ),
      { headers: serviceHeaders() }
    );
    for (const row of rows || []) {
      ids.add(row.id);
      if (hasBossRole(row)) bossIds.add(row.id);
      if (hasCompanionRole(row)) companionIds.add(row.id);
    }
  } catch {
    /* ignore */
  }

  return {
    profileIds: [...ids],
    bossIds: [...bossIds],
    companionIds: [...companionIds],
  };
}

export async function adminSearchRelations({ q = "", status = "", limit = 100 } = {}) {
  const query = String(q || "").trim();
  if (!query) {
    const rows = await listRelations({ status, limit });
    return enrichRelations(rows);
  }
  const found = await searchProfileIds({ q: query });
  const orParts = [];
  if (found.bossIds.length) {
    orParts.push(`boss_id.in.(${found.bossIds.map((id) => `"${id}"`).join(",")})`);
  }
  if (found.companionIds.length || found.profileIds.length) {
    const cids = found.companionIds.length ? found.companionIds : found.profileIds;
    orParts.push(`companion_id.in.(${cids.map((id) => `"${id}"`).join(",")})`);
  }
  if (!orParts.length) return [];

  const parts = [
    `select=*`,
    `or=(${orParts.join(",")})`,
    `order=bound_at.desc`,
    `limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`,
  ];
  if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
  const rows = await supabaseJson(restUrl(REL_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return enrichRelations(Array.isArray(rows) ? rows : []);
}

export async function bindRelation({ bossId, companionId, operatorId, remark = "" } = {}) {
  const caps = await assertBindCapabilities(bossId, companionId);
  const existing = await getActiveRelationForCompanion(companionId);
  if (existing) {
    if (existing.boss_id === bossId) {
      throw httpError("该陪玩已绑定到此老板", 409, { code: "ALREADY_BOUND" });
    }
    throw httpError("该陪玩已有 active 直属老板，请使用 rebind", 409, {
      code: "ACTIVE_EXISTS",
      activeRelationId: existing.id,
      activeBossId: existing.boss_id,
    });
  }

  const payload = {
    boss_id: bossId,
    companion_id: companionId,
    status: ACTIVE,
    bound_at: nowIso(),
    unbound_at: null,
    bound_by: operatorId || null,
    remark: String(remark || "").trim() || null,
  };
  let created;
  try {
    const rows = await supabaseJson(restUrl(REL_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    created = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (String(error?.message || "").includes("uq_boss_companion_relations_active_companion")) {
      throw httpError("该陪玩已有 active 直属老板，请使用 rebind", 409, { code: "ACTIVE_EXISTS" });
    }
    throw error;
  }

  await insertEvent({
    relation_id: created.id,
    companion_id: companionId,
    from_boss_id: null,
    to_boss_id: bossId,
    action: "bind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
  });

  const [enriched] = await enrichRelations([created]);
  return { relation: enriched, boss: caps.boss, companion: caps.companion };
}

export async function rebindRelation({ companionId, newBossId, operatorId, remark = "" } = {}) {
  const caps = await assertBindCapabilities(newBossId, companionId);
  const existing = await getActiveRelationForCompanion(companionId);
  if (!existing) {
    throw httpError("该陪玩当前没有 active 直属关系，请使用 bind", 404, { code: "NO_ACTIVE" });
  }
  if (existing.boss_id === newBossId) {
    throw httpError("新老板与当前老板相同", 400, { code: "SAME_BOSS" });
  }

  const ts = nowIso();
  // Mark old as replaced (preserve history — never overwrite boss_id in place)
  await supabaseJson(restUrl(REL_TABLE, `?id=eq.${encodeURIComponent(existing.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      status: REPLACED,
      unbound_at: ts,
      remark: existing.remark || null,
    }),
  });

  const rows = await supabaseJson(restUrl(REL_TABLE), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      boss_id: newBossId,
      companion_id: companionId,
      status: ACTIVE,
      bound_at: ts,
      unbound_at: null,
      bound_by: operatorId || null,
      remark: String(remark || "").trim() || null,
    }),
  });
  const created = Array.isArray(rows) ? rows[0] : rows;

  await insertEvent({
    relation_id: created.id,
    companion_id: companionId,
    from_boss_id: existing.boss_id,
    to_boss_id: newBossId,
    action: "rebind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
  });

  const [enriched] = await enrichRelations([created]);
  return {
    relation: enriched,
    previousRelationId: existing.id,
    fromBossId: existing.boss_id,
    boss: caps.boss,
    companion: caps.companion,
  };
}

export async function unbindRelation({ companionId, operatorId, remark = "" } = {}) {
  const existing = await getActiveRelationForCompanion(companionId);
  if (!existing) {
    throw httpError("该陪玩当前没有 active 直属关系", 404, { code: "NO_ACTIVE" });
  }
  const ts = nowIso();
  await supabaseJson(restUrl(REL_TABLE, `?id=eq.${encodeURIComponent(existing.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      status: UNBOUND,
      unbound_at: ts,
    }),
  });

  await insertEvent({
    relation_id: existing.id,
    companion_id: companionId,
    from_boss_id: existing.boss_id,
    to_boss_id: null,
    action: "unbind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
  });

  const updated = { ...existing, status: UNBOUND, unbound_at: ts };
  const [enriched] = await enrichRelations([updated]);
  return { relation: enriched };
}

export async function resolveBossIdFromInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^[0-9a-f-]{36}$/i.test(value)) return value;
  const found = await searchProfileIds({ q: value, roleHint: "boss" });
  if (found.bossIds[0]) return found.bossIds[0];
  if (found.profileIds[0]) return found.profileIds[0];
  return "";
}

export async function resolveCompanionIdFromInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^[0-9a-f-]{36}$/i.test(value)) return value;
  const found = await searchProfileIds({ q: value, roleHint: "companion" });
  if (found.companionIds[0]) return found.companionIds[0];
  if (found.profileIds[0]) return found.profileIds[0];
  return "";
}

export { ACTIVE, UNBOUND, REPLACED, REL_TABLE, EVT_TABLE };
