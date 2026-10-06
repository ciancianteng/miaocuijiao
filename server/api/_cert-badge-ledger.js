/**
 * Certification badges as a commission group.
 *
 *   companion_cert_tag_assignments  ledger rows: active → pending_removal → removed (history kept)
 *   companion_cert_tags             companion_share_rate (unified %), commission_priority
 *   orders.cert_badge_snapshot      badges held + the single commission badge, frozen once per order
 *
 * Commission badge rule (deterministic, one rate per order):
 *   1. the assignment flagged is_commission_primary (if that badge is enabled and has a rate)
 *   2. otherwise the held enabled badge with a rate and the lowest commission_priority,
 *      then lowest sort, then id
 * pending_removal badges stay effective until an admin approves the removal.
 */
import { readCertTags, parseShareRate } from "./_companion-cert-tags-store.js";

export const OPEN_STATUSES = ["active", "pending_removal"];
const SNAPSHOT_VERSION = 1;

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}
function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}
function nowIso() {
  return new Date().toISOString();
}
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

export async function db(table, query = "", init = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg = body?.message || body?.hint || body?.details || text || `HTTP ${response.status}`;
    throw Object.assign(new Error(`${msg}${body?.code ? ` [${body.code}]` : ""}`), { status: response.status, code: body?.code || "" });
  }
  return body;
}

export function isSchemaMissing(err) {
  return /PGRST20[45]|42703|42P01|schema cache|does not exist|Could not find/i.test(String(err?.message || err || ""));
}
function isUniqueViolation(err) {
  return /23505|duplicate key/i.test(String(err?.message || err || ""));
}
function operatorName(op) {
  return String(op?.display_name || op?.nickname || op?.name || op?.email || "").trim().slice(0, 80);
}
function operatorId(op) {
  return isUuid(op?.id) ? op.id : null;
}

let ledgerProbe = null;
let ledgerProbeAt = 0;
export async function ledgerAvailable() {
  if (!hasDb()) return false;
  if (ledgerProbe != null && Date.now() - ledgerProbeAt < 60000) return ledgerProbe;
  try {
    await db("companion_cert_tag_assignments", "?select=id,status,is_commission_primary&limit=1");
    ledgerProbe = true;
  } catch (err) {
    if (!isSchemaMissing(err) && err.status !== 400) throw err;
    ledgerProbe = false;
  }
  ledgerProbeAt = Date.now();
  return ledgerProbe;
}

export async function listAssignments({ profileIds = null, tagId = "", statuses = null, ids = null, limit = 5000 } = {}) {
  const q = ["select=*", "order=granted_at.desc.nullslast", `limit=${limit}`];
  if (profileIds) {
    const list = [...new Set(profileIds.map(String).filter(Boolean))];
    if (!list.length) return [];
    q.push(`companion_profile_id=in.(${list.map(encodeURIComponent).join(",")})`);
  }
  if (ids) {
    const list = [...new Set(ids.map(String).filter(isUuid))];
    if (!list.length) return [];
    q.push(`id=in.(${list.join(",")})`);
  }
  if (tagId) q.push(`tag_id=eq.${encodeURIComponent(tagId)}`);
  if (statuses && statuses.length) q.push(`status=in.(${statuses.join(",")})`);
  const rows = await db("companion_cert_tag_assignments", `?${q.join("&")}`);
  return Array.isArray(rows) ? rows : [];
}

export function viewAssignment(row = {}, tag = null) {
  return {
    id: row.id || "",
    companionProfileId: row.companion_profile_id || "",
    tagId: row.tag_id || "",
    tagName: tag?.name || "",
    status: row.status || "active",
    statusLabel: { active: "生效中", pending_removal: "待取消", removed: "已取消" }[row.status || "active"] || row.status,
    isCommissionPrimary: !!row.is_commission_primary,
    grantedAt: row.granted_at || row.created_at || "",
    grantedByName: row.granted_by_name || "",
    removalRequestedAt: row.removal_requested_at || "",
    removalRequestedByName: row.removal_requested_by_name || "",
    removalReason: row.removal_reason || "",
    removalApprovedAt: row.removal_approved_at || "",
    removalApprovedByName: row.removal_approved_by_name || "",
    removedAt: row.removed_at || "",
  };
}

async function requireTag(tagId) {
  const tags = await readCertTags();
  const tag = tags.find((t) => String(t.id) === String(tagId));
  if (!tag) throw Object.assign(new Error("认证勋章不存在"), { status: 404 });
  return tag;
}

