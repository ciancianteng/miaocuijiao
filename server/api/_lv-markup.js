/**
 * Per-catalog-service × LV1–LV5 markup CAP (加价上限) SoT.
 *
 * markup_allowance = max the companion may add (CAP), NOT an automatic surcharge.
 * Final sell price = catalog default_price + companion-chosen markupAmount (default 0),
 * clamped to [0, CAP]. Historical orders keep their snapshot unit_price.
 */
import { LOCKED_MATRIX_LEVEL_IDS, readServiceLevelPrices } from "./_service-level-prices.js";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function parseMarkupOn(raw) {
  return raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "on";
}

/** Normalize companion-chosen markup; missing/invalid → 0 (never auto-fill CAP). */
export function normalizeMarkupAmount(raw) {
  if (raw == null || raw === "") return 0;
  const n = money(raw);
  return n > 0 ? n : 0;
}

export function clampMarkupAmount(amount, cap) {
  const a = Math.max(0, money(amount));
  const c = Math.max(0, money(cap));
  return Math.round(Math.min(a, c) * 100) / 100;
}

export function catalogBasePrice(row = {}) {
  return money(row.default_price ?? row.defaultPrice ?? row.platformPrice ?? row.price);
}

/** When markupOn is true, `markupAllowance` here means the *applied* amount (not CAP). */
export function computeFinalPrice(basePrice, markupAllowance, markupOn) {
  const base = money(basePrice);
  const markup = Math.max(0, money(markupAllowance));
  return Math.round((base + (markupOn ? markup : 0)) * 100) / 100;
}

export async function loadMarkupMap() {
  // CAP is per (serviceId × levelId) from the matrix only.
  // Do NOT fall back to companion_levels — that inherits CAP across games/levels
  // and previously fed the auto-apply bug (base 40 + inherited +3 → 43).
  const rows = await readServiceLevelPrices().catch(() => []);
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sid = String(row.serviceId || "").trim();
    const lid = String(row.levelId || "").trim().toLowerCase();
    if (!sid || !LOCKED_MATRIX_LEVEL_IDS.includes(lid)) continue;
    map.set(`${sid}::${lid}`, {
      markupAllowance: Math.max(0, money(row.markupAllowance)),
      configured: true,
      source: "service_level_matrix",
    });
  }
  return map;
}

export function markupFor(map, serviceId, levelId) {
  const sid = String(serviceId || "").trim();
  const lid = String(levelId || "").trim().toLowerCase();
  const hit = map instanceof Map ? map.get(`${sid}::${lid}`) : null;
  if (hit) return hit;
  return { markupAllowance: 0, configured: false, source: "unconfigured" };
}

/**
 * Quote final sell price.
 * @param {object} opts
 * @param {number|string} [opts.markupAmount] companion-chosen add-on (default 0). CAP is never auto-applied.
 */
export function quoteMarkupPrice({
  serviceRow = null,
  levelId = "",
  markupMap = null,
  markupAmount = 0,
} = {}) {
  const basePrice = catalogBasePrice(serviceRow || {});
  const pack = markupFor(markupMap, serviceRow?.id || serviceRow?.serviceId, levelId);
  const cap = Math.max(0, money(pack.markupAllowance));
  const applied = clampMarkupAmount(normalizeMarkupAmount(markupAmount), cap);
  const finalPrice = computeFinalPrice(basePrice, applied, applied > 0);
  return {
    basePrice,
    markupAllowance: cap,
    markupAmount: applied,
    markupConfigured: pack.configured,
    markupSource: pack.source,
    markupOn: applied > 0,
    finalPrice,
    source: applied > 0 ? "catalog_plus_markup" : "catalog_base",
    blocked: !(basePrice > 0),
    message: basePrice > 0 ? "" : "该服务尚未设置基础价格，无法报价。",
  };
}
