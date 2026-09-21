/**
 * Admin per-service companion pricing (reuse companion_services + game_prices).
 * Does NOT invent a second pricing table.
 *
 * Write path: admin sets unit prices per game/service → upsert companion_services
 * (source=admin_set) + sync companion_profiles.game_prices + listing price.
 */
import { companionDb, hasCompanionDb, isMissingRelation } from "./_companion-media-store.js";
import { parseServiceIds, readGamePrices, splitGames } from "./_game-prices.js";
import { resolveEffectiveServicePrice } from "./_resolve-effective-service-price.js";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function levelBase(level) {
  if (!level || typeof level !== "object") return 0;
  return money(level.basePrice ?? level.base_price ?? level.min ?? level.min_price);
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

/** Stable display identity helper: prefer service_id UUID, else normalized name. */
export function normalizeServiceName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build the editable service price list for Admin UI from real companion data.
 * Prefers companion_services rows; falls back to game / service_ids / game_prices.
 * One companion + one service → at most one row (dedupe by service_id, then name).
 * Price priority when merging sources: companion_services.price → game_prices → level.base_price.
 */
export function buildAdminServicePriceList(companion = {}, serviceRows = [], level = null) {
  const base = levelBase(level);
  const prices = readGamePrices(companion);
  const ids = parseServiceIds(companion.service_ids ?? companion.serviceIds);
  const games = splitGames(companion.game || companion.main_service || companion.main_game || "");
  const rows = Array.isArray(serviceRows) ? serviceRows.filter(Boolean) : [];
  const byKey = new Map();
  const nameToKey = new Map();

  const resolvePrice = ({ serviceId = "", serviceName = "", unitPrice = 0 } = {}) => {
    const sid = String(serviceId || "").trim();
    const name = String(serviceName || "").trim();
    let price = money(unitPrice);
    if (!(price > 0) && sid && money(prices[sid]) > 0) price = money(prices[sid]);
    if (!(price > 0) && name && money(prices[name]) > 0) price = money(prices[name]);
    if (!(price > 0) && base > 0) price = base;
    return price;
  };

  const upsert = ({ serviceId = "", serviceName = "", unitPrice = 0, source = "", rowId = "" } = {}) => {
    const name = String(serviceName || "").trim();
    const sid = String(serviceId || "").trim();
    if (!name && !sid) return;
    const nkey = normalizeServiceName(name);
    let key = isUuid(sid) ? `id:${sid.toLowerCase()}` : nkey ? `name:${nkey}` : "";
    if (!key) return;
    // Same display name as an existing row → merge into that row (don't create a second line).
    if (nkey && nameToKey.has(nkey)) {
      key = nameToKey.get(nkey);
    }

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.serviceId && isUuid(sid)) existing.serviceId = sid;
      if ((!existing.serviceName || existing.serviceName === existing.serviceId) && name) {
        existing.serviceName = name;
      }
      if (!existing.rowId && rowId) existing.rowId = rowId;
      // Prefer already-set companion_services price; only fill if missing.
      if (!(money(existing.unitPrice) > 0)) {
        existing.unitPrice = resolvePrice({
          serviceId: existing.serviceId || sid,
          serviceName: existing.serviceName || name,
          unitPrice,
        });
        if (source) existing.source = source;
      }
      return;
    }

    const price = resolvePrice({ serviceId: sid, serviceName: name, unitPrice });
    const item = {
      rowId: rowId || "",
      serviceId: sid,
      serviceName: name || sid || "服务",
      unitPrice: price,
      source: source || (price === base && base > 0 ? "level_base_price" : "legacy_profile"),
      pricingUnit: "小时",
    };
    byKey.set(key, item);
    if (nkey) nameToKey.set(nkey, key);
  };

  for (const r of rows) {
    if (r.enabled === false) continue;
    const status = String(r.review_status || r.reviewStatus || "approved").toLowerCase();
    if (status && !["approved", "active", "pending"].includes(status)) continue;
    upsert({
      rowId: r.id || "",
      serviceId: r.service_id || r.serviceId || "",
      serviceName: r.service_name || r.serviceName || r.name || "",
      unitPrice: r.price,
      source: r.source || "companion_service",
    });
  }

  if (ids.length) {
    ids.forEach((id, idx) => {
      const uuid = isUuid(id);
      const name = games[idx] || (uuid ? "" : String(id));
      upsert({ serviceId: id, serviceName: name, unitPrice: prices[id] || prices[name] });
    });
  } else if (games.length) {
    games.forEach((g) => upsert({ serviceName: g, unitPrice: prices[g] }));
  }

  // Leftover game_prices name keys — merge into existing rows; never create a duplicate line
  // when companion_services already listed the same service (name or id).
  Object.keys(prices).forEach((k) => {
    if (isUuid(k)) return;
    upsert({ serviceName: k, unitPrice: prices[k] });
  });

  if (!byKey.size && money(companion.price) > 0) {
    upsert({
      serviceName: String(companion.game || companion.main_service || "默认服务").split(/[,，]/)[0] || "默认服务",
      unitPrice: companion.price,
      source: "legacy_profile",
    });
  }

  return [...byKey.values()];
}

