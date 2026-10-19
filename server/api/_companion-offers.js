/**
 * Companion-selected catalog offers.
 * Stored on the existing companion_profiles.service_standards map under a
 * reserved key so we do not add a second catalog or require new columns.
 */
import { companionDb } from "./_companion-media-store.js";
import { readGamePrices } from "./_game-prices.js";
import { loadCompanionServiceStandards, pickServiceStandard, publicStandard } from "./_service-standard.js";
import {
  acceptedLegacyPrice,
  mergeOfferLists,
  offerPlaceLabel,
  parseMoneyStrict,
  quoteServiceOffer,
  validateCompanionOfferSave,
} from "./_service-offer-quote.js";
import { catalogOffersWereSaved, seedLegacyCatalogOffers } from "./_companion-profile-stats.js";

const OFFER_KEY = "__catalogOffers";

function cleanPrice(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function cleanOffers(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list
    .map((raw, index) => {
      const kind = raw?.kind === "product" ? "product" : "service";
      const id = String(raw?.id || "").trim();
      const accepting = raw?.accepting !== false && raw?.accepting !== "false" && raw?.enabled !== false && raw?.enabled !== "false";
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

async function catalog() {
  const services = await companionDb(
    "services",
    "?select=id,name,category,icon,default_price,enabled,allow_order,sort&order=sort.asc&limit=200"
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

async function loadPolicies() {
  try {
    const { loadAllPricePolicies, normalizePricePolicy } = await import("./_service-price-policy.js");
    const map = await loadAllPricePolicies();
    return Object.fromEntries(Object.entries(map || {}).map(([key, value]) => [key, normalizePricePolicy(value)]));
  } catch {
    return {};
  }
}

function serviceView(row, policy, saved, { standards = {}, gamePrices = {} } = {}) {
  const legacy =
    saved && (saved.price == null || saved.price === "")
      ? acceptedLegacyPrice(gamePrices[String(row.id)] ?? gamePrices[String(row.name || "")], policy)
      : null;
  const quote = quoteServiceOffer({
    service: row,
    policy,
    saved: legacy != null ? { ...saved, price: legacy } : saved,
  });
  const standard = publicStandard(pickServiceStandard(standards, { serviceId: row.id, name: row.name }));
  const sectionContent = (standard?.sections || []).find((section) => section.key === "content")?.value || "";
  const content = quote.description || sectionContent || "";
  return {
    kind: "service",
    id: row.id,
    name: quote.name,
    category: quote.category,
    icon: quote.icon,
    gameName: quote.gameName,
    platform: quote.platform,
    placeLabel: offerPlaceLabel(row, policy),
    description: quote.description,
    content,
    sections: standard?.sections || [],
    unit: quote.unit,
    price: quote.orderable ? quote.effectivePrice : quote.effectivePrice,
    platformPrice: quote.standardPrice,
    savedPrice: quote.savedPrice,
    accepting: quote.accepting,
    enabled: quote.orderable,
    orderable: quote.orderable,
    persisted: quote.persisted,
    priceStatus: quote.priceStatus,
    priceMessage: quote.priceMessage,
    canEditPrice: quote.canEditPrice,
    priceSource: legacy != null ? "game_prices" : quote.savedPrice != null ? "offer" : quote.effectivePrice != null ? "platform" : "",
    sort: Number(row.sort || 0),
    href: "",
    policy: {
      min: quote.min,
      max: quote.max,
      unit: quote.unit,
      allowSelfPrice: quote.canEditPrice,
      allowSelfOff: true,
      gameName: quote.gameName,
      platform: quote.platform,
      description: quote.description,
      standardPrice: quote.standardPrice,
      priceStatus: quote.priceStatus,
      priceMessage: quote.priceMessage,
    },
  };
}

async function loadProfilePricing(userId) {
  try {
    const rows = await companionDb(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(userId)}&select=id,game_prices,tags&limit=1`
    );
    const row = rows?.[0] || {};
    return { gamePrices: readGamePrices(row), profileId: String(row.id || "") };
  } catch (error) {
    console.warn("[companion-offers] game_prices read failed", error?.message || error);
    return { gamePrices: {}, profileId: "" };
  }
}

async function loadCompanionServiceRows(userId, profileId) {
  const ids = [...new Set([userId, profileId].map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  try {
    const rows = await companionDb(
      "companion_services",
      `?companion_id=in.(${ids.map(encodeURIComponent).join(",")})&select=companion_id,service_id,service_name,price,enabled,review_status&limit=80`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn("[companion-offers] companion_services read failed", error?.message || error);
    return [];
  }
}

export async function listCompanionOffers(userId, { enabledOnly = false } = {}) {
  const loaded = await loadCompanionServiceStandards(userId);
  const savedKey = catalogOffersWereSaved(loaded.standards, OFFER_KEY);
  const [{ serviceRows, productRows }, policies, pricing] = await Promise.all([
    catalog(),
    loadPolicies(),
    loadProfilePricing(userId),
  ]);
  const gamePrices = pricing.gamePrices || {};
  const legacyRows = savedKey ? [] : await loadCompanionServiceRows(userId, pricing.profileId);
  const raw = savedKey
    ? loaded.standards[OFFER_KEY]
    : seedLegacyCatalogOffers({ catalogServices: serviceRows, serviceRows: legacyRows, gamePrices });
  const saved = cleanOffers(raw);
  const savedService = new Map(saved.filter((item) => item.kind === "service").map((item) => [String(item.id), item]));
  const productMap = new Map(productRows.map((row) => [String(row.id), row]));
  const viewContext = { standards: loaded.standards || {}, gamePrices };
  const serviceOffers = serviceRows.map((row) =>
    serviceView(row, policies[String(row.id)] || {}, savedService.get(String(row.id)) || null, viewContext)
  );
  const productOffers = saved
    .filter((item) => item.kind === "product")
    .map((item) => {
      const row = productMap.get(item.id);
      if (!row) return null;
      return {
        ...item,
        name: row.name || "更多玩法",
        category: row.category || "",
        price: row.price,
        href: "",
        orderable: item.enabled !== false,
      };
    })
    .filter(Boolean);
  const offers = serviceOffers.concat(productOffers);
  return {
    offers: enabledOnly ? offers.filter((item) => (item.kind === "product" ? item.enabled !== false : item.orderable === true)) : offers,
    catalog: {
      services: serviceOffers,
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

export async function saveCompanionOffers(userId, offers) {
  const id = String(userId || "").trim();
  if (!id) throw Object.assign(new Error("缺少陪玩账号"), { status: 400 });
  for (const raw of Array.isArray(offers) ? offers : []) {
    if (raw?.kind === "product") continue;
    const parsed = parseMoneyStrict(raw?.price);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
  }
  const wanted = cleanOffers(offers);
  const { serviceRows, productRows } = await catalog();
  const serviceMap = new Map(serviceRows.map((row) => [String(row.id), row]));
  const allowed = new Set([
    ...serviceRows.map((row) => `service:${row.id}`),
    ...productRows.map((row) => `product:${row.id}`),
  ]);
  const rejected = wanted.filter((item) => !allowed.has(`${item.kind}:${item.id}`));
  if (rejected.length) {
    throw Object.assign(new Error("只能添加平台已启用、且允许陪玩选择的服务或玩法"), { status: 400 });
  }
  const loaded = await loadCompanionServiceStandards(id);
  if (!loaded.available) {
    throw Object.assign(new Error("陪玩资料尚未就绪，暂时不能保存服务"), { status: 503 });
  }
  const previous = cleanOffers(loaded.standards?.[OFFER_KEY]);
  const policies = await loadPolicies();
  const normalized = [];
  for (const item of wanted) {
    if (item.kind !== "service") {
      normalized.push(item);
      continue;
    }
    if (Number.isNaN(item.price)) throw Object.assign(new Error("不允许输入负数或非法字符。"), { status: 400 });
    const row = serviceMap.get(item.id);
    const prev = previous.find((entry) => entry.kind === "service" && entry.id === item.id) || null;
    const decision = validateCompanionOfferSave({
      service: row || {},
      policy: policies[item.id] || {},
      previous: prev,
      next: item,
    });
    normalized.push({
      ...item,
      price: decision.price,
      accepting: decision.accepting,
      enabled: decision.accepting,
    });
  }
  const nextOffers = mergeOfferLists(previous, normalized, allowed);
  const next = { ...loaded.standards, [OFFER_KEY]: nextOffers };
  await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ service_standards: next, updated_at: new Date().toISOString() }),
  });
  return listCompanionOffers(id);
}
