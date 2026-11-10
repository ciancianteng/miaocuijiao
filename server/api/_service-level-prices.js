/**
 * Catalog service × LV1–LV5 price matrix.
 * Prefer table service_level_prices; fallback platform_settings.data.serviceLevelPriceMatrix;
 * then local JSON. Never deletes companion_levels. Paid order snapshots untouched.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { LOCKED_LEVEL_IDS, normalizeLevelRow, readLocalLevels } from "./_companion-levels-store.js";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "service-level-prices.json");
const SETTINGS_KEY = "serviceLevelPriceMatrix";

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}
function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}
function serviceHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function restUrl(table, query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || error || ""));
}
function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export const LOCKED_MATRIX_LEVEL_IDS = Object.freeze([...LOCKED_LEVEL_IDS]);

export function normalizeMatrixRow(row = {}, index = 0) {
  const levelId = String(row.level_id || row.levelId || row.id || `lv${index + 1}`)
    .trim()
    .toLowerCase();
  const min = Math.max(0, money(row.min_price ?? row.minPrice ?? row.min));
  let max = Math.max(min, money(row.max_price ?? row.maxPrice ?? row.max));
  let base = money(row.base_price ?? row.basePrice ?? row.base);
  if (!(base > 0)) base = min || 0;
  if (base < min) base = min;
  if (base > max) max = base;
  let markup = Math.max(0, money(row.markup_allowance ?? row.markupAllowance ?? row.maxMarkupCats ?? 0));
  const maxPlus = row.max_plus === true || row.maxPlus === true;
  if (!maxPlus && base + markup > max + 1e-9) {
    markup = Math.max(0, Math.round((max - base) * 100) / 100);
  }
  const sellMax = maxPlus ? base + markup : Math.min(max, base + markup);
  return {
    serviceId: String(row.service_id || row.serviceId || "").trim(),
    levelId,
    basePrice: base,
    minPrice: min,
    maxPrice: max,
    markupAllowance: markup,
    maxPlus,
    sellMax,
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export function validateMatrixRow(row = {}) {
  const levelId = String(row.level_id || row.levelId || row.id || "")
    .trim()
    .toLowerCase();
  const serviceId = String(row.service_id || row.serviceId || "").trim();
  const min = money(row.min_price ?? row.minPrice ?? row.min);
  const max = money(row.max_price ?? row.maxPrice ?? row.max);
  const base = money(row.base_price ?? row.basePrice ?? row.base);
  const markup = money(row.markup_allowance ?? row.markupAllowance ?? row.maxMarkupCats ?? 0);
  const maxPlus = row.max_plus === true || row.maxPlus === true;
  const errors = [];
  if (!serviceId) errors.push("缺少 service_id");
  if (!LOCKED_MATRIX_LEVEL_IDS.includes(levelId)) {
    errors.push("level_id 必须是 lv1–lv5");
  }
  if (!(min >= 0)) errors.push("最低价必须 ≥ 0");
  if (!(max >= min)) errors.push("最高价必须 ≥ 最低价");
  if (!(base > 0)) errors.push("默认售价必须 > 0");
  if (!(base >= min && base <= max)) {
    errors.push("默认售价必须在最低与最高之间");
  }
  if (!(markup >= 0)) errors.push("加价上限必须 ≥ 0");
  if (!maxPlus && base + markup > max + 1e-9) {
    errors.push("默认售价 + 加价上限不得超过最高价");
  }
  const item = errors.length
    ? null
    : normalizeMatrixRow({
        serviceId,
        levelId,
        basePrice: base,
        minPrice: min,
        maxPrice: max,
        markupAllowance: markup,
        maxPlus,
      });
  return { ok: !errors.length, errors, message: errors[0] || "", row: item };
}

function rowToDb(row) {
  const item = normalizeMatrixRow(row);
  return {
    service_id: item.serviceId,
    level_id: item.levelId,
    base_price: item.basePrice,
    min_price: item.minPrice,
    max_price: item.maxPrice,
    markup_allowance: item.markupAllowance,
    max_plus: item.maxPlus,
    updated_at: new Date().toISOString(),
  };
}

export async function probeServiceLevelPricesTable() {
  if (!hasDb()) return { present: false, reason: "no_db" };
  try {
    const res = await fetch(restUrl("service_level_prices", "?select=service_id&limit=1"), { headers: serviceHeaders() });
    if (res.ok) return { present: true, reason: "ok" };
    const text = await res.text();
    if (isMissingTable({ message: text })) return { present: false, reason: "missing_table" };
    return { present: false, reason: `http_${res.status}` };
  } catch (error) {
    if (isMissingTable(error)) return { present: false, reason: "missing_table" };
    return { present: false, reason: String(error?.message || error || "error").slice(0, 80) };
  }
}

async function readDbRows() {
  if (!hasDb()) return null;
  const res = await fetch(restUrl("service_level_prices", "?select=*&order=service_id.asc,level_id.asc"), {
    headers: serviceHeaders(),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error((body && body.message) || text || `HTTP ${res.status}`);
    if (isMissingTable(err)) return null;
    throw err;
  }
  return (Array.isArray(body) ? body : []).map((row) => normalizeMatrixRow(row));
}

async function writeDbRows(rows) {
  if (!hasDb()) return false;
  const payload = (Array.isArray(rows) ? rows : []).map(rowToDb).filter((r) => r.service_id && r.level_id);
  // Replace strategy: upsert all submitted rows (partial matrix allowed).
  const res = await fetch(restUrl("service_level_prices", "?on_conflict=service_id,level_id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || `HTTP ${res.status}`);
    if (isMissingTable(err)) return false;
    throw Object.assign(err, { status: res.status || 500 });
  }
  return true;
}

async function deleteDbService(serviceId) {
  if (!hasDb() || !serviceId) return false;
  const res = await fetch(
    restUrl("service_level_prices", `?service_id=eq.${encodeURIComponent(serviceId)}`),
    { method: "DELETE", headers: serviceHeaders() }
  );
  if (res.status === 404 || isMissingTable({ message: await res.text().catch(() => "") })) return false;
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    if (isMissingTable({ message: text })) return false;
    throw Object.assign(new Error(text || `HTTP ${res.status}`), { status: res.status });
  }
  return true;
}

async function readSettingsMatrix() {
  if (!hasDb()) return null;
  const res = await fetch(restUrl("platform_settings", "?id=eq.global&select=data&limit=1"), {
    headers: serviceHeaders(),
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => []);
  const data = Array.isArray(body) && body[0] ? body[0].data || {} : {};
  const raw = data[SETTINGS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.map((row, i) => normalizeMatrixRow(row, i)).filter((r) => r.serviceId && r.levelId);
}

async function writeSettingsMatrix(rows) {
  if (!hasDb()) return false;
  const get = await fetch(restUrl("platform_settings", "?id=eq.global&select=id,data&limit=1"), {
    headers: serviceHeaders(),
  });
  if (!get.ok) return false;
  const list = await get.json().catch(() => []);
  const current = Array.isArray(list) && list[0] ? list[0].data || {} : {};
  const nextData = {
    ...current,
    [SETTINGS_KEY]: (Array.isArray(rows) ? rows : []).map((r) => {
      const n = normalizeMatrixRow(r);
      return {
        serviceId: n.serviceId,
        levelId: n.levelId,
        basePrice: n.basePrice,
        minPrice: n.minPrice,
        maxPrice: n.maxPrice,
        markupAllowance: n.markupAllowance,
        maxPlus: n.maxPlus,
        updatedAt: n.updatedAt,
      };
    }),
  };
  const res = await fetch(restUrl("platform_settings", "?on_conflict=id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([{ id: "global", data: nextData, updated_at: new Date().toISOString() }]),
  });
  return res.ok;
}

async function readLocalFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    return (Array.isArray(parsed) ? parsed : []).map((row, i) => normalizeMatrixRow(row, i));
  } catch {
    return [];
  }
}

async function writeLocalFile(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function readServiceLevelPrices() {
  try {
    const db = await readDbRows();
    if (Array.isArray(db)) return db;
  } catch (error) {
    if (!isMissingTable(error)) console.error("[service-level-prices] DB read failed", error.message || error);
  }
  try {
    const settings = await readSettingsMatrix();
    if (Array.isArray(settings) && settings.length) return settings;
  } catch (error) {
    console.error("[service-level-prices] settings read failed", error.message || error);
  }
  return readLocalFile();
}

export async function writeServiceLevelPrices(rows, { replaceServiceIds = null } = {}) {
  const incoming = (Array.isArray(rows) ? rows : []).map((row, i) => normalizeMatrixRow(row, i));
  for (const row of incoming) {
    const checked = validateMatrixRow(row);
    if (!checked.ok) {
      throw Object.assign(new Error(checked.message || "矩阵校验失败"), { status: 400, errors: checked.errors });
    }
  }
  const current = await readServiceLevelPrices();
  let next = current.slice();
  if (Array.isArray(replaceServiceIds) && replaceServiceIds.length) {
    const drop = new Set(replaceServiceIds.map(String));
    next = next.filter((row) => !drop.has(String(row.serviceId)));
  }
  const keyOf = (r) => `${r.serviceId}::${r.levelId}`;
  const map = new Map(next.map((r) => [keyOf(r), r]));
  for (const row of incoming) map.set(keyOf(row), row);
  next = [...map.values()].sort((a, b) => String(a.serviceId).localeCompare(String(b.serviceId)) || String(a.levelId).localeCompare(String(b.levelId)));

  let persisted = false;
  try {
    if (Array.isArray(replaceServiceIds)) {
      for (const sid of replaceServiceIds) await deleteDbService(sid);
    }
    persisted = await writeDbRows(incoming.length ? incoming : next);
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  if (!persisted) {
    persisted = await writeSettingsMatrix(next);
  }
  await writeLocalFile(next).catch(() => {});
  return { rows: next, source: persisted ? "db_or_settings" : "local" };
}

/**
 * Admin writes only markup_allowance per service × LV1–LV5.
 * Structural base/min/max are copied from an existing row or companion_levels so CHECK still holds.
 * max_plus=true so markup is independent of min/max (those columns are not the 加价).
 */
