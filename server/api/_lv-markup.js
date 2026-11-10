/**
 * Per-catalog-service × LV1–LV5 markup (加价额度) SoT.
 *
 * Final sell price = catalog services.default_price + (markupOn ? markup_allowance : 0)
 * markup_allowance lives on service_level_prices (settings matrix as read fallback).
 * Companion only persists markupOn; never types a custom amount.
 * base/min/max on the same table are NOT the markup.
 */
import { LOCKED_MATRIX_LEVEL_IDS, readServiceLevelPrices } from "./_service-level-prices.js";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function parseMarkupOn(raw) {
  return raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "on";
}

export function catalogBasePrice(row = {}) {
  return money(row.default_price ?? row.defaultPrice ?? row.platformPrice ?? row.price);
}

export function computeFinalPrice(basePrice, markupAllowance, markupOn) {
  const base = money(basePrice);
  const markup = Math.max(0, money(markupAllowance));
  return Math.round((base + (markupOn ? markup : 0)) * 100) / 100;
}

export async function loadMarkupMap() {
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

export function quoteMarkupPrice({
  serviceRow = null,
  levelId = "",
  markupOn = false,
  markupMap = null,
} = {}) {
  const basePrice = catalogBasePrice(serviceRow || {});
  const pack = markupFor(markupMap, serviceRow?.id || serviceRow?.serviceId, levelId);
  const on = parseMarkupOn(markupOn) && pack.markupAllowance > 0;
  const finalPrice = computeFinalPrice(basePrice, pack.markupAllowance, on);
  return {
    basePrice,
    markupAllowance: pack.markupAllowance,
    markupConfigured: pack.configured,
    markupSource: pack.source,
    markupOn: on,
    finalPrice,
    source: on ? "catalog_plus_markup" : "catalog_base",
    blocked: !(basePrice > 0),
    message: basePrice > 0 ? "" : "该服务尚未设置基础价格，无法报价。",
  };
}
