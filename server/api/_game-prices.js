/** Per-game companion hourly prices (RM). Stored in companion_profiles.game_prices or tags marker. */

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

export function priceForGame(companion = {}, gameName = "", serviceId = "") {
  const listing = money(companion.price);
  const prices = listing > 0 ? reconcileAdminServicePrices(companion, listing) : readGamePrices(companion);
  const id = String(serviceId || "").trim();
  if (id && prices[id] > 0) return prices[id];
  const name = String(gameName || "").trim();
  if (name && prices[name] > 0) return prices[name];
  // fuzzy match (LOL / 王者 etc.)
  const key = Object.keys(prices).find((k) => name && (name.includes(k) || k.includes(name)));
  if (key && prices[key] > 0) return prices[key];
  const games = serviceNames(companion);
  for (const g of games) {
    if (prices[g] > 0) return prices[g];
  }
  return listing;
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
    });
  }

  const games = splitGames(companion.game || companion.main_service);
  const list = (games.length ? games : Object.keys(prices).filter((k) => !/^[0-9a-f-]{36}$/i.test(k))).filter(
    (g) => prices[g] > 0 || money(companion.price) > 0
  );
  if (!list.length) {
    // Do NOT invent legacy defaults (陪玩/护航/代肝). Empty means companion has no configured games.
    const fallbackName = String(companion.game || companion.main_service || "").trim();
    if (!fallbackName || /^(陪玩|护航|跑刀|代肝|自定义|陪玩服务|陪聊服务)$/.test(fallbackName)) {
      return [];
    }
    return [
      {
        id: "default",
        serviceId: "",
        name: fallbackName,
        price: money(companion.price),
        pricingUnit: unit,
      },
    ];
  }
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
  });
}