export async function saveServiceMarkups(serviceId, items = []) {
  const sid = String(serviceId || "").trim();
  if (!sid) throw Object.assign(new Error("缺少 service_id"), { status: 400 });
  const probe = await probeServiceLevelPricesTable();
  if (!probe?.present) {
    throw Object.assign(new Error("service_level_prices 表不存在，无法保存加价。"), { status: 503, reason: probe?.reason });
  }
  const byLevel = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const levelId = String(raw.levelId || raw.level_id || "").trim().toLowerCase();
    if (!LOCKED_MATRIX_LEVEL_IDS.includes(levelId)) continue;
    const markup = money(raw.markupAllowance ?? raw.markup_allowance ?? raw.markup);
    if (!(markup >= 0)) {
      throw Object.assign(new Error(`${levelId} 加价必须 ≥ 0`), { status: 400 });
    }
    byLevel.set(levelId, markup);
  }
  const missing = LOCKED_MATRIX_LEVEL_IDS.filter((id) => !byLevel.has(id));
  if (missing.length) {
    throw Object.assign(new Error(`请提交完整 LV1–LV5 加价（缺 ${missing.join(",")}）`), { status: 400 });
  }
  const levels = await readLocalLevels();
  const current = await readServiceLevelPrices();
  const rows = LOCKED_MATRIX_LEVEL_IDS.map((levelId) => {
    const prev = (current || []).find((r) => r.serviceId === sid && r.levelId === levelId);
    const lv = (levels || []).find((row) => String(row.id).toLowerCase() === levelId) || {};
    const min = money(prev?.minPrice ?? lv.min ?? 0);
    let base = money(prev?.basePrice ?? lv.basePrice ?? min);
    if (!(base > 0)) base = min > 0 ? min : 1;
    let max = money(prev?.maxPrice ?? lv.max ?? base);
    if (max < base) max = base;
    const markup = byLevel.get(levelId);
    const checked = validateMatrixRow({
      serviceId: sid,
      levelId,
      basePrice: base,
      minPrice: min,
      maxPrice: max,
      markupAllowance: markup,
      maxPlus: true,
    });
    if (!checked.ok) {
      throw Object.assign(new Error(checked.message || `${levelId} 加价校验失败`), { status: 400, errors: checked.errors });
    }
    return checked.row;
  });
  await writeServiceLevelPrices(rows, { replaceServiceIds: [sid] });
  const db = await readDbRows();
  const written = Array.isArray(db)
    ? LOCKED_MATRIX_LEVEL_IDS.every((lid) => {
        const hit = db.find((r) => r.serviceId === sid && r.levelId === lid);
        return hit && money(hit.markupAllowance) === byLevel.get(lid);
      })
    : false;
  if (!written) {
    throw Object.assign(new Error("加价未写入 service_level_prices，已拒绝把回落当成功。"), { status: 503 });
  }
  return {
    persisted: true,
    source: "service_level_prices",
    rows: db.filter((r) => r.serviceId === sid),
    markups: LOCKED_MATRIX_LEVEL_IDS.map((levelId) => ({ levelId, markupAllowance: byLevel.get(levelId) })),
  };
}

