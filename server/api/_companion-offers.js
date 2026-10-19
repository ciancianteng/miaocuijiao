/**
 * Companion-selected catalog offers.
 * Stored on the existing companion_profiles.service_standards map under a
 * reserved key so we do not add a second catalog or require new columns.
 */
import { companionDb } from "./_companion-media-store.js";
import { readGamePrices } from "./_game-prices.js";
import { loadCompanionServiceStandards, pickServiceStandard, publicStandard } from "./_service-standard.js";
import { readLocalLevels } from "./_companion-levels-store.js";
import {
  acceptedLegacyPrice,
  levelIndexFrom,
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
        markup: raw?.markup == null || String(raw.markup).trim() === "" ? null : String(raw.markup).trim(),
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

async function loadMarkupCaps() {
  try {
    const { loadLevelMarkupCaps } = await import("./_service-price-policy.js");
    return await loadLevelMarkupCaps();
  } catch {
    const { normalizeLevelMarkupCaps } = await import("./_service-offer-quote.js");
    return normalizeLevelMarkupCaps(null);
  }
}

async function remember(shared, key, loader) {
  if (shared && shared[key] !== undefined) return shared[key];
  const value = await loader();
  if (shared) shared[key] = value;
  return value;
}

function matchLevelRecord(levels, levelId, levelName) {
  const key = String(levelId || levelName || "").trim().toLowerCase();
  if (!key) return null;
  return (
    (levels || []).find((row) => {
      const keys = [row.id, row.code, row.name, `${row.code || ""} ${row.name || ""}`.trim(), `lv${row.level || ""}`]
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean);
      return keys.includes(key);
    }) || null
  );
}

