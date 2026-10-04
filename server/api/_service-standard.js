/**
 * Per-service standards (服务内容 / 执行标准 / 包含 / 不包含 / 计费标准 / 注意事项).
 *
 * Storage:
 *   companion_profiles.service_standards = { "<service_id>": { name, content, process, includes, excludes, billing, notes, updatedAt } }
 *   orders.service_snapshot               = frozen copy taken at order create (never rewritten afterwards)
 *
 * Both columns are optional at runtime: readers return null and writers soft-skip when the
 * migration (supabase/migrations/20261004_service_standard_snapshot.sql) has not been applied.
 */
import { companionDb, hasCompanionDb, isMissingRelation } from "./_companion-media-store.js";

export const SERVICE_STANDARD_FIELDS = [
  { key: "content", label: "服务内容", placeholder: "例如：三角洲行动爆破模式陪玩，全程语音指挥、带上分" },
  { key: "process", label: "执行标准", placeholder: "例如：准时上线；每局开局前确认战术；全程开麦沟通；不挂机不摆烂" },
  { key: "includes", label: "包含", placeholder: "例如：组队开黑、战术讲解、复盘建议" },
  { key: "excludes", label: "不包含", placeholder: "例如：代练上号、保证胜率、外挂/违规操作" },
  { key: "billing", label: "计费标准", placeholder: "例如：按小时计费，不足 1 小时按 1 小时；每局约 20 分钟" },
  { key: "notes", label: "注意事项", placeholder: "例如：请提前准备好游戏账号；中途离开超过 10 分钟按正常时长计费" },
];

export const SERVICE_STANDARD_KEYS = SERVICE_STANDARD_FIELDS.map((f) => f.key);
const MAX_FIELD_LEN = 500;

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

function compactName(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}

function cleanText(v) {
  return String(v == null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_FIELD_LEN);
}

export function normalizeServiceStandard(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of SERVICE_STANDARD_KEYS) out[key] = cleanText(src[key]);
  return out;
}

export function hasStandardContent(std) {
  if (!std || typeof std !== "object") return false;
  return SERVICE_STANDARD_KEYS.some((k) => String(std[k] || "").trim());
}

/** UI-ready list; every surface renders `sections` so labels live in one place. */
export function standardSections(std) {
  if (!std || typeof std !== "object") return [];
  return SERVICE_STANDARD_FIELDS.map((f) => ({ key: f.key, label: f.label, value: String(std[f.key] || "").trim() })).filter(
    (s) => s.value
  );
}

