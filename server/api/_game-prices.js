/**
 * Companion sell prices.
 *
 * companion_profiles.price
 *   Admin unit / listing price. An admin unit edit writes this field and, when the
 *   companion has a single service or every stored service price is still the same,
 *   copies it into game_prices and the matching companion_services rows.
 * companion_profiles.game_prices
 *   Per-service quote map (service id or service name → positive price). Also mirrored
 *   in the [[MCJ_PRICES:]] tags marker. This is the live service quote, not an order snapshot.
 * companion_services.price
 *   Per-row copy of a service quote. A distinct row price is kept when services differ.
 *   Order unit_price / total_amount are written once at checkout and are never rewritten here.
 *
 * Hall and public cards show the minimum of the valid service quotes as 「XX 猫粮起」.
 * A profile price with no service quote is not a display or checkout fallback.
 */

export const MAIN_GAMES = Object.freeze([
  "VALORANT",
  "三角洲",
  "APEX",
  "CS2",
  "英雄联盟",
  "王者荣耀",
  "和平精英",
  "其他",
]);

const PRICES_MARK_START = "[[MCJ_PRICES:";
const PRICES_MARK_END = "]]";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function readGamePrices(companion = {}) {
  const out = {};
  const rawCol = companion.game_prices;
  if (rawCol && typeof rawCol === "object" && !Array.isArray(rawCol)) {
    Object.keys(rawCol).forEach((k) => {
      const v = money(rawCol[k]);
      if (v > 0) out[k] = v;
    });
  } else if (typeof rawCol === "string" && rawCol.trim()) {
    try {
      const parsed = JSON.parse(rawCol);
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach((k) => {
          const v = money(parsed[k]);
          if (v > 0) out[k] = v;
        });
      }
    } catch {
      /* ignore */
    }
  }
  const text = String(companion.tags || "");
  const i = text.indexOf(PRICES_MARK_START);
  if (i >= 0) {
    const j = text.indexOf(PRICES_MARK_END, i);
    if (j > i) {
      try {
        const parsed = JSON.parse(text.slice(i + PRICES_MARK_START.length, j));
        if (parsed && typeof parsed === "object") {
          Object.keys(parsed).forEach((k) => {
            const v = money(parsed[k]);
            if (v > 0) out[k] = v;
          });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

export function stripGamePricesMarker(tags) {
  const text = String(tags || "");
  const i = text.indexOf(PRICES_MARK_START);
  if (i < 0) return text;
  const j = text.indexOf(PRICES_MARK_END, i);
  if (j < 0) return text;
  return `${text.slice(0, i)}${text.slice(j + PRICES_MARK_END.length)}`
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .trim();
}

export function writeGamePricesMarker(baseTags, prices = {}) {
  const cleaned = stripGamePricesMarker(baseTags);
  const compact = {};
  Object.keys(prices || {}).forEach((k) => {
    const v = money(prices[k]);
    if (v > 0) compact[k] = v;
  });
  if (!Object.keys(compact).length) return cleaned;
  return `${cleaned}${cleaned ? "," : ""}${PRICES_MARK_START}${JSON.stringify(compact)}${PRICES_MARK_END}`;
}

export function splitGames(value) {
  return String(value || "")
    .split(/[,，、/|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseServiceIds(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((x) => String(x || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x || "").trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return splitGames(text);
}

export function canonicalizeServiceType(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "陪玩服务" || s === "陪聊服务") return s;
  if (/陪聊|语音|语聊|聊天/.test(s)) return "陪聊服务";
  if (/陪玩/.test(s)) return "陪玩服务";
  return "";
}

export function parseServiceTypes(value, { fallbackPlayWhenGame = false, hasGame = false } = {}) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "").trim();
  const types = [];
  const push = (part) => {
    const next = canonicalizeServiceType(part);
    if (next && !types.includes(next)) types.push(next);
  };
  if (raw) raw.split(/[,，、/|]+/).map((x) => x.trim()).filter(Boolean).forEach(push);
  if (!types.length && fallbackPlayWhenGame && hasGame) types.push("陪玩服务");
  return types;
}

function serviceNames(companion = {}) {
  return splitGames(companion.game || companion.main_service);
}

function nameMatches(left = "", right = "") {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

/**
 * Admin unit price is companion_profiles.price.
 * A single service, or several services that still share one stored price, follows that unit price.
 * A service with its own different price is left unchanged.
 * Historical orders are not represented here and are never rewritten.
 */
export function reconcileAdminServicePrices(companion = {}, nextPrice) {
  const next = money(nextPrice);
  const current = readGamePrices(companion);
  if (!(next > 0)) return { ...current };
  const ids = parseServiceIds(companion.service_ids);
  const names = serviceNames(companion);
  const distinct = new Set(Object.values(current).filter((v) => v > 0));
  const uniform = distinct.size <= 1;
  const single = ids.length <= 1;
  const selected = new Set(ids.filter(Boolean));
  names.forEach((name) => selected.add(name));
  Object.keys(current).forEach((key) => {
    if (names.some((name) => nameMatches(name, key)) || ids.some((id) => id && key === id)) selected.add(key);
  });
  const out = { ...current };
  if (single || uniform) {
    selected.forEach((key) => {
      out[key] = next;
    });
    if (uniform) {
      Object.keys(out).forEach((key) => {
        out[key] = next;
      });
    }
    return out;
  }
  const primaryId = ids[0] || "";
  const primaryName = names[0] || "";
  if (primaryId) out[primaryId] = next;
  if (primaryName) out[primaryName] = next;
  Object.keys(current).forEach((key) => {
    if (ids.includes(key) && key !== primaryId) return;
    if (nameMatches(primaryName, key)) out[key] = next;
  });
  return out;
}

/** A resubmitted stale game_prices value must not replace the admin unit price. */
export function acceptSubmittedServicePrice(companion = {}, serviceId = "", serviceName = "", submitted) {
  const next = money(submitted);
  const listing = money(companion.price);
  const stored = readGamePrices(companion);
  const storedVal = money((serviceId && stored[serviceId]) || (serviceName && stored[serviceName]) || 0);
  if (!(listing > 0) || !(storedVal > 0) || storedVal === listing || next !== storedVal) return next;
  const reconciled = reconcileAdminServicePrices(companion, listing);
  const target = money((serviceId && reconciled[serviceId]) || (serviceName && reconciled[serviceName]) || 0);
  if (target === listing && target !== storedVal) return listing;
  return next;
}

function isLiveServiceRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.enabled === false || row.enabled === "false" || row.enabled === 0) return false;
  const status = String(row.review_status || row.reviewStatus || "approved").trim().toLowerCase();
  return !status || status === "approved" || status === "active";
}

/**
 * Read-only service quotes.
 * A single service, or several services that still share one stored price, follows the
 * admin unit price so a 60 → 35 unit edit wins over the stale map.
 * Differing service prices stay on their own keys.
 * Empty maps are not filled from companion_profiles.price.
 */
export function quotedServicePrices(companion = {}) {
  const stored = readGamePrices(companion);
  const listing = money(companion.price);
  const ids = parseServiceIds(companion.service_ids);
  const positive = Object.values(stored).map((value) => money(value)).filter((value) => value > 0);
  const distinct = new Set(positive);
  const uniformPrice = distinct.size === 1 ? [...distinct][0] : 0;
  // A lower admin unit replaces one stale price. A higher listing must not cover a real service quote.
  const overlay = listing > 0 && uniformPrice > listing && (ids.length <= 1 || distinct.size <= 1);
  if (!overlay) return { ...stored };
  const out = {};
  Object.keys(stored).forEach((key) => {
    if (money(stored[key]) > 0) out[key] = listing;
  });
  return out;
}

function priceFromMap(map, serviceId = "", serviceName = "") {
  const id = String(serviceId || "").trim();
  const name = String(serviceName || "").trim();
  if (id && money(map[id]) > 0) return money(map[id]);
  if (name && money(map[name]) > 0) return money(map[name]);
  if (name) {
    const key = Object.keys(map).find((item) => nameMatches(name, item));
    if (key && money(map[key]) > 0) return money(map[key]);
  }
  return 0;
}

export function serviceQuotes(companion = {}, serviceRows = []) {
  const map = quotedServicePrices(companion);
  const rows = (Array.isArray(serviceRows) ? serviceRows : []).filter(isLiveServiceRow);
  if (rows.length) {
    return rows
      .map((row) => {
        const id = String(row.service_id || row.serviceId || "").trim();
        const name = String(row.service_name || row.serviceName || row.name || "").trim();
        const fromMap = priceFromMap(map, id, name);
        const price = fromMap > 0 ? fromMap : money(row.price);
        return { id, name, price };
      })
      .filter((quote) => quote.price > 0);
  }
  const ids = parseServiceIds(companion.service_ids);
  const names = serviceNames(companion);
  if (ids.length) {
    return ids
      .map((id, index) => ({
        id: String(id),
        name: names[index] || "",
        price: priceFromMap(map, id, names[index] || ""),
      }))
      .filter((quote) => quote.price > 0);
  }
  if (names.length) {
    return names
      .map((name) => ({ id: "", name, price: priceFromMap(map, "", name) }))
      .filter((quote) => quote.price > 0);
  }
  return Object.keys(map)
    .map((key) => ({
      id: /^[0-9a-f-]{36}$/i.test(key) ? key : "",
      name: /^[0-9a-f-]{36}$/i.test(key) ? "" : key,
      price: money(map[key]),
    }))
    .filter((quote) => quote.price > 0);
}

export function hallPriceSummary(companion = {}, serviceRows = []) {
  const quotes = serviceQuotes(companion, serviceRows);
  if (!quotes.length) {
    return { price: 0, count: 0, quotes, label: "暂无报价", state: "no_quote" };
  }
  const price = Math.round(quotes.reduce((min, quote) => Math.min(min, quote.price), quotes[0].price) * 100) / 100;
  const text = Number.isInteger(price) ? String(price) : String(price);
  return { price, count: quotes.length, quotes, label: `${text} 猫粮起`, state: "quoted" };
}

export function quoteForService(companion = {}, spec = {}) {
  const quotes = serviceQuotes(companion, spec.serviceRows || []);
  const id = String(spec.serviceId || "").trim();
  const name = String(spec.serviceName || spec.gameName || "").trim();
  if (id) {
    const hit = quotes.find((quote) => quote.id && quote.id === id);
    if (hit) return hit.price;
  }
  if (name) {
    const exact = quotes.find((quote) => quote.name && quote.name === name);
    if (exact) return exact.price;
    const fuzzy = quotes
      .filter((quote) => quote.name && nameMatches(name, quote.name))
      .sort((a, b) => b.name.length - a.name.length);
    if (fuzzy.length === 1 || (fuzzy.length > 1 && fuzzy[0].name.length > fuzzy[1].name.length)) return fuzzy[0].price;
  }
  const rowPrice = money(spec.rowPrice);
  if (rowPrice > 0) return rowPrice;
  if (!id && !name && quotes.length === 1) return quotes[0].price;
  return 0;
}

export function priceForGame(companion = {}, gameName = "", serviceId = "", serviceRows = []) {
  return quoteForService(companion, { serviceId, serviceName: gameName, serviceRows });
}

export function servicesFromGamePrices(companion = {}, catalog = []) {
  const prices = readGamePrices(companion);
  const unit = companion.pricing_unit || "小时";
  const ids = parseServiceIds(companion.service_ids);
  const byId = new Map((catalog || []).map((s) => [String(s.id), s]));
  const byName = new Map((catalog || []).map((s) => [String(s.name || s.title || "").trim(), s]));

  if (ids.length) {
    return ids.map((id, idx) => {
      const svc = byId.get(String(id));
      const uuidName = /^[0-9a-f-]{36}$/i.test(String(id));
      const pricedName = Object.keys(prices).find(
        (k) => k !== id && !/^[0-9a-f-]{36}$/i.test(k) && money(prices[k]) === money(prices[id] || 0) && money(prices[k]) > 0
      );
      const name =
        svc?.name ||
        svc?.title ||
        pricedName ||
        (!uuidName ? String(id) : "") ||
        splitGames(companion.game || companion.main_service)[idx] ||
        Object.keys(prices).find((k) => !/^[0-9a-f-]{36}$/i.test(k) && prices[k] > 0) ||
        "游戏";
      return {
        id: String(id),
        serviceId: String(id),
        name,
        price: priceForGame(companion, name, id),
        pricingUnit: unit,
        sort: idx,
      };
    }).filter((service) => money(service.price) > 0);
  }

  const games = splitGames(companion.game || companion.main_service);
  const list = (games.length ? games : Object.keys(prices).filter((k) => !/^[0-9a-f-]{36}$/i.test(k))).filter(
    (g) => prices[g] > 0
  );
  if (!list.length) return [];
  return list.map((g, idx) => {
    const svc = byName.get(g);
    const serviceId = svc?.id ? String(svc.id) : "";
    return {
      id: serviceId || `game:${encodeURIComponent(g)}`,
      serviceId,
      name: g,
      price: priceForGame(companion, g, serviceId),
      pricingUnit: unit,
      sort: idx,
    };
  }).filter((service) => money(service.price) > 0);
}
