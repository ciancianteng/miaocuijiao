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

export function priceForGame(companion = {}, gameName = "", serviceId = "") {
  const prices = readGamePrices(companion);
  const id = String(serviceId || "").trim();
  if (id && prices[id] > 0) return prices[id];
  const name = String(gameName || "").trim();
  if (name && prices[name] > 0) return prices[name];
  // fuzzy match (LOL / 王者 etc.)
  const key = Object.keys(prices).find((k) => name && (name.includes(k) || k.includes(name)));
  if (key && prices[key] > 0) return prices[key];
  const games = splitGames(companion.game || companion.main_service);
  for (const g of games) {
    if (prices[g] > 0) return prices[g];
  }
  return money(companion.price);
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
      const name = svc?.name || svc?.title || Object.keys(prices).find((k) => k === id) || "游戏";
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
    return [
      {
        id: "default",
        serviceId: "",
        name: companion.game || companion.main_service || "陪玩服务",
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
