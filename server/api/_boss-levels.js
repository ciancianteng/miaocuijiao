/**
 * Boss level system (platform incentive tiers).
 * Levels configure required_active_companions + commission_rate (% of platform_fee).
 * Manual pin: permanent | until_expiry | none(auto).
 * Historical settled earnings never rewritten when level changes.
 */
import { money } from "./_commission-rates.js";
import { listActiveRelationsForBoss } from "./_boss-companion-relations.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const LEVELS_TABLE = "boss_levels";
const ASSIGN_TABLE = "boss_level_assignments";
const EVT_TABLE = "boss_level_events";

function nowIso() {
  return new Date().toISOString();
}
function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function viewBossLevel(row = {}) {
  return {
    id: row.id || "",
    code: row.code || "",
    name: row.name || "",
    requiredActiveCompanions: Number(row.required_active_companions || 0),
    commissionRate: money(row.commission_rate),
    effectiveFrom: row.effective_from || "",
    sortOrder: Number(row.sort_order || 0),
    isEnabled: row.is_enabled !== false,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export function viewBossLevelAssignment(row = {}, level = null) {
  return {
    bossId: row.boss_id || "",
    levelId: row.level_id || "",
    source: row.source || "auto",
    pinMode: row.pin_mode || "none",
    pinExpiresAt: row.pin_expires_at || null,
    effectiveAt: row.effective_at || "",
    assignedBy: row.assigned_by || null,
    reason: row.reason || "",
    note: row.note || "",
    level: level ? viewBossLevel(level) : null,
  };
}

export async function listBossLevels({ includeDisabled = false } = {}) {
  const q = includeDisabled
    ? "?select=*&order=sort_order.asc"
    : "?select=*&is_enabled=eq.true&order=sort_order.asc";
  const rows = await supabaseJson(restUrl(LEVELS_TABLE, q), { headers: serviceHeaders() });
  return (Array.isArray(rows) ? rows : []).map(viewBossLevel);
}

export async function getBossLevelById(levelId) {
  if (!levelId) return null;
  const rows = await supabaseJson(
    restUrl(LEVELS_TABLE, `?id=eq.${encodeURIComponent(levelId)}&limit=1`),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

export async function getBossLevelByCode(code) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return null;
  const rows = await supabaseJson(
    restUrl(LEVELS_TABLE, `?code=eq.${encodeURIComponent(c)}&limit=1`),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

/** Soft readiness probe for Admin UI / API. */
export async function ensureBossLevelsReady() {
  try {
    await listBossLevels({ includeDisabled: true });
    return { ok: true };
  } catch (err) {
    if (isMissingRelation(err)) {
      return { ok: false, error: "boss_levels_table_missing" };
    }
    return { ok: false, error: err?.message || "boss_levels_unavailable" };
  }
}

export async function upsertBossLevel(input = {}, operatorId = null) {
  const id = String(input.id || input.code || "").trim() || `boss_lv_${Date.now()}`;
  const code = String(input.code || id).trim().toLowerCase();
  if (!code) throw httpError("缺少等级 code", 400);
  const name = String(input.name || code).trim();
  const required = Math.max(0, Math.floor(Number(input.requiredActiveCompanions ?? input.required_active_companions ?? 0)));
  const rate = Math.min(100, Math.max(0, money(input.commissionRate ?? input.commission_rate ?? 0)));
  const payload = {
    id,
    code,
    name,
    required_active_companions: required,
    commission_rate: rate,
    effective_from: input.effectiveFrom || input.effective_from || nowIso(),
    sort_order: Number(input.sortOrder ?? input.sort_order ?? 100),
    is_enabled: input.isEnabled !== false && input.is_enabled !== false,
    updated_at: nowIso(),
  };
  const rows = await supabaseJson(restUrl(LEVELS_TABLE, "?on_conflict=id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  return { level: viewBossLevel(Array.isArray(rows) ? rows[0] : rows), operatorId };
}

export async function getBossLevelAssignment(bossId) {
  if (!bossId) return null;
  const rows = await supabaseJson(
    restUrl(ASSIGN_TABLE, `?boss_id=eq.${encodeURIComponent(bossId)}&limit=1`),
    { headers: serviceHeaders() }
  ).catch((err) => {
    if (isMissingRelation(err)) return [];
    throw err;
  });
  return rows?.[0] || null;
}

function pinStillActive(assignment, now = Date.now()) {
  if (!assignment) return false;
  const mode = String(assignment.pin_mode || "none");
  if (mode === "permanent" && assignment.source === "manual") return true;
  if (mode === "until_expiry" && assignment.source === "manual") {
    const exp = assignment.pin_expires_at ? Date.parse(assignment.pin_expires_at) : NaN;
    return Number.isFinite(exp) && exp > now;
  }
  return false;
}

export async function countActiveCompanionsForBoss(bossId) {
  const rows = await listActiveRelationsForBoss(bossId).catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

/** Highest enabled level whose required_active_companions <= count and effective_from <= now */
export async function resolveAutoLevelForCount(activeCount) {
  const levels = await listBossLevels({ includeDisabled: false });
  const now = Date.now();
  const eligible = levels
    .filter((l) => {
      if (!l.isEnabled) return false;
      if (l.effectiveFrom && Date.parse(l.effectiveFrom) > now) return false;
      return Number(l.requiredActiveCompanions || 0) <= Number(activeCount || 0);
    })
    .sort((a, b) => Number(a.requiredActiveCompanions) - Number(b.requiredActiveCompanions) || a.sortOrder - b.sortOrder);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

async function insertLevelEvent(payload) {
  try {
    await supabaseJson(restUrl(EVT_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (_) {
    /* events optional if table missing mid-rollout */
  }
}

export async function setBossLevelManual({
  bossId,
  levelId,
  operatorId,
  reason = "",
  pinMode = "permanent",
  pinExpiresAt = null,
  note = "",
} = {}) {
  if (!bossId) throw httpError("缺少 bossId", 400);
  if (!levelId) throw httpError("缺少 levelId", 400);
  const reasonText = String(reason || "").trim();
  if (!reasonText) throw httpError("手动调整等级必须填写 reason（审计）", 400);
  const level = await getBossLevelById(levelId);
  if (!level) throw httpError("等级不存在", 404);
  const mode = ["permanent", "until_expiry", "none"].includes(pinMode) ? pinMode : "permanent";
  if (mode === "until_expiry" && !pinExpiresAt) {
    throw httpError("until_expiry 必须提供 pinExpiresAt", 400);
  }
  const prev = await getBossLevelAssignment(bossId);
  const payload = {
    boss_id: bossId,
    level_id: levelId,
    source: "manual",
    pin_mode: mode === "none" ? "permanent" : mode,
    pin_expires_at: mode === "until_expiry" ? pinExpiresAt : null,
    effective_at: nowIso(),
    assigned_by: operatorId || null,
    reason: reasonText,
    note: String(note || "").trim() || null,
    updated_at: nowIso(),
  };
  const rows = await supabaseJson(restUrl(ASSIGN_TABLE, "?on_conflict=boss_id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({ ...payload, created_at: prev?.created_at || nowIso() }),
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  const action =
    prev && prev.level_id === levelId
      ? "pin"
      : !prev
        ? "manual_set"
        : money((await getBossLevelById(prev.level_id))?.commission_rate) <= money(level.commission_rate)
          ? "upgrade"
          : "downgrade";
  await insertLevelEvent({
    boss_id: bossId,
    from_level_id: prev?.level_id || null,
    to_level_id: levelId,
    action,
    source: "manual",
    active_companions_count: await countActiveCompanionsForBoss(bossId),
    operator_id: operatorId || null,
    reason: reasonText,
    meta: { pinMode: payload.pin_mode, pinExpiresAt: payload.pin_expires_at },
    created_at: nowIso(),
  });
  return viewBossLevelAssignment(saved, level);
}

export async function clearBossLevelPin({ bossId, operatorId, reason = "" } = {}) {
  if (!bossId) throw httpError("缺少 bossId", 400);
  const reasonText = String(reason || "").trim() || "恢复自动等级";
  const evaluated = await reevaluateBossLevel({ bossId, operatorId, reason: reasonText, forceAuto: true });
  return evaluated;
}

/**
 * Auto-eval from active companion count unless manual pin still active.
 */
export async function reevaluateBossLevel({
  bossId,
  operatorId = null,
  reason = "",
  forceAuto = false,
} = {}) {
  if (!bossId) throw httpError("缺少 bossId", 400);
  const prev = await getBossLevelAssignment(bossId);
  if (!forceAuto && pinStillActive(prev)) {
    const level = await getBossLevelById(prev.level_id);
    return {
      skipped: true,
      reason: "manual_pin_active",
      assignment: viewBossLevelAssignment(prev, level),
    };
  }
  const count = await countActiveCompanionsForBoss(bossId);
  const autoLevel = await resolveAutoLevelForCount(count);
  if (!autoLevel) {
    return { skipped: true, reason: "no_eligible_level", activeCompanions: count };
  }
  const payload = {
    boss_id: bossId,
    level_id: autoLevel.id,
    source: "auto",
    pin_mode: "none",
    pin_expires_at: null,
    effective_at: nowIso(),
    assigned_by: operatorId || null,
    reason: String(reason || "").trim() || "auto_eval",
    note: null,
    updated_at: nowIso(),
  };
  const rows = await supabaseJson(restUrl(ASSIGN_TABLE, "?on_conflict=boss_id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({ ...payload, created_at: prev?.created_at || nowIso() }),
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  const changed = !prev || String(prev.level_id) !== String(autoLevel.id);
  if (changed) {
    await insertLevelEvent({
      boss_id: bossId,
      from_level_id: prev?.level_id || null,
      to_level_id: autoLevel.id,
      action: !prev
        ? "auto_eval"
        : money((await getBossLevelById(prev.level_id))?.commission_rate) <= money(autoLevel.commissionRate)
          ? "upgrade"
          : "downgrade",
      source: "auto",
      active_companions_count: count,
      operator_id: operatorId || null,
      reason: payload.reason,
      meta: {},
      created_at: nowIso(),
    });
  }
  return {
    skipped: false,
    changed,
    activeCompanions: count,
    assignment: viewBossLevelAssignment(saved, {
      id: autoLevel.id,
      code: autoLevel.code,
      name: autoLevel.name,
      required_active_companions: autoLevel.requiredActiveCompanions,
      commission_rate: autoLevel.commissionRate,
      effective_from: autoLevel.effectiveFrom,
      sort_order: autoLevel.sortOrder,
      is_enabled: autoLevel.isEnabled,
    }),
  };
}

/**
 * Effective level for settlement (respects pin expiry).
 */
export async function getEffectiveBossLevelForSettle(bossId) {
  if (!bossId) return { level: null, assignment: null, source: "none" };
  const assignment = await getBossLevelAssignment(bossId);
  if (assignment && pinStillActive(assignment)) {
    const level = await getBossLevelById(assignment.level_id);
    return { level, assignment, source: "manual_pin" };
  }
  // If auto assignment exists and not expired pin, use it; else compute without writing
  if (assignment && assignment.source === "auto" && assignment.level_id) {
    const level = await getBossLevelById(assignment.level_id);
    if (level) return { level, assignment, source: "auto" };
  }
  const count = await countActiveCompanionsForBoss(bossId);
  const autoLevel = await resolveAutoLevelForCount(count);
  if (!autoLevel) return { level: null, assignment, source: "none" };
  return {
    level: {
      id: autoLevel.id,
      code: autoLevel.code,
      name: autoLevel.name,
      required_active_companions: autoLevel.requiredActiveCompanions,
      commission_rate: autoLevel.commissionRate,
      commissionRate: autoLevel.commissionRate,
    },
    assignment,
    source: "auto_computed",
  };
}

export async function getBossLevelProgress(bossId) {
  const count = await countActiveCompanionsForBoss(bossId);
  const effective = await getEffectiveBossLevelForSettle(bossId);
  const levels = await listBossLevels({ includeDisabled: false });
  const currentReq = Number(effective.level?.required_active_companions ?? effective.level?.requiredActiveCompanions ?? 0);
  const next = levels
    .filter((l) => Number(l.requiredActiveCompanions) > currentReq)
    .sort((a, b) => a.requiredActiveCompanions - b.requiredActiveCompanions)[0] || null;
  return {
    bossId,
    activeCompanions: count,
    current: effective.level
      ? {
          id: effective.level.id,
          code: effective.level.code,
          name: effective.level.name,
          commissionRate: money(effective.level.commission_rate ?? effective.level.commissionRate),
          requiredActiveCompanions: currentReq,
        }
      : null,
    assignment: effective.assignment ? viewBossLevelAssignment(effective.assignment, effective.level) : null,
    next: next
      ? {
          id: next.id,
          code: next.code,
          name: next.name,
          requiredActiveCompanions: next.requiredActiveCompanions,
          commissionRate: next.commissionRate,
          remaining: Math.max(0, next.requiredActiveCompanions - count),
        }
      : null,
    source: effective.source,
  };
}

export { LEVELS_TABLE, ASSIGN_TABLE, EVT_TABLE, pinStillActive };