export async function grantBadge({ profileId, tagId, operator = null }) {
  if (!isUuid(profileId)) throw Object.assign(new Error("缺少陪玩资料 ID"), { status: 400 });
  await requireTag(tagId);
  const open = await listAssignments({ profileIds: [profileId], tagId, statuses: OPEN_STATUSES });
  if (open[0]) return { ok: true, duplicate: true, assignment: open[0] };
  const at = nowIso();
  try {
    const rows = await db("companion_cert_tag_assignments", "", {
      method: "POST",
      body: JSON.stringify({
        companion_profile_id: profileId,
        tag_id: String(tagId),
        status: "active",
        granted_at: at,
        granted_by: operatorId(operator),
        granted_by_name: operatorName(operator),
        created_at: at,
        updated_at: at,
      }),
    });
    return { ok: true, duplicate: false, assignment: rows?.[0] || null };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await listAssignments({ profileIds: [profileId], tagId, statuses: OPEN_STATUSES });
      return { ok: true, duplicate: true, assignment: again[0] || null };
    }
    throw err;
  }
}

export async function requestBadgeRemoval({ assignmentId, operator = null, reason = "" }) {
  const why = String(reason || "").trim().slice(0, 300);
  if (!why) throw Object.assign(new Error("请填写取消原因"), { status: 400 });
  if (!isUuid(assignmentId)) throw Object.assign(new Error("缺少勋章授予记录"), { status: 400 });
  const at = nowIso();
  const rows = await db("companion_cert_tag_assignments", `?id=eq.${assignmentId}&status=eq.active`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "pending_removal",
      removal_requested_at: at,
      removal_requested_by: operatorId(operator),
      removal_requested_by_name: operatorName(operator),
      removal_reason: why,
      updated_at: at,
    }),
  });
  if (rows?.[0]) return { ok: true, duplicate: false, assignment: rows[0] };
  const cur = (await listAssignments({ ids: [assignmentId] }))[0];
  if (cur?.status === "pending_removal") return { ok: true, duplicate: true, assignment: cur };
  throw Object.assign(new Error(cur ? "该勋章已取消，无法再次发起" : "勋章授予记录不存在"), { status: 409 });
}

export async function approveBadgeRemoval({ assignmentId, operator = null }) {
  if (!isUuid(assignmentId)) throw Object.assign(new Error("缺少勋章授予记录"), { status: 400 });
  const at = nowIso();
  const rows = await db("companion_cert_tag_assignments", `?id=eq.${assignmentId}&status=eq.pending_removal`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "removed",
      is_commission_primary: false,
      removal_approved_at: at,
      removal_approved_by: operatorId(operator),
      removal_approved_by_name: operatorName(operator),
      removed_at: at,
      updated_at: at,
    }),
  });
  if (rows?.[0]) return { ok: true, duplicate: false, assignment: rows[0] };
  const cur = (await listAssignments({ ids: [assignmentId] }))[0];
  if (cur?.status === "removed") return { ok: true, duplicate: true, assignment: cur };
  throw Object.assign(new Error(cur ? "只有「待取消」的勋章可以批准取消" : "勋章授予记录不存在"), { status: 409 });
}

export async function rejectBadgeRemoval({ assignmentId, operator = null }) {
  if (!isUuid(assignmentId)) throw Object.assign(new Error("缺少勋章授予记录"), { status: 400 });
  const cur = (await listAssignments({ ids: [assignmentId] }))[0];
  if (!cur) throw Object.assign(new Error("勋章授予记录不存在"), { status: 404 });
  if (cur.status !== "pending_removal") throw Object.assign(new Error("只有「待取消」的勋章可以驳回"), { status: 409 });
  const note = `[驳回 ${nowIso()} ${operatorName(operator)}] ${cur.removal_reason || ""}`.slice(0, 300);
  const rows = await db("companion_cert_tag_assignments", `?id=eq.${assignmentId}&status=eq.pending_removal`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", removal_reason: note, updated_at: nowIso() }),
  });
  return { ok: true, assignment: rows?.[0] || cur };
}

/** Admin tick-box save: grant new ticks now; unticked active badges go to pending_removal. */
export async function syncProfileBadges(profileId, tagIds, { operator = null } = {}) {
  if (!(await ledgerAvailable())) return null;
  const want = new Set((tagIds || []).map(String));
  const open = await listAssignments({ profileIds: [profileId], statuses: OPEN_STATUSES });
  const held = new Set(open.map((r) => String(r.tag_id)));
  for (const tagId of want) {
    if (!held.has(tagId)) await grantBadge({ profileId, tagId, operator });
  }
  for (const row of open) {
    if (row.status === "active" && !want.has(String(row.tag_id))) {
      await requestBadgeRemoval({ assignmentId: row.id, operator, reason: "后台在陪玩详情取消勾选" });
    }
  }
  const after = await listAssignments({ profileIds: [profileId], statuses: OPEN_STATUSES });
  return { heldTagIds: after.map((r) => String(r.tag_id)), assignments: after };
}

