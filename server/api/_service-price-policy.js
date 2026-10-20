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

function clipText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
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
    description: clipText(raw.description ?? raw.content ?? raw.serviceContent, 500),
    requirements: clipText(raw.requirements ?? raw.serviceRequirements, 800),
  };
}

/**
 * What the boss may order and what price the server must charge.
 * Companion custom price is used only when the admin policy allows it.
 */
export function quoteVisibleService({ row, policy, offer, fallbackPrice = 0 } = {}) {
  const rules = normalizePricePolicy(policy || {});
  if (!row || row.enabled === false || row.allow_order === false) {
    return { visible: false, blocked: true, price: 0, source: "closed", unit: rules.unit, description: rules.description, requirements: rules.requirements, message: "该服务已停用，不能创建新订单。" };
  }
  if (offer && offer.accepting === false) {
    return { visible: false, blocked: true, price: 0, source: "companion_closed", unit: rules.unit, description: rules.description, requirements: rules.requirements, message: "该陪玩已关闭此服务，不能创建新订单。" };
  }
  const platformPrice = Number(row.default_price);
  const custom = offer && offer.price != null && offer.price !== "" ? Number(offer.price) : NaN;
  let price = 0;
  let source = "platform_default";
  if (rules.allowSelfPrice && Number.isFinite(custom) && custom > 0) {
    if ((rules.min != null && custom < Number(rules.min)) || (rules.max != null && custom > Number(rules.max))) {
      return { visible: false, blocked: true, price: 0, source: "price_out_of_range", unit: rules.unit, description: rules.description, requirements: rules.requirements, message: "陪玩报价超出后台允许范围，不能创建新订单。" };
    }
    price = Math.round(custom * 100) / 100;
    source = "companion_offer";
  } else if (Number.isFinite(platformPrice) && platformPrice > 0) {
    price = Math.round(platformPrice * 100) / 100;
    source = "platform_default";
  } else if (Number(fallbackPrice) > 0) {
    price = Math.round(Number(fallbackPrice) * 100) / 100;
    source = "fallback";
  }
  return {
    visible: true,
    blocked: !(price > 0),
    price,
    source,
    unit: rules.unit,
    description: rules.description,
    requirements: rules.requirements,
    message: price > 0 ? "" : "该服务尚未设置单价，无法下单。",
  };
}

export function assertWritablePricePolicy(raw = {}) {
  const unit = String(raw.unit || "").trim();
  if (unit && !UNITS.has(unit)) {
    throw Object.assign(new Error("计价单位只允许：局、小时、场、次。"), { status: 400 });
  }
  for (const [label, value] of [
    ["最低价格", raw.min ?? raw.priceMin],
    ["最高价格", raw.max ?? raw.priceMax],
  ]) {
    if (value === "" || value == null) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error(`${label}必须是大于或等于 0 的数字。`), { status: 400 });
    }
  }
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
  assertWritablePricePolicy(raw || {});
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