export function parseServicePricesPayload(payload = {}) {
  const list = [];
  const raw = payload.servicePrices ?? payload.service_prices;
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      list.push({
        serviceId: String(item.serviceId || item.service_id || "").trim(),
        serviceName: String(item.serviceName || item.service_name || item.name || "").trim(),
        unitPrice: money(item.unitPrice ?? item.unit_price ?? item.price),
        rowId: String(item.rowId || item.id || "").trim(),
      });
    });
  }
  // Form fields: servicePrice__<name> or servicePrice[<name>]
  Object.keys(payload || {}).forEach((key) => {
    const m = String(key).match(/^servicePrice(?:__|\[)(.+?)\]?$/);
    if (!m) return;
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep */
    }
    list.push({
      serviceId: "",
      serviceName: String(name || "").trim(),
      unitPrice: money(payload[key]),
      rowId: "",
    });
  });
  // Dedupe by service_id UUID first, else normalized name — keep last price (form order).
  const map = new Map();
  const nameToKey = new Map();
  for (const item of list) {
    if (!(item.unitPrice > 0)) continue;
    if (!item.serviceName && !item.serviceId) continue;
    const nkey = normalizeServiceName(item.serviceName);
    let key = isUuid(item.serviceId) ? `id:${String(item.serviceId).toLowerCase()}` : nkey ? `name:${nkey}` : "";
    if (!key) continue;
    if (nkey && nameToKey.has(nkey)) key = nameToKey.get(nkey);
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        ...item,
        serviceId: isUuid(item.serviceId) ? item.serviceId : prev.serviceId || item.serviceId,
        serviceName: item.serviceName || prev.serviceName,
        rowId: item.rowId || prev.rowId,
        unitPrice: item.unitPrice,
      });
    } else {
      map.set(key, item);
    }
    if (nkey) nameToKey.set(nkey, key);
  }
  return [...map.values()];
}

function findExisting(existing, item) {
  const sid = String(item.serviceId || "");
  const name = String(item.serviceName || "");
  const rid = String(item.rowId || "");
  if (rid) {
    const byId = (existing || []).find((r) => String(r.id) === rid);
    if (byId) return byId;
  }
  return (
    (existing || []).find((r) => sid && String(r.service_id || "") === sid) ||
    (existing || []).find((r) => name && String(r.service_name || "") === name) ||
    null
  );
}

/**
 * Apply admin per-service prices. Returns profiles patch { price, game_prices }.
 */
