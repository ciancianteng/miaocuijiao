/**
 * Companion-selected catalog offers.
 * Stored on the existing companion_profiles.service_standards map under a
 * reserved key so we do not add a second catalog or require new columns.
 */
import { companionDb } from "./_companion-media-store.js";
import { loadCompanionServiceStandards } from "./_service-standard.js";
import { parseServiceIds, splitGames } from "./_game-prices.js";

const OFFER_KEY = "__catalogOffers";

function cleanPrice(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

/** Companion accept flag. Explicit `accepting` wins; legacy rows that only stored `enabled` still read. */
export function companionAcceptingFlag(raw) {
  if (raw && raw.accepting != null && raw.accepting !== "") {
    return raw.accepting !== false && raw.accepting !== "false";
  }
  return raw?.enabled !== false && raw?.enabled !== "false";
}

function cleanOffers(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list
    .map((raw, index) => {
      const kind = raw?.kind === "product" ? "product" : "service";
      const id = String(raw?.id || "").trim();
      const accepting = companionAcceptingFlag(raw);
      return {
        kind,
        id,
        enabled: accepting,
        accepting,
        price: cleanPrice(raw?.price),
        sort: Number.isFinite(Number(raw?.sort)) ? Number(raw.sort) : index,
      };
    })
    .filter((item) => item.id && !seen.has(`${item.kind}:${item.id}`) && seen.add(`${item.kind}:${item.id}`))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 40)
    .map((item, index) => ({ ...item, sort: index }));
}

/** Services this companion actually selected. Never the whole platform catalog. */
export async function loadBoundServiceIds(userId) {
  const id = String(userId || "").trim();
  const ids = new Set();
  if (!id) return [];
  const profiles = await companionDb(
    "companion_profiles",
    `?user_id=eq.${encodeURIComponent(id)}&select=service_ids,game,main_service&limit=1`
  ).catch(() => []);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  for (const serviceId of parseServiceIds(profile?.service_ids)) ids.add(String(serviceId));
  const own = await companionDb(
    "companion_services",
    `?companion_id=eq.${encodeURIComponent(id)}&select=service_id,service_name,enabled&limit=200`
  ).catch(() => []);
  const names = new Set(splitGames(`${profile?.game || ""} ${profile?.main_service || ""}`));
  for (const row of Array.isArray(own) ? own : []) {
    if (!row || row.enabled === false) continue;
    if (row.service_id) ids.add(String(row.service_id));
    const name = String(row.service_name || "").trim();
    if (name) names.add(name);
  }
  if (!ids.size && names.size) {
    const { serviceRows } = await catalog();
    for (const row of serviceRows) {
      if (names.has(String(row.name || "").trim())) ids.add(String(row.id));
    }
  }
  return [...ids];
}

/**
 * Keep stored offers. Apply only explicit edits for services the companion already has.
 * Do not add the rest of the catalog, do not drop omitted rows, do not change stored prices.
 */
export function mergeCompanionOffers(previous, incoming, boundIds) {
  const bound = new Set((boundIds || []).map((id) => String(id)));
  const next = (Array.isArray(previous) ? previous : []).map((item) => ({ ...item }));
  const index = new Map(next.map((item, i) => [`${item.kind}:${item.id}`, i]));
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item?.id) continue;
    const key = `${item.kind}:${item.id}`;
    const at = index.get(key);
    const allowed = item.kind !== "service" || bound.has(String(item.id)) || at != null;
    if (!allowed) continue;
    if (at == null) {
      if (item.kind === "service" && !bound.has(String(item.id))) continue;
      const created = { ...item, price: null };
      index.set(key, next.length);
      next.push(created);
      continue;
    }
    const prev = next[at];
    next[at] = {
      ...prev,
      accepting: item.accepting !== false,
      enabled: item.accepting !== false,
      price: prev.price,
      sort: prev.sort,
    };
  }
  return next;
}

async function catalog() {
  const services = await companionDb(
    "services",
    "?select=id,name,category,icon,default_price,enabled,allow_order&order=sort.asc&limit=200"
  ).catch(() => []);
  const products = await companionDb(
    "gameplay_products",
    "?select=id,name,category,price,status,deleted_at,sort_order&order=sort_order.asc&limit=200"
  ).catch(() => []);
  const serviceRows = (Array.isArray(services) ? services : []).filter((row) => row && row.enabled !== false && row.allow_order !== false);
  const productRows = (Array.isArray(products) ? products : []).filter((row) => {
    if (!row || row.deleted_at) return false;
    const status = String(row.status || "").toLowerCase();
    return !status || status === "published" || status === "active" || status === "enabled";
  });
  return { serviceRows, productRows };
}