export async function setCommissionPrimary({ profileId, tagId, operator = null }) {
  const open = await listAssignments({ profileIds: [profileId], statuses: OPEN_STATUSES });
  const target = open.find((r) => String(r.tag_id) === String(tagId));
  if (!target) throw Object.assign(new Error("该陪玩未持有此勋章"), { status: 409 });
  await db(
    "companion_cert_tag_assignments",
    `?companion_profile_id=eq.${encodeURIComponent(profileId)}&is_commission_primary=eq.true`,
    { method: "PATCH", body: JSON.stringify({ is_commission_primary: false, updated_at: nowIso() }) }
  );
  const rows = await db("companion_cert_tag_assignments", `?id=eq.${target.id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_commission_primary: true, updated_at: nowIso() }),
  });
  return { ok: true, assignment: rows?.[0] || target, operator: operatorName(operator) };
}

/** Pick exactly one commission badge for a companion's held assignments. */
export function resolveCommissionBadge(openRows = [], catalog = []) {
  const byId = new Map((catalog || []).map((t) => [String(t.id), t]));
  const eligible = (openRows || [])
    .filter((r) => OPEN_STATUSES.includes(r.status || "active"))
    .map((r) => ({ row: r, tag: byId.get(String(r.tag_id)) }))
    .filter((x) => x.tag && x.tag.enabled !== false && parseShareRate(x.tag.companionShareRate) != null);
  if (!eligible.length) return null;
  const primary = eligible.find((x) => x.row.is_commission_primary);
  if (primary) return { tag: primary.tag, assignment: primary.row, rule: "primary" };
  eligible.sort(
    (a, b) =>
      Number(a.tag.commissionPriority ?? 100) - Number(b.tag.commissionPriority ?? 100) ||
      Number(a.tag.sort ?? 100) - Number(b.tag.sort ?? 100) ||
      String(a.tag.id).localeCompare(String(b.tag.id))
  );
  return { tag: eligible[0].tag, assignment: eligible[0].row, rule: "priority" };
}

export function badgeSnapshotFrom({ openRows = [], catalog = [], companionUserId = "", companionProfileId = "", stage = "" }) {
  const byId = new Map((catalog || []).map((t) => [String(t.id), t]));
  const badges = (openRows || [])
    .map((r) => byId.get(String(r.tag_id)))
    .filter(Boolean)
    .map((t) => ({ id: String(t.id), name: t.name }));
  if (!badges.length) return null;
  const pick = resolveCommissionBadge(openRows, catalog);
  const share = pick ? parseShareRate(pick.tag.companionShareRate) : null;
  return {
    v: SNAPSHOT_VERSION,
    stage: stage || "",
    capturedAt: nowIso(),
    companionId: String(companionUserId || ""),
    companionProfileId: String(companionProfileId || ""),
    badgeIds: badges.map((b) => b.id),
    badges,
    commission: pick
      ? {
          badgeId: String(pick.tag.id),
          badgeName: pick.tag.name,
          companionShareRate: share,
          platformRate: Math.round((100 - share) * 100) / 100,
          rule: pick.rule,
        }
      : null,
  };
}

export async function profileIdForCompanionUser(companionUserId) {
  if (!isUuid(companionUserId)) return "";
  const rows = await db("companion_profiles", `?user_id=eq.${companionUserId}&select=id&limit=1`).catch(() => []);
  return rows?.[0]?.id || "";
}

export async function buildBadgeSnapshot({ companionUserId = "", companionProfileId = "", stage = "" } = {}) {
  if (!(await ledgerAvailable())) return null;
  const pid = companionProfileId || (await profileIdForCompanionUser(companionUserId));
  if (!pid) return null;
  const [openRows, catalog] = await Promise.all([
    listAssignments({ profileIds: [pid], statuses: OPEN_STATUSES }),
    readCertTags(),
  ]);
  return badgeSnapshotFrom({ openRows, catalog, companionUserId, companionProfileId: pid, stage });
}

export function readOrderBadgeSnapshot(order = {}) {
  let snap = order?.cert_badge_snapshot;
  if (typeof snap === "string") {
    try {
      snap = JSON.parse(snap);
    } catch {
      snap = null;
    }
  }
  return snap && typeof snap === "object" && Array.isArray(snap.badgeIds) ? snap : null;
}

/**
 * Freeze badges + commission badge on the order the first time a companion is bound.
 * Write-once (cert_badge_snapshot=is.null); never blocks order flow — returns null on any failure.
 */
export async function ensureOrderBadgeSnapshot(order, { stage = "bind", companionProfileId = "" } = {}) {
  try {
    if (!order?.id || !order.companion_id || !hasDb()) return null;
    const oid = encodeURIComponent(order.id);
    const cid = String(order.companion_id);
    let row = order;
    if (!("cert_badge_snapshot" in order) || !("settlement_status" in order)) {
      const cur = await db("orders", `?id=eq.${oid}&select=id,companion_id,order_type,settlement_status,cert_badge_snapshot&limit=1`);
      if (!cur?.[0]) return null;
      row = { ...order, ...cur[0], companion_id: cur[0].companion_id || cid };
    }
    if (String(row.companion_id) !== cid) return null;
    const current = readOrderBadgeSnapshot(row);
    if (current && (!current.companionId || current.companionId === cid)) {
      order.cert_badge_snapshot = current;
      return current;
    }
    if (String(row.order_type || "") === "multi_group") return null;
    // Companion was replaced: re-freeze for the new companion, but never after settlement.
    if (current && String(row.settlement_status || "") === "settled") return current;
    const snap = await buildBadgeSnapshot({ companionUserId: cid, companionProfileId, stage });
    if (!snap && !current) return null;
    const guard = current
      ? "&or=(settlement_status.is.null,settlement_status.neq.settled)"
      : "&cert_badge_snapshot=is.null";
    const rows = await db("orders", `?id=eq.${oid}&companion_id=eq.${encodeURIComponent(cid)}${guard}`, {
      method: "PATCH",
      body: JSON.stringify({ cert_badge_snapshot: snap }),
    });
    if (rows?.[0]) {
      order.cert_badge_snapshot = rows[0].cert_badge_snapshot ?? snap;
      return readOrderBadgeSnapshot(order);
    }
    const cur = await db("orders", `?id=eq.${oid}&select=cert_badge_snapshot&limit=1`);
    const frozen = readOrderBadgeSnapshot(cur?.[0] || {});
    if (frozen) order.cert_badge_snapshot = frozen;
    return frozen && frozen.companionId === cid ? frozen : null;
  } catch (err) {
    if (!isSchemaMissing(err)) console.warn("[cert-badge] snapshot", String(err?.message || err).slice(0, 160));
    return null;
  }
}

/** Unified commission change (logged). Only affects orders bound after the change. */
export async function setBadgeCommission({ tagId, rate, priority, operator = null }) {
  const tag = await requireTag(tagId);
  const next = rate === null || rate === "" ? null : parseShareRate(rate);
  if (rate !== null && rate !== "" && next == null) {
    throw Object.assign(new Error("陪玩分成比例需在 0–100 之间"), { status: 400 });
  }
  const patch = {
    companion_share_rate: next,
    commission_updated_at: nowIso(),
    commission_updated_by: operatorId(operator),
    updated_at: nowIso(),
  };
  if (priority != null && priority !== "") {
    const p = Number(priority);
    if (!Number.isInteger(p) || p < 0 || p > 9999) throw Object.assign(new Error("佣金优先级需为 0–9999 的整数"), { status: 400 });
    patch.commission_priority = p;
  }
  const rows = await db("companion_cert_tags", `?id=eq.${encodeURIComponent(tagId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const old = parseShareRate(tag.companionShareRate);
  if (old !== next) {
    await db("companion_cert_tag_commission_log", "", {
      method: "POST",
      body: JSON.stringify({
        tag_id: String(tagId),
        old_rate: old,
        new_rate: next,
        changed_by: operatorId(operator),
        changed_by_name: operatorName(operator),
        changed_at: nowIso(),
      }),
    });
  }
  return { ok: true, tag: rows?.[0] || null, oldRate: old, newRate: next };
}

export async function listCommissionLog(tagId, limit = 50) {
  const rows = await db(
    "companion_cert_tag_commission_log",
    `?tag_id=eq.${encodeURIComponent(tagId)}&order=changed_at.desc&limit=${limit}`
  ).catch((err) => {
    if (isSchemaMissing(err)) return [];
    throw err;
  });
  return (rows || []).map((r) => ({
    oldRate: r.old_rate == null ? null : Number(r.old_rate),
    newRate: r.new_rate == null ? null : Number(r.new_rate),
    changedAt: r.changed_at,
    changedByName: r.changed_by_name || "",
  }));
}
