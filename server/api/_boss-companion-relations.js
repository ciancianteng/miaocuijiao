/**
 * Direct relation SoT (role-agnostic account → account).
 * Physical columns (legacy names, zero dual-write):
 *   boss_id       = beneficiary (earner / direct referrer)
 *   companion_id  = target (invitee)
 *
 * Rules: DIRECT ONLY · one active per target · first bind wins · admin rebind ·
 * no upline cascade in settlement · self/cycle forbidden.
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
const CYCLE_WALK_LIMIT = 32;

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}


function normalizeCommissionRate(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function requireAdminReason(reason, actionLabel = "操作") {
  const text = String(reason || "").trim();
  if (!text) {
    throw httpError(`管理员${actionLabel}必须填写 reason（审计：谁/何时/原因）`, 400, { code: "REASON_REQUIRED" });
  }
  return text;
}

async function maybeReevalBossLevel(bossId, operatorId, reason) {
  if (!bossId) return;
  try {
    const { reevaluateBossLevel } = await import("./_boss-levels.js");
    await reevaluateBossLevel({ bossId, operatorId, reason: reason || "relation_change" });
  } catch (_) {
    /* levels optional until migration applied */
  }
}

export function isRelationsMissing(error) {
  return isMissingRelation(error);
}

export function viewRelation(row = {}, extras = {}) {
  const boss = extras.boss || null;
  const companion = extras.companion || null;
  const companionProfile = extras.companionProfile || null;
  const beneficiaryId = row.boss_id || "";
  const targetId = row.companion_id || "";
  return {
    id: row.id || "",
    bossId: beneficiaryId,
    companionId: targetId,
    // Role-agnostic aliases (same physical columns)
    beneficiaryUserId: beneficiaryId,
    targetUserId: targetId,
    status: row.status || "",
    boundAt: row.bound_at || "",
    unboundAt: row.unbound_at || null,
    boundBy: row.bound_by || null,
    remark: row.remark || "",
    commissionRate: row.commission_rate == null || row.commission_rate === "" ? null : Number(row.commission_rate),
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
    beneficiary: boss
      ? {
          id: boss.id,
          displayName: boss.display_name || boss.nickname || boss.email || "",
          publicCode: resolveBossPublicCode(boss) || resolveCompanionPublicCode(null, boss),
          email: boss.email || "",
          role: boss.role || "",
        }
      : null,
    target: companion
      ? {
          id: companion.id,
          displayName: companion.display_name || companion.nickname || companion.email || "",
          publicCode:
            resolveCompanionPublicCode(companionProfile || companion, companion) ||
            resolveBossPublicCode(companion),
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
    reason: row.reason || "",
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
 * Assert bind parties exist (role-agnostic). Does not require boss/companion capability.
 * Does not write any capability fields.
 */
export async function assertBindCapabilities(bossId, companionId) {
  return assertBindParties(bossId, companionId);
}

/**
 * Role-agnostic party check + self-bind guard.
 * @param {string} beneficiaryId - earner (legacy boss_id)
 * @param {string} targetId - invitee (legacy companion_id)
 */
export async function assertBindParties(beneficiaryId, targetId) {
  const [beneficiary, target] = await Promise.all([
    loadProfile(beneficiaryId),
    loadProfile(targetId),
  ]);
  if (!beneficiary) throw httpError("直属受益人账号不存在", 404, { code: "BENEFICIARY_NOT_FOUND" });
  if (!target) throw httpError("目标账号不存在", 404, { code: "TARGET_NOT_FOUND" });
  if (String(beneficiaryId) === String(targetId)) {
    throw httpError("不能绑定自己", 400, { code: "SELF_BIND_FORBIDDEN" });
  }
  const beneficiaryStatus = String(beneficiary.status || "active").toLowerCase();
  const targetStatus = String(target.status || "active").toLowerCase();
  if (beneficiaryStatus && beneficiaryStatus !== "active") {
    throw httpError("直属受益人账号未激活", 400, { code: "BENEFICIARY_INACTIVE" });
  }
  if (targetStatus && targetStatus !== "active") {
    throw httpError("目标账号未激活", 400, { code: "TARGET_INACTIVE" });
  }
  await assertNoRelationCycle(beneficiaryId, targetId);
  // companionRow kept for callers that still enrich companion codes (optional)
  const companionRow = await loadCompanionRowForUser(targetId).catch(() => null);
  return {
    boss: beneficiary,
    companion: target,
    beneficiary,
    target,
    companionRow,
  };
}

/**
 * Walk beneficiary → their beneficiary … ; reject if target appears (cycle / mutual).
 * Settlement never walks this chain — bind-time only.
 */
export async function assertNoRelationCycle(beneficiaryId, targetId) {
  const beneficiary = String(beneficiaryId || "").trim();
  const target = String(targetId || "").trim();
  if (!beneficiary || !target) return;
  if (beneficiary === target) {
    throw httpError("不能绑定自己", 400, { code: "SELF_BIND_FORBIDDEN" });
  }
  let cursor = beneficiary;
  const seen = new Set();
  for (let i = 0; i < CYCLE_WALK_LIMIT; i++) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const rel = await getActiveRelationForCompanion(cursor);
    if (!rel?.boss_id) break;
    if (String(rel.boss_id) === target) {
      throw httpError("禁止形成直属闭环（cycle）", 400, { code: "CYCLE_FORBIDDEN" });
    }
    cursor = String(rel.boss_id);
  }
}

async function insertEvent(payload) {
  const rows = await supabaseJson(restUrl(EVT_TABLE), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Active relation for target (legacy companion_id). */
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

/** Alias: active relation where user is the target/invitee. */
export async function getActiveRelationForTarget(targetUserId) {
  return getActiveRelationForCompanion(targetUserId);
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
  const beneficiaryIds = found.bossIds.length ? found.bossIds : found.profileIds;
  const targetIds = found.companionIds.length ? found.companionIds : found.profileIds;
  if (beneficiaryIds.length) {
    orParts.push(`boss_id.in.(${beneficiaryIds.map((id) => `"${id}"`).join(",")})`);
  }
  if (targetIds.length) {
    orParts.push(`companion_id.in.(${targetIds.map((id) => `"${id}"`).join(",")})`);
  }
  // Also match any profile id on either side (role-agnostic)
  if (found.profileIds.length) {
    orParts.push(`boss_id.in.(${found.profileIds.map((id) => `"${id}"`).join(",")})`);
    orParts.push(`companion_id.in.(${found.profileIds.map((id) => `"${id}"`).join(",")})`);
  }
  if (!orParts.length) return [];

  const parts = [
    `select=*`,
    `or=(${[...new Set(orParts)].join(",")})`,
    `order=bound_at.desc`,
    `limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`,
  ];
  if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
  const rows = await supabaseJson(restUrl(REL_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return enrichRelations(Array.isArray(rows) ? rows : []);
}

export async function bindRelation({
  bossId,
  companionId,
  beneficiaryId = "",
  targetId = "",
  operatorId,
  remark = "",
  commissionRate = null,
  reason = "",
} = {}) {
  const beneficiary = String(beneficiaryId || bossId || "").trim();
  const target = String(targetId || companionId || "").trim();
  const auditReason = requireAdminReason(reason, "绑定");
  const caps = await assertBindParties(beneficiary, target);
  const existing = await getActiveRelationForCompanion(target);
  if (existing) {
    if (existing.boss_id === beneficiary) {
      throw httpError("该账号已绑定到此直属受益人", 409, { code: "ALREADY_BOUND" });
    }
    throw httpError("该账号已有 active 直属受益人，请使用 rebind（或联系管理员）", 409, {
      code: "ACTIVE_EXISTS",
      activeRelationId: existing.id,
      activeBossId: existing.boss_id,
      activeBeneficiaryId: existing.boss_id,
      messageHint: "已有账号如需绑定/调整直属关系，请联系管理员。",
    });
  }

  const payload = {
    boss_id: beneficiary,
    companion_id: target,
    status: ACTIVE,
    bound_at: nowIso(),
    unbound_at: null,
    bound_by: operatorId || null,
    remark: String(remark || "").trim() || null,
  };
  const rateNum = normalizeCommissionRate(commissionRate);
  if (rateNum != null) payload.commission_rate = rateNum;
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
      throw httpError("该账号已有 active 直属受益人，请使用 rebind", 409, { code: "ACTIVE_EXISTS" });
    }
    throw error;
  }

  await insertEvent({
    relation_id: created.id,
    companion_id: target,
    from_boss_id: null,
    to_boss_id: beneficiary,
    action: "bind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
    reason: auditReason,
  });

  await maybeReevalBossLevel(beneficiary, operatorId, auditReason);

  const [enriched] = await enrichRelations([created]);
  return {
    relation: enriched,
    boss: caps.boss,
    companion: caps.companion,
    beneficiary: caps.beneficiary,
    target: caps.target,
  };
}

export async function rebindRelation({
  companionId,
  newBossId,
  targetId = "",
  newBeneficiaryId = "",
  operatorId,
  remark = "",
  commissionRate = null,
  reason = "",
} = {}) {
  const target = String(targetId || companionId || "").trim();
  const newBeneficiary = String(newBeneficiaryId || newBossId || "").trim();
  const auditReason = requireAdminReason(reason, "换绑");
  const caps = await assertBindParties(newBeneficiary, target);
  const existing = await getActiveRelationForCompanion(target);
  if (!existing) {
    throw httpError("该账号当前没有 active 直属关系，请使用 bind", 404, { code: "NO_ACTIVE" });
  }
  if (existing.boss_id === newBeneficiary) {
    throw httpError("新直属受益人与当前相同", 400, { code: "SAME_BOSS" });
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
    body: JSON.stringify((() => {
      const payload = {
        boss_id: newBeneficiary,
        companion_id: target,
        status: ACTIVE,
        bound_at: ts,
        unbound_at: null,
        bound_by: operatorId || null,
        remark: String(remark || "").trim() || null,
      };
      const rateNum =
        commissionRate != null && commissionRate !== ""
          ? normalizeCommissionRate(commissionRate)
          : existing.commission_rate != null
            ? normalizeCommissionRate(existing.commission_rate)
            : null;
      if (rateNum != null) payload.commission_rate = rateNum;
      return payload;
    })()),
  });
  const created = Array.isArray(rows) ? rows[0] : rows;

  await insertEvent({
    relation_id: created.id,
    companion_id: target,
    from_boss_id: existing.boss_id,
    to_boss_id: newBeneficiary,
    action: "rebind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
    reason: auditReason,
  });
  await maybeReevalBossLevel(existing.boss_id, operatorId, auditReason);
  await maybeReevalBossLevel(newBeneficiary, operatorId, auditReason);

  const [enriched] = await enrichRelations([created]);
  return {
    relation: enriched,
    previousRelationId: existing.id,
    fromBossId: existing.boss_id,
    fromBeneficiaryId: existing.boss_id,
    boss: caps.boss,
    companion: caps.companion,
    beneficiary: caps.beneficiary,
    target: caps.target,
  };
}

export async function unbindRelation({ companionId, targetId = "", operatorId, remark = "", reason = "" } = {}) {
  const target = String(targetId || companionId || "").trim();
  const auditReason = requireAdminReason(reason, "解绑");
  const existing = await getActiveRelationForCompanion(target);
  if (!existing) {
    throw httpError("该账号当前没有 active 直属关系", 404, { code: "NO_ACTIVE" });
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
    companion_id: target,
    from_boss_id: existing.boss_id,
    to_boss_id: null,
    action: "unbind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || null,
    reason: auditReason,
  });
  await maybeReevalBossLevel(existing.boss_id, operatorId, auditReason);

  const updated = { ...existing, status: UNBOUND, unbound_at: ts };
  const [enriched] = await enrichRelations([updated]);
  return { relation: enriched };
}


export async function updateRelationCommissionRate({ relationId, companionId, commissionRate, operatorId, remark = "", reason = "" } = {}) {
  const auditReason = requireAdminReason(reason, "设置分成");
  let row = null;
  if (relationId) {
    const rows = await supabaseJson(
      restUrl(REL_TABLE, `?id=eq.${encodeURIComponent(relationId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    row = rows?.[0] || null;
  } else if (companionId) {
    row = await getActiveRelationForCompanion(companionId);
  }
  if (!row) throw httpError("直属关系不存在", 404, { code: "NOT_FOUND" });
  if (String(row.status) !== ACTIVE) {
    throw httpError("只能修改 active 直属关系的分成比例", 409, { code: "NOT_ACTIVE" });
  }
  const rateNum = normalizeCommissionRate(commissionRate);
  if (rateNum == null) throw httpError("分成比例无效（0-100）", 400, { code: "BAD_RATE" });

  const rows = await supabaseJson(restUrl(REL_TABLE, `?id=eq.${encodeURIComponent(row.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ commission_rate: rateNum }),
  });
  const updated = Array.isArray(rows) ? rows[0] : rows;

  await insertEvent({
    relation_id: row.id,
    companion_id: row.companion_id,
    from_boss_id: row.boss_id,
    to_boss_id: row.boss_id,
    action: "bind",
    operator_id: operatorId || null,
    remark: String(remark || "").trim() || `更新直属分成比例为 ${rateNum}%`,
    reason: auditReason,
  }).catch(() => null);

  const [enriched] = await enrichRelations([updated || { ...row, commission_rate: rateNum }]);
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

export {
  ACTIVE,
  UNBOUND,
  REPLACED,
  REL_TABLE,
  EVT_TABLE,
  CYCLE_WALK_LIMIT,
};