export async function clearServiceMatrix(serviceId) {
  const sid = String(serviceId || "").trim();
  if (!sid) throw Object.assign(new Error("缺少 service_id"), { status: 400 });
  const current = await readServiceLevelPrices();
  const next = current.filter((row) => String(row.serviceId) !== sid);
  try {
    await deleteDbService(sid);
  } catch (_) {
    /* fallback below */
  }
  await writeSettingsMatrix(next).catch(() => {});
  await writeLocalFile(next).catch(() => {});
  return { rows: next, clearedServiceId: sid };
}

/**
 * Resolve allowed sell band for one catalog service + companion level.
 * Matrix row wins; else companion_levels band.
 */
export async function resolveServiceLevelBand({ serviceId = "", levelId = "", levelRow = null } = {}) {
  const sid = String(serviceId || "").trim();
  const lid = String(levelId || levelRow?.id || "")
    .trim()
    .toLowerCase();
  const all = await readServiceLevelPrices();
  const hit = sid && lid ? all.find((r) => r.serviceId === sid && r.levelId === lid) : null;
  if (hit) {
    return {
      ...hit,
      source: "service_level_matrix",
      priceRangeText: `默认 ${hit.basePrice} · 允许 ${hit.minPrice}–${hit.maxPrice} · 最多加价 +${hit.markupAllowance} · 最终可达 ${hit.basePrice}–${hit.sellMax}`,
    };
  }
  let level = levelRow ? normalizeLevelRow(levelRow) : null;
  if (!level && lid) {
    const levels = await readLocalLevels();
    level = levels.find((row) => String(row.id) === lid) || null;
  }
  if (!level) {
    return {
      serviceId: sid,
      levelId: lid,
      basePrice: 0,
      minPrice: 0,
      maxPrice: 0,
      markupAllowance: 0,
      maxPlus: false,
      sellMax: 0,
      source: "missing",
      priceRangeText: "未配置等级价格",
    };
  }
  const base = money(level.basePrice);
  const min = money(level.min);
  const max = money(level.max);
  const markup = money(level.markupAllowance);
  const sellMax = level.maxPlus ? base + markup : Math.min(max, base + markup);
  return {
    serviceId: sid,
    levelId: String(level.id),
    basePrice: base,
    minPrice: min,
    maxPrice: max,
    markupAllowance: markup,
    maxPlus: !!level.maxPlus,
    sellMax,
    source: "companion_levels",
    priceRangeText: `默认 ${base} · 允许 ${min}–${max} · 最多加价 +${markup} · 最终可达 ${base}–${sellMax}`,
  };
}

export function assertPriceInBand(price, band) {
  const pv = money(price);
  const min = money(band?.minPrice);
  const sellMax = money(band?.sellMax != null ? band.sellMax : band?.maxPrice);
  const maxPlus = !!band?.maxPlus;
  if (!(pv >= min)) return { ok: false, message: `单价不能低于 ${min}` };
  if (!maxPlus && !(pv <= sellMax + 1e-9)) return { ok: false, message: `单价不能高于 ${sellMax}` };
  return { ok: true, price: pv, min, sellMax };
}