async function loadCompanionLevel(userId, shared) {
  const id = String(userId || "").trim();
  if (!id) return { index: null, label: "", id: "", name: "" };
  if (shared?.levelByUser?.[id]) return shared.levelByUser[id];
  let row = {};
  try {
    const rows = await companionDb(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(id)}&select=level_id,level_name&limit=1`
    );
    row = rows?.[0] || {};
  } catch (error) {
    console.warn("[companion-offers] level read failed", error?.message || error);
  }
  const levels = await remember(shared, "levels", () => readLocalLevels().catch(() => []));
  const found = matchLevelRecord(levels, row.level_id, row.level_name);
  const index = levelIndexFrom(found) || levelIndexFrom({ level_name: row.level_name, code: row.level_id });
  const info = {
    index,
    label: index ? `LV${index}` : "",
    id: found?.id || row.level_id || "",
    name: found?.name || row.level_name || "",
  };
  if (shared) {
    shared.levelByUser = shared.levelByUser || {};
    shared.levelByUser[id] = info;
  }
  return info;
}

function serviceView(row, policy, saved, { standards = {}, gamePrices = {}, level = null, markupCaps = null } = {}) {
  const legacy =
    saved && (saved.price == null || saved.price === "")
      ? acceptedLegacyPrice(gamePrices[String(row.id)] ?? gamePrices[String(row.name || "")], policy)
      : null;
  const quote = quoteServiceOffer({
    service: row,
    policy,
    saved: legacy != null ? { ...saved, price: legacy } : saved,
    level,
    markupCaps,
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
    requirements: String(policy.requirements || "").trim(),
    content,
    sections: standard?.sections || [],
    unit: quote.unit,
    price: quote.effectivePrice,
    platformPrice: quote.standardPrice,
    savedPrice: quote.markupClamped ? quote.effectivePrice : quote.savedPrice,
    savedMarkup: quote.markupClamped ? quote.effectiveMarkup : quote.savedMarkup,
    effectiveMarkup: quote.effectiveMarkup,
    markupClamped: quote.markupClamped === true,
    levelIndex: quote.levelIndex,
    levelLabel: quote.levelLabel,
    levelCap: quote.levelCap,
    markupMin: quote.markupMin,
    markupMax: quote.markupMax,
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
      allowedMin: quote.allowedMin,
      allowedMax: quote.allowedMax,
      levelIndex: quote.levelIndex,
      levelLabel: quote.levelLabel,
      levelCap: quote.levelCap,
      markupMin: quote.markupMin,
      markupMax: quote.markupMax,
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

export async function listCompanionOffers(userId, { enabledOnly = false, shared = null } = {}) {
  const loaded = await loadCompanionServiceStandards(userId);
  const savedKey = catalogOffersWereSaved(loaded.standards, OFFER_KEY);
  const [{ serviceRows, productRows }, policies, pricing, markupCaps, level] = await Promise.all([
    remember(shared, "catalog", catalog),
    remember(shared, "policies", loadPolicies),
    loadProfilePricing(userId),
    remember(shared, "markupCaps", loadMarkupCaps),
    loadCompanionLevel(userId, shared),
  ]);
  const gamePrices = pricing.gamePrices || {};
  const legacyRows = savedKey ? [] : await loadCompanionServiceRows(userId, pricing.profileId);
  const raw = savedKey
    ? loaded.standards[OFFER_KEY]
    : seedLegacyCatalogOffers({ catalogServices: serviceRows, serviceRows: legacyRows, gamePrices });
  const saved = cleanOffers(raw);
  const savedService = new Map(saved.filter((item) => item.kind === "service").map((item) => [String(item.id), item]));
  const productMap = new Map(productRows.map((row) => [String(row.id), row]));
  const viewContext = { standards: loaded.standards || {}, gamePrices, level, markupCaps };
  const serviceOffers = serviceRows.map((row) =>
    serviceView(row, policies[String(row.id)] || {}, savedService.get(String(row.id)) || null, viewContext)
  );
  if (savedKey) await persistClampedOffers(userId, loaded.standards, saved, serviceOffers);
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
    offersSaved: savedKey,
    level,
    markupCaps,
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

async function persistClampedOffers(userId, standards, saved, serviceOffers) {
  const byId = new Map(serviceOffers.map((item) => [String(item.id), item]));
  let changed = false;
  const nextOffers = saved.map((item) => {
    if (item.kind !== "service") return item;
    const view = byId.get(String(item.id));
    if (!view || view.markupClamped !== true || !(Number(view.price) > 0)) return item;
    if (Number(item.price) === Number(view.price)) return item;
    changed = true;
    return { ...item, price: Number(view.price) };
  });
  if (!changed) return;
  try {
    await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        service_standards: { ...standards, [OFFER_KEY]: nextOffers },
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.warn("[companion-offers] clamp persist failed", error?.message || error);
  }
}

export function applyQuotedOffersToCard(card, listed) {
  if (!card || !listed || listed.offersSaved !== true) return card;
  const services = (listed.offers || []).filter(
    (item) => item && item.kind !== "product" && item.orderable === true && Number(item.price) > 0
  );
  if (!services.length) return card;
  const nextServices = services.map((item, index) => ({
    id: String(item.id),
    serviceId: String(item.id),
    name: item.name,
    price: Number(item.price),
    pricingUnit: item.unit || "局",
    sort: index,
  }));
  const gamePrices = {};
  nextServices.forEach((item) => {
    gamePrices[item.id] = item.price;
    if (item.name) gamePrices[item.name] = item.price;
  });
  const primary = nextServices[0];
  return {
    ...card,
    services: nextServices,
    serviceIds: nextServices.map((item) => item.id),
    service_ids: nextServices.map((item) => item.id),
    gamePrices,
    price: primary.price,
    priceValue: primary.price,
    hourlyPrice: primary.price,
    sellingPrice: primary.price,
    pricingUnit: primary.pricingUnit,
    lockOfferServices: true,
  };
}

export async function overlayQuotedOfferPrices(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const shared = {};
  return Promise.all(
    list.map(async (card) => {
      const userId = String(card?.id || card?.uid || card?.user_id || "").trim();
      if (!userId) return card;
      try {
        const listed = await listCompanionOffers(userId, { enabledOnly: false, shared });
        return applyQuotedOffersToCard(card, listed);
      } catch (error) {
        console.warn("[companion-offers] public price overlay", error?.message || error);
        return card;
      }
    })
  );
}

export async function saveCompanionOffers(userId, offers) {
  const id = String(userId || "").trim();
  if (!id) throw Object.assign(new Error("缺少陪玩账号"), { status: 400 });
  for (const raw of Array.isArray(offers) ? offers : []) {
    if (raw?.kind === "product") continue;
    const parsed = parseMoneyStrict(raw?.price);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
    if (raw?.markup != null && String(raw.markup).trim() !== "") {
      const markup = parseMoneyStrict(raw.markup);
      if (markup.error) throw Object.assign(new Error(markup.error), { status: 400 });
    }
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
  const [policies, markupCaps, level] = await Promise.all([loadPolicies(), loadMarkupCaps(), loadCompanionLevel(id)]);
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
      level,
      markupCaps,
    });
    normalized.push({
      kind: item.kind,
      id: item.id,
      sort: item.sort,
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
