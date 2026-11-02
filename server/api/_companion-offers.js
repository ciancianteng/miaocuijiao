/**
 * Companion-selected catalog offers.
 * Accepting flags stay in companion_profiles.service_standards.__catalogOffers.
 * Sell price SoT is companion_profiles.game_prices (same as hall / detail / orders),
 * constrained by the companion's level base/min/max/maxPlus from companion_levels.
 */
import { companionDb } from "./_companion-media-store.js";
import { loadCompanionServiceStandards } from "./_service-standard.js";
import {
  parseServiceIds,
  priceForGame,
  readGamePrices,
  writeGamePricesMarker,
} from "./_game-prices.js";

const OFFER_KEY = "__catalogOffers";

function cleanPrice(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
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

async function loadCompanionRow(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const rows = await companionDb(
    "companion_profiles",
    `?user_id=eq.${encodeURIComponent(id)}&select=user_id,id,level_id,level_name,price,game_prices,tags,game,main_service,service_ids,service_standards,commission_rate&limit=1`
  ).catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function resolveCompanionLevel(companion) {
  const { readLocalLevels, toPublicLevel } = await import("./_companion-levels-store.js");
  const levels = await readLocalLevels().catch(() => []);
  const list = Array.isArray(levels) ? levels : [];
  const lid = String(companion?.level_id || "").trim();
  const lname = String(companion?.level_name || "").trim();
  let hit = null;
  if (lid) hit = list.find((row) => String(row.id) === lid || String(row.code) === lid) || null;
  if (!hit && lname) {
    hit =
      list.find((row) => String(row.name) === lname || `${row.code || ""} ${row.name || ""}`.trim() === lname) ||
      null;
  }
  return hit ? toPublicLevel(hit) : null;
}

function buildLevelPricing(level) {
  if (!level) {
    return {
      basePrice: 0,
      min: 0,
      max: 0,
      maxPlus: false,
      commissionRate: 0,
      priceRangeText: "请先联系后台设置等级",
      markupMax: 0,
      locked: true,
      allowAdjust: false,
    };
  }
  const basePrice = money(level.basePrice != null ? level.basePrice : level.min);
  const min = money(level.min != null ? level.min : level.minPrice);
  const max = money(level.max != null ? level.max : level.maxPrice);
  const maxPlus = !!level.maxPlus;
  const locked = !maxPlus && min > 0 && max > 0 && min === max;
  // X = max - base（等级限价动态计算）；maxPlus 时仍给出基准 X，超限由校验放行
  const markupMax = Math.max(0, Math.round((max - basePrice) * 100) / 100);
  return {
    basePrice,
    min,
    max,
    maxPlus,
    commissionRate: money(level.commissionRate),
    priceRangeText: level.priceRangeText || `${min}–${max}${maxPlus ? "+" : ""} 猫粮`,
    markupMax,
    locked,
    allowAdjust: !locked && min >= 0 && max >= min,
  };
}

function resolveBillingUnit(policyUnit, companion) {
  const fromPolicy = String(policyUnit || "").trim();
  if (fromPolicy && fromPolicy !== "猫粮" && fromPolicy !== "RM") return fromPolicy;
  const fromCompanion = String(companion?.pricing_unit || companion?.pricingUnit || "").trim();
  if (fromCompanion && fromCompanion !== "猫粮" && fromCompanion !== "RM") return fromCompanion;
  return "小时";
}

function servicePricingSnapshot(companion, levelPricing, row, savedOffer, policyUnit) {
  const base = money(levelPricing.basePrice) || money(row?.default_price) || 0;
  const fromMap = companion
    ? money(priceForGame(companion, row?.name || "", row?.id || ""))
    : 0;
  const fromOffer =
    savedOffer && savedOffer.price != null && !Number.isNaN(Number(savedOffer.price))
      ? money(savedOffer.price)
      : 0;
  const finalPrice = fromMap > 0 ? fromMap : fromOffer > 0 ? fromOffer : base;
  const currentMarkup = Math.max(0, Math.round((finalPrice - base) * 100) / 100);
  const locked = !!levelPricing.locked;
  const markupMax =
    levelPricing.markupMax == null
      ? Math.max(0, Math.round((money(levelPricing.max) - base) * 100) / 100)
      : levelPricing.markupMax;
  return {
    basePrice: base,
    min: levelPricing.min,
    max: levelPricing.max,
    maxPlus: levelPricing.maxPlus,
    markupMax,
    currentMarkup,
    finalPrice,
    locked,
    allowAdjust: !!levelPricing.allowAdjust && !locked,
    billingUnit: resolveBillingUnit(policyUnit, companion),
    unit: resolveBillingUnit(policyUnit, companion),
    priceRangeText: levelPricing.priceRangeText,
  };
}

function assertLevelOfferPrice(item, levelPricing, prevFinal) {
  if (Number.isNaN(item.price)) throw Object.assign(new Error("不允许输入无效金额。"), { status: 400 });
  if (item.price == null) return;
  if (item.price < 0) throw Object.assign(new Error("不允许输入负数。"), { status: 400 });
  if (!levelPricing.allowAdjust) {
    const lockedAt = money(levelPricing.basePrice || levelPricing.min);
    if (prevFinal != null && Math.abs(Number(item.price) - Number(prevFinal)) > 0.009) {
      throw Object.assign(new Error("该等级价格已锁定，不能修改。"), { status: 400 });
    }
    if (lockedAt > 0 && Math.abs(Number(item.price) - lockedAt) > 0.009) {
      throw Object.assign(new Error("该等级价格已锁定，不能修改。"), { status: 400 });
    }
    return;
  }
  const min = money(levelPricing.min);
  const max = money(levelPricing.max);
  if (item.price < min) {
    throw Object.assign(new Error(`价格不得低于 ${min} 猫粮`), { status: 400 });
  }
  if (!levelPricing.maxPlus && item.price > max) {
    throw Object.assign(new Error(`价格不得高于 ${max} 猫粮`), { status: 400 });
  }
}

export async function listCompanionOffers(userId, { enabledOnly = false } = {}) {
  const loaded = await loadCompanionServiceStandards(userId);
  const raw = loaded.standards?.[OFFER_KEY];
  const saved = cleanOffers(raw);
  const { serviceRows, productRows } = await catalog();
  const companion = await loadCompanionRow(userId);
  const level = await resolveCompanionLevel(companion || {});
  const levelPricing = buildLevelPricing(level);
  const gamePrices = companion ? readGamePrices(companion) : {};

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
      const legacyPolicy = policies[String(row.id)] || {};
      const pricing = servicePricingSnapshot(companion, levelPricing, row, item, legacyPolicy.unit);
      return {
        ...item,
        name: row.name || "服务",
        category: row.category || "",
        icon: row.icon || "🎮",
        platformPrice: row.default_price,
        platformEnabled: row.enabled !== false,
        price: pricing.finalPrice,
        pricing,
        href: "",
      };
    })
    .filter(Boolean);

  const catalogServices = serviceRows.map((row) => {
    const savedOffer = saved.find((item) => item.kind === "service" && String(item.id) === String(row.id));
    const legacyPolicy = policies[String(row.id)] || {
      min: null,
      max: null,
      unit: "小时",
      allowSelfPrice: false,
      allowSelfOff: false,
    };
    const pricing = servicePricingSnapshot(
      companion,
      levelPricing,
      row,
      savedOffer || null,
      legacyPolicy.unit
    );
    return {
      kind: "service",
      id: row.id,
      name: row.name,
      category: row.category || "",
      icon: row.icon || "🎮",
      price: pricing.finalPrice,
      enabled: row.enabled !== false,
      unit: pricing.billingUnit,
      pricing,
      policy: {
        ...legacyPolicy,
        min: pricing.min,
        max: pricing.max,
        unit: pricing.billingUnit,
        allowSelfPrice: pricing.allowAdjust,
        basePrice: pricing.basePrice,
        markupMax: pricing.markupMax,
        currentMarkup: pricing.currentMarkup,
        finalPrice: pricing.finalPrice,
        maxPlus: pricing.maxPlus,
        locked: pricing.locked,
        priceRangeText: pricing.priceRangeText,
        billingUnit: pricing.billingUnit,
      },
    };
  });

  return {
    offers: enabledOnly ? offers.filter((item) => item.accepting !== false) : offers,
    level: level
      ? {
          id: level.id,
          code: level.code,
          name: level.name,
          basePrice: levelPricing.basePrice,
          min: levelPricing.min,
          max: levelPricing.max,
          maxPlus: levelPricing.maxPlus,
          commissionRate: levelPricing.commissionRate,
          priceRangeText: levelPricing.priceRangeText,
        }
      : null,
    gamePrices,
    catalog: {
      services: catalogServices,
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

/** @deprecated Prefer level-based assertLevelOfferPrice; kept for older call sites. */
export function assertCompanionOfferPrice(item, policy, prevPrice) {
  if (Number.isNaN(item.price)) throw Object.assign(new Error("不允许输入无效金额。"), { status: 400 });
  if (item.price != null && item.price < 0) throw Object.assign(new Error("不允许输入负数。"), { status: 400 });
  if (item.price != null && !policy.allowSelfPrice && prevPrice !== item.price) {
    throw Object.assign(new Error("此服务价格由平台统一设置"), { status: 400 });
  }
  if (item.price != null && policy.allowSelfPrice) {
    if (policy.min != null && item.price < Number(policy.min)) {
      throw Object.assign(new Error(`价格不得低于 ${policy.min} 猫粮`), { status: 400 });
    }
    if (policy.max != null && item.price > Number(policy.max) && !policy.maxPlus) {
      throw Object.assign(new Error(`价格不得高于 ${policy.max} 猫粮`), { status: 400 });
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
  const rejected = wanted.filter((item) => !allowed.has(`${item.kind}:${item.id}`));
  if (rejected.length) {
    throw Object.assign(new Error("只能添加平台已启用、且允许陪玩选择的服务或玩法"), { status: 400 });
  }
  const loaded = await loadCompanionServiceStandards(id);
  if (!loaded.available) {
    throw Object.assign(new Error("陪玩资料尚未就绪，暂时不能保存服务"), { status: 503 });
  }
  const companion = await loadCompanionRow(id);
  if (!companion) {
    throw Object.assign(new Error("陪玩资料尚未就绪，暂时不能保存服务"), { status: 503 });
  }
  const level = await resolveCompanionLevel(companion);
  const levelPricing = buildLevelPricing(level);
  if (!level) {
    throw Object.assign(new Error("当前账号尚未设置等级，无法保存单价，请联系后台"), { status: 400 });
  }

  const previous = cleanOffers(loaded.standards?.[OFFER_KEY]);
  const prevGamePrices = readGamePrices(companion);
  const serviceById = new Map(serviceRows.map((row) => [String(row.id), row]));
  const nextGamePrices = { ...prevGamePrices };
  const touchedServiceIds = [];

  for (const item of wanted) {
    if (item.kind !== "service") continue;
    const row = serviceById.get(String(item.id));
    if (!row) continue;
    const prev = previous.find((x) => x.kind === "service" && x.id === item.id);
    const prevSnap = servicePricingSnapshot(companion, levelPricing, row, prev || null);
    const prevFinal = prevSnap.finalPrice > 0 ? prevSnap.finalPrice : null;
    if (item.price == null || Number.isNaN(item.price)) {
      // Keep existing sell price when toggle-only save omits price.
      item.price = prevFinal != null ? prevFinal : levelPricing.basePrice || null;
    }
    assertLevelOfferPrice(item, levelPricing, prevFinal);
    if (item.price != null && Number.isFinite(item.price) && item.price > 0) {
      const name = String(row.name || "").trim();
      nextGamePrices[String(item.id)] = item.price;
      if (name) nextGamePrices[name] = item.price;
      touchedServiceIds.push(String(item.id));
    }
  }

  const incoming = new Set(wanted.map((item) => `${item.kind}:${item.id}`));
  const keptProducts = previous.filter((item) => item.kind === "product" && !incoming.has(`product:${item.id}`));
  const nextStandards = { ...loaded.standards, [OFFER_KEY]: wanted.concat(keptProducts) };

  const acceptingIds = wanted.filter((item) => item.kind === "service" && item.accepting !== false).map((item) => String(item.id));
  const existingIds = parseServiceIds(companion.service_ids);
  const nextServiceIds = acceptingIds.length
    ? acceptingIds
    : existingIds.filter((sid) => {
        const hit = wanted.find((item) => item.kind === "service" && String(item.id) === String(sid));
        return !hit || hit.accepting !== false;
      });

  let primaryPrice = money(companion.price);
  if (nextServiceIds.length && nextGamePrices[nextServiceIds[0]] != null) {
    primaryPrice = money(nextGamePrices[nextServiceIds[0]]);
  } else {
    const firstPositive = Object.keys(nextGamePrices)
      .map((k) => money(nextGamePrices[k]))
      .find((v) => v > 0);
    if (firstPositive > 0) primaryPrice = firstPositive;
  }

  const tagsForWrite = writeGamePricesMarker(companion.tags || "", nextGamePrices);
  const patch = {
    service_standards: nextStandards,
    game_prices: nextGamePrices,
    tags: tagsForWrite,
    price: primaryPrice > 0 ? primaryPrice : money(companion.price),
    updated_at: new Date().toISOString(),
  };
  if (nextServiceIds.length) patch.service_ids = nextServiceIds;

  await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  try {
    const { syncCompanionServicesFromGamePrices } = await import("./_admin-service-prices.js");
    const selectedServices = (nextServiceIds.length ? nextServiceIds : touchedServiceIds)
      .map((sid) => serviceById.get(String(sid)))
      .filter(Boolean);
    if (selectedServices.length) {
      await syncCompanionServicesFromGamePrices({
        companionId: id,
        companion: { ...companion, user_id: id, level_id: companion.level_id },
        gamePrices: nextGamePrices,
        selectedServices,
        source: "companion_custom",
      });
    }
  } catch (syncErr) {
    console.warn("[saveCompanionOffers] companion_services sync", syncErr?.message || syncErr);
  }

  return listCompanionOffers(id);
}
