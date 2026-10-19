/**
 * Per-service price range and companion permissions.
 * Stored in platform_settings.data.servicePricePolicy (existing JSON blob).
 * Does not alter services columns, orders, or historical unit_price.
 * Rollback: delete the servicePricePolicy key from platform_settings.data.
 */
import { companionDb } from "./_companion-media-store.js";

const UNITS = new Set(["局", "小时", "场", "次"]);

function moneyOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function normalizePricePolicy(raw = {}) {
  const min = moneyOrNull(raw.min ?? raw.priceMin);
  const max = moneyOrNull(raw.max ?? raw.priceMax);
  const unit = UNITS.has(String(raw.unit || "").trim()) ? String(raw.unit).trim() : "局";
  return {
    min,
    max,
    unit,
    allowSelfPrice: raw.allowSelfPrice === true || raw.allowSelfPrice === "true" || raw.allowCompanionPrice === true,
    allowSelfOff: raw.allowSelfOff === true || raw.allowSelfOff === "true" || raw.allowCompanionOff === true,
  };
}

export function assertPricePolicy(policy) {
  if (policy.min != null && policy.max != null && policy.max < policy.min) {
    throw Object.assign(new Error("最高价格不能低于最低价格。"), { status: 400 });
  }
}

async function readSettingsData() {
  const rows = await companionDb("platform_settings", "?id=eq.global&select=data&limit=1").catch(() => []);
  const data = rows?.[0]?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function loadAllPricePolicies() {
  const data = await readSettingsData();
  const map = data.servicePricePolicy;
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export async function savePricePolicy(serviceId, raw) {
  const id = String(serviceId || "").trim();
  if (!id) throw Object.assign(new Error("缺少服务 ID"), { status: 400 });
  const policy = normalizePricePolicy(raw || {});
  assertPricePolicy(policy);
  const prev = await readSettingsData();
  const next = {
    ...prev,
    servicePricePolicy: { ...(prev.servicePricePolicy || {}), [id]: policy },
  };
  await companionDb("platform_settings", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: "global", data: next, updated_at: new Date().toISOString() }),
  });
  return policy;
}