export function readServiceStandards(companionRow) {
  let raw = companionRow?.service_standards;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/** Find the standard for a service by id first, then by stored/display name. */
export function pickServiceStandard(standards, { serviceId = "", name = "" } = {}) {
  const map = standards && typeof standards === "object" ? standards : {};
  const sid = String(serviceId || "").trim();
  if (sid && map[sid] && typeof map[sid] === "object") return map[sid];
  const want = compactName(name);
  if (!want) return null;
  for (const [key, val] of Object.entries(map)) {
    if (!val || typeof val !== "object") continue;
    if (compactName(val.name) === want || (!isUuid(key) && compactName(key) === want)) return val;
  }
  return null;
}

/** Public shape attached to catalog services / companion bootstrap. */
export function publicStandard(std) {
  if (!hasStandardContent(std)) return null;
  const norm = normalizeServiceStandard(std);
  return { ...norm, sections: standardSections(norm), updatedAt: String(std.updatedAt || std.updated_at || "") };
}

export async function loadCompanionServiceStandards(companionUserId) {
  const id = String(companionUserId || "").trim();
  if (!id || !hasCompanionDb()) return { standards: {}, available: false };
  try {
    const rows = await companionDb(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(id)}&select=service_standards&limit=1`
    );
    return { standards: readServiceStandards(rows?.[0] || {}), available: true };
  } catch (e) {
    if (isMissingRelation(e)) return { standards: {}, available: false };
    throw e;
  }
}

export async function saveCompanionServiceStandard(companionUserId, { serviceId, name, standard }) {
  const id = String(companionUserId || "").trim();
  const sid = String(serviceId || "").trim();
  if (!id || !sid) throw Object.assign(new Error("缺少服务项目"), { status: 400 });
  const loaded = await loadCompanionServiceStandards(id);
  if (!loaded.available) {
    throw Object.assign(new Error("服务标准功能尚未开通（数据库字段缺失），请联系后台"), {
      status: 503,
      code: "SERVICE_STANDARD_SCHEMA_MISSING",
    });
  }
  const next = { ...loaded.standards };
  const norm = normalizeServiceStandard(standard);
  if (hasStandardContent(norm)) {
    next[sid] = { name: String(name || "").trim(), ...norm, updatedAt: new Date().toISOString() };
  } else {
    delete next[sid];
  }
  await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ service_standards: next }),
  });
  return { standards: next, standard: next[sid] || null };
}

/**
 * Frozen snapshot stored on orders.service_snapshot. Always includes name/price/unit so
 * order details never fall back to "name + price only" wording when the companion has no standard.
 */
export function buildServiceSnapshot({
  standards = {},
  serviceId = "",
  serviceName = "",
  unitPrice = 0,
  pricingUnit = "小时",
  hours = 0,
  quantity = 1,
  companionId = "",
} = {}) {
  const picked = pickServiceStandard(standards, { serviceId, name: serviceName });
  const norm = normalizeServiceStandard(picked || {});
  return {
    version: 1,
    serviceId: String(serviceId || "").trim(),
    serviceName: String(serviceName || picked?.name || "").trim(),
    companionId: String(companionId || "").trim(),
    unitPrice: Number(unitPrice) || 0,
    pricingUnit: String(pricingUnit || "小时"),
    hours: Number(hours) || 0,
    quantity: Number(quantity) || 1,
    standard: hasStandardContent(norm) ? norm : null,
    standardUpdatedAt: picked ? String(picked.updatedAt || "") : "",
    capturedAt: new Date().toISOString(),
  };
}

export async function buildServiceSnapshotForCompanion(companionUserId, opts = {}) {
  let standards = {};
  try {
    standards = (await loadCompanionServiceStandards(companionUserId)).standards;
  } catch (e) {
    console.warn("[service-standard] load for snapshot", String(e?.message || e).slice(0, 160));
  }
  return buildServiceSnapshot({ ...opts, standards, companionId: companionUserId });
}

/** Write snapshot once; skips when the order already has one or the column is missing. */
export async function persistOrderServiceSnapshot(orderRow, snapshot) {
  const id = String(orderRow?.id || "").trim();
  if (!id || !snapshot || !hasCompanionDb()) return false;
  if (orderRow.service_snapshot && typeof orderRow.service_snapshot === "object") return true;
  try {
    const rows = await companionDb(
      "orders",
      `?id=eq.${encodeURIComponent(id)}&service_snapshot=is.null`,
      { method: "PATCH", body: JSON.stringify({ service_snapshot: snapshot }) }
    );
    if (Array.isArray(rows) && rows[0]) orderRow.service_snapshot = rows[0].service_snapshot || snapshot;
    return true;
  } catch (e) {
    if (!isMissingRelation(e)) console.warn("[service-standard] persist snapshot", String(e?.message || e).slice(0, 160));
    return false;
  }
}

/** View-model for any order detail (boss / companion / CS / admin). */
export function viewServiceSnapshot(row = {}) {
  let snap = row?.service_snapshot;
  if (typeof snap === "string") {
    try {
      snap = JSON.parse(snap);
    } catch {
      snap = null;
    }
  }
  if (!snap || typeof snap !== "object") return null;
  const std = snap.standard && typeof snap.standard === "object" ? normalizeServiceStandard(snap.standard) : null;
  return {
    serviceId: String(snap.serviceId || ""),
    serviceName: String(snap.serviceName || row.service_name || row.game || ""),
    unitPrice: Number(snap.unitPrice) || 0,
    pricingUnit: String(snap.pricingUnit || "小时"),
    hours: Number(snap.hours) || 0,
    quantity: Number(snap.quantity) || 1,
    capturedAt: String(snap.capturedAt || ""),
    standardUpdatedAt: String(snap.standardUpdatedAt || ""),
    hasStandard: hasStandardContent(std),
    sections: standardSections(std),
  };
}