export async function listCompanionOffers(userId, { enabledOnly = false } = {}) {
  const loaded = await loadCompanionServiceStandards(userId);
  const raw = loaded.standards?.[OFFER_KEY];
  const saved = cleanOffers(raw);
  const boundIds = await loadBoundServiceIds(userId);
  const bound = new Set(boundIds.map((id) => String(id)));
  const { serviceRows, productRows } = await catalog();
  let policies = {};
  try {
    const { loadAllPricePolicies, normalizePricePolicy } = await import("./_service-price-policy.js");
    const map = await loadAllPricePolicies();
    policies = Object.fromEntries(
      Object.entries(map || {}).map(([key, value]) => [key, normalizePricePolicy(value)])
    );
  } catch {
    policies = {};
  }
  const serviceMap = new Map(serviceRows.map((row) => [String(row.id), row]));
  const productMap = new Map(productRows.map((row) => [String(row.id), row]));
  const offers = saved
    .map((item) => {
      if (item.kind === "product") {
        const row = productMap.get(item.id);
        if (!row) return null;
        return {
          ...item,
          name: row.name || "更多玩法",
          category: row.category || "",
          price: row.price,
          href: "",
        };
      }
      const row = serviceMap.get(item.id);
      if (!row) return null;
      const confirmed = !bound.size || bound.has(String(item.id));
      return {
        ...item,
        accepting: confirmed ? item.accepting !== false : false,
        enabled: confirmed ? item.accepting !== false : false,
        unconfirmed: !confirmed,
        name: row.name || "服务",
        category: row.category || "",
        icon: row.icon || "🎮",
        platformPrice: row.default_price,
        platformEnabled: row.enabled !== false,
        href: "",
      };
    })
    .filter(Boolean);
  const savedServiceIds = new Set(offers.filter((item) => item.kind === "service").map((item) => String(item.id)));
  const visibleServices = serviceRows.filter((row) => bound.has(String(row.id)) || savedServiceIds.has(String(row.id)));
  return {
    offers: enabledOnly ? offers.filter((item) => item.accepting !== false) : offers,
    boundServiceIds: boundIds,
    catalog: {
      services: visibleServices.map((row) => ({
        kind: "service",
        id: row.id,
        name: row.name,
        category: row.category || "",
        icon: row.icon || "🎮",
        price: row.default_price,
        enabled: row.enabled !== false,
        policy: policies[String(row.id)] || { min: null, max: null, unit: "局", allowSelfPrice: false, allowSelfOff: false },
      })),
      products: productRows.map((row) => ({
        kind: "product",
        id: row.id,
        name: row.name,
        category: row.category || "",
        price: row.price,
      })),
    },
  };
}

export function assertCompanionOfferPrice(item, policy, prevPrice) {
  if (Number.isNaN(item.price)) throw Object.assign(new Error("不允许输入无效金额。"), { status: 400 });
  if (item.price != null && item.price < 0) throw Object.assign(new Error("不允许输入负数。"), { status: 400 });
  if (item.price != null && !policy.allowSelfPrice && prevPrice !== item.price) {
    throw Object.assign(new Error("此服务价格由平台统一设置"), { status: 400 });
  }
  if (item.price != null && policy.allowSelfPrice) {
    if (policy.min != null && item.price < Number(policy.min)) {
      throw Object.assign(new Error(`价格不得低于 RM${policy.min}`), { status: 400 });
    }
    if (policy.max != null && item.price > Number(policy.max)) {
      throw Object.assign(new Error(`价格不得高于 RM${policy.max}`), { status: 400 });
    }
  }
}

export async function saveCompanionOffers(userId, offers) {
  const id = String(userId || "").trim();
  if (!id) throw Object.assign(new Error("缺少陪玩账号"), { status: 400 });
  const wanted = cleanOffers(offers);
  const { serviceRows, productRows } = await catalog();
  const allowed = new Set([
    ...serviceRows.map((row) => `service:${row.id}`),
    ...productRows.map((row) => `product:${row.id}`),
  ]);
  const known = wanted.filter((item) => allowed.has(`${item.kind}:${item.id}`));
  const loaded = await loadCompanionServiceStandards(id);
  if (!loaded.available) {
    throw Object.assign(new Error("陪玩资料尚未就绪，暂时不能保存服务"), { status: 503 });
  }
  const boundIds = await loadBoundServiceIds(id);
  const previous = cleanOffers(loaded.standards?.[OFFER_KEY]);
  const merged = mergeCompanionOffers(previous, known, boundIds);
  const same =
    JSON.stringify(merged.map((item) => ({ id: item.id, kind: item.kind, accepting: item.accepting, price: item.price }))) ===
    JSON.stringify(previous.map((item) => ({ id: item.id, kind: item.kind, accepting: item.accepting, price: item.price })));
  if (same) return listCompanionOffers(id);
  let policies = {};
  try {
    const { loadAllPricePolicies, normalizePricePolicy } = await import("./_service-price-policy.js");
    const map = await loadAllPricePolicies();
    policies = Object.fromEntries(Object.entries(map || {}).map(([key, value]) => [key, normalizePricePolicy(value)]));
  } catch {
    policies = {};
  }
  for (const item of merged) {
    if (item.kind !== "service") continue;
    const policy = policies[item.id] || { allowSelfPrice: false, allowSelfOff: false, min: null, max: null };
    const prev = previous.find((row) => row.kind === "service" && row.id === item.id);
    if (Number.isNaN(item.price)) throw Object.assign(new Error("不允许输入无效金额。"), { status: 400 });
    const prevPrice = prev && prev.price != null && !Number.isNaN(prev.price) ? Number(prev.price) : null;
    assertCompanionOfferPrice(item, policy, prevPrice);
  }
  const next = { ...loaded.standards, [OFFER_KEY]: merged };
  await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ service_standards: next, updated_at: new Date().toISOString() }),
  });
  return listCompanionOffers(id);
}