export async function applyAdminServicePrices(companion = {}, items = [], level = null) {
  const companionId = String(companion.user_id || companion.userId || "").trim();
  if (!companionId) {
    const err = new Error("陪玩账号缺少 user_id，无法保存服务价格");
    err.status = 400;
    err.code = "SERVICE_PRICE_NO_USER";
    throw err;
  }
  const prices = [...(items || [])].filter((x) => money(x.unitPrice) > 0);
  if (!prices.length) {
    return { profilesPatch: null, written: [], mode: "noop" };
  }

  const game_prices = { ...readGamePrices(companion) };
  for (const item of prices) {
    const name = String(item.serviceName || "").trim();
    const sid = String(item.serviceId || "").trim();
    const p = money(item.unitPrice);
    if (name) game_prices[name] = p;
    if (sid) game_prices[sid] = p;
  }
  const listing = money(prices[0].unitPrice);
  const profilesPatch = {
    price: listing > 0 ? listing : money(companion.price),
    game_prices,
  };

  if (!hasCompanionDb()) {
    return { profilesPatch, written: [], mode: "profiles_only_no_db" };
  }

  let existing = [];
  try {
    existing =
      (await companionDb(
        "companion_services",
        `?companion_id=eq.${encodeURIComponent(companionId)}&select=id,service_id,service_name,price,source,enabled,review_status`
      )) || [];
  } catch (e) {
    if (isMissingRelation(e)) {
      return { profilesPatch, written: [], mode: "companion_profiles", skippedTable: true };
    }
    throw e;
  }

  const levelId = String(level?.id || companion.level_id || companion.levelId || "").trim();
  const written = [];
  for (const item of prices) {
    const hit = findExisting(existing, item);
    const body = {
      companion_id: companionId,
      service_id: item.serviceId || null,
      service_name: item.serviceName || "服务",
      price: money(item.unitPrice),
      pricing_unit: "小时",
      enabled: true,
      review_status: "approved",
      source: "admin_set",
      level_id_at_price: levelId || null,
      updated_at: nowIso(),
    };
    if (hit) {
      const patched = await companionDb(`companion_services`, `?id=eq.${encodeURIComponent(hit.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          price: body.price,
          enabled: true,
          review_status: "approved",
          source: "admin_set",
          service_name: body.service_name,
          service_id: body.service_id,
          level_id_at_price: body.level_id_at_price,
          updated_at: body.updated_at,
        }),
      });
      written.push({ id: hit.id, action: "updated", price: body.price, row: Array.isArray(patched) ? patched[0] : patched });
    } else {
      const inserted = await companionDb("companion_services", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      written.push({
        id: Array.isArray(inserted) ? inserted[0]?.id : inserted?.id,
        action: "inserted",
        price: body.price,
        row: Array.isArray(inserted) ? inserted[0] : inserted,
      });
    }
  }

  return { profilesPatch, written, mode: "companion_services" };
}

/** Load companion_services rows for a companion (empty if table missing). */
export async function loadCompanionServiceRows(companionUserId) {
  const id = String(companionUserId || "").trim();
  if (!id || !hasCompanionDb()) return [];
  try {
    return (
      (await companionDb(
        "companion_services",
        `?companion_id=eq.${encodeURIComponent(id)}&order=updated_at.desc`
      )) || []
    );
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/**
 * Server-authoritative unit price for place_order / place_multi_order.
 * Never trusts client price. Fallback: service row → game_prices → level.base_price.
 */
export async function resolveOrderUnitPrice({
  companion,
  companionId,
  serviceId = "",
  gameName = "",
  serviceRowId = "",
  level = null,
} = {}) {
  const rows = await loadCompanionServiceRows(companionId || companion?.user_id);
  const resolved = resolveEffectiveServicePrice({
    companion,
    companionId: companionId || companion?.user_id,
    serviceId,
    gameName,
    serviceRowId,
    serviceRows: rows,
    level,
  });
  return resolved;
}

export { money as moneyAmount, buildAdminServicePriceList as listServicePricesForAdmin };
