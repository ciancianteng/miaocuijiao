/**
 * Pure quoting rules for platform services and companion offers.
 * No database access. Orders keep their own unit_price snapshot.
 */
const UNITS = new Set(["局", "小时", "场", "次"]);

function clip(value, max) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clipBlock(value, max) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function parseMoneyStrict(value) {
  if (value === "" || value == null) return { empty: true, value: null };
  const text = String(value).trim();
  if (!text) return { empty: true, value: null };
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    return { empty: false, value: null, error: "不允许输入负数或非法字符。" };
  }
  const n = Math.round(Number(text) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) {
    return { empty: false, value: null, error: "不允许输入负数或非法字符。" };
  }
  return { empty: false, value: n };
}

export function normalizePricePolicy(raw = {}) {
  const minParsed = parseMoneyStrict(raw.min ?? raw.priceMin);
  const maxParsed = parseMoneyStrict(raw.max ?? raw.priceMax);
  const unitText = String(raw.unit || "").trim();
  return {
    min: minParsed.error ? null : minParsed.value,
    max: maxParsed.error ? null : maxParsed.value,
    unit: UNITS.has(unitText) ? unitText : "局",
    allowSelfPrice: raw.allowSelfPrice === true || raw.allowSelfPrice === "true" || raw.allowCompanionPrice === true,
    allowSelfOff: raw.allowSelfOff === true || raw.allowSelfOff === "true" || raw.allowCompanionOff === true,
    gameName: clip(raw.gameName ?? raw.game_name, 40),
    platform: clip(raw.platform ?? raw.serverName ?? raw.server_name, 60),
    description: clipBlock(raw.description ?? raw.intro ?? raw.content, 500),
    requirements: clipBlock(raw.requirements ?? raw.requirement ?? raw.serviceRequirements, 800),
  };
}

export const MIN_LEVEL_MARKUP = 1;
export const DEFAULT_LEVEL_MARKUP_CAPS = { 1: 5, 2: 8, 3: 10, 4: 13, 5: 15 };

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Real companion level is LV1–LV5. A higher stored level uses the LV5 cap. */
export function levelIndexFrom(level) {
  if (level == null || level === "") return null;
  if (typeof level === "number" || (typeof level === "string" && /^\d+$/.test(String(level).trim()))) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 1) return null;
    return Math.min(5, n);
  }
  if (typeof level !== "object") return null;
  if (level.levelIndex != null && level.levelIndex !== level) {
    const nested = levelIndexFrom(level.levelIndex);
    if (nested) return nested;
  }
  if (level.index != null && level.index !== level) {
    const nested = levelIndexFrom(level.index);
    if (nested) return nested;
  }
  const numeric = Number(level.level);
  if (Number.isInteger(numeric) && numeric >= 1) return Math.min(5, numeric);
  const text = [level.code, level.name, level.level_name, level.levelName, level.label].filter(Boolean).join(" ");
  const tagged = text.match(/lv\s*\.?\s*([1-9]\d*)\b/i);
  if (!tagged) return null;
  const n = Number(tagged[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(5, n);
}

export function normalizeLevelMarkupCaps(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const caps = {};
  for (const lv of [1, 2, 3, 4, 5]) {
    const parsed = parseMoneyStrict(source[lv] ?? source[String(lv)] ?? DEFAULT_LEVEL_MARKUP_CAPS[lv]);
    caps[lv] =
      parsed.error || parsed.empty || !(parsed.value >= MIN_LEVEL_MARKUP)
        ? DEFAULT_LEVEL_MARKUP_CAPS[lv]
        : parsed.value;
  }
  return caps;
}

export function assertLevelMarkupCaps(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const caps = {};
  for (const lv of [1, 2, 3, 4, 5]) {
    const parsed = parseMoneyStrict(source[lv] ?? source[String(lv)]);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
    if (parsed.empty || !(parsed.value >= MIN_LEVEL_MARKUP)) {
      throw Object.assign(new Error(`LV${lv} 加价上限必须大于或等于 RM ${MIN_LEVEL_MARKUP}。`), { status: 400 });
    }
    caps[lv] = parsed.value;
  }
  return caps;
}

export function assertPricePolicy(policy, raw = {}, capsInput) {
  const minParsed = parseMoneyStrict(raw.min ?? raw.priceMin);
  const maxParsed = parseMoneyStrict(raw.max ?? raw.priceMax);
  const priceRaw = raw.defaultPrice ?? raw.default_price;
  let standardValue = null;
  if (priceRaw != null && String(priceRaw).trim() !== "") {
    const standard = parseMoneyStrict(priceRaw);
    if (standard.error || !(standard.value > 0)) {
      throw Object.assign(new Error(standard.error || "平台标准价格必须大于 0。"), { status: 400 });
    }
    standardValue = standard.value;
  }
  if (minParsed.error || maxParsed.error) {
    throw Object.assign(new Error(minParsed.error || maxParsed.error), { status: 400 });
  }
  if (policy.min != null && policy.max != null && Number(policy.max) < Number(policy.min)) {
    throw Object.assign(new Error("最高价格不能低于最低价格。"), { status: 400 });
  }
  if (policy.allowSelfPrice && (policy.min == null || policy.max == null)) {
    throw Object.assign(new Error("允许自定义单价时必须同时设置最低和最高价格。"), { status: 400 });
  }
  if (policy.allowSelfPrice && !(Number(policy.max) > 0)) {
    throw Object.assign(new Error("最高价格必须大于 0。"), { status: 400 });
  }
  if (policy.allowSelfPrice && standardValue > 0 && policy.min != null && policy.max != null) {
    const caps = normalizeLevelMarkupCaps(capsInput || DEFAULT_LEVEL_MARKUP_CAPS);
    const highest = Math.max(...[1, 2, 3, 4, 5].map((lv) => Number(caps[lv])));
    const floor = roundMoney(standardValue + MIN_LEVEL_MARKUP);
    const ceil = roundMoney(standardValue + highest);
    const lo = Math.max(Number(policy.min), floor);
    const hi = Math.min(Number(policy.max), ceil);
    if (!(hi >= lo)) {
      throw Object.assign(
        new Error(
          `自定义价格范围与等级加价没有交集。标准价 RM ${standardValue}，等级加价后为 RM ${floor}–${ceil}，后台范围是 RM ${policy.min}–${policy.max}。`
        ),
        { status: 400 }
      );
    }
  }
}

function standardPriceOf(service = {}) {
  const parsed = parseMoneyStrict(service.default_price ?? service.defaultPrice ?? service.platformPrice);
  if (parsed.error || parsed.empty || !(parsed.value > 0)) return null;
  return parsed.value;
}

const PLACE_PLATFORM = /手游|端游|PC|主机|steam/i;
const PLACE_SERVER = /国服|亚服|欧服|美服|国际服|日服|韩服|台服|v区/i;

/** Platform / 区服 line. Admin fields win; otherwise read tokens already in the service name. */
export function offerPlaceLabel(service = {}, policy = {}) {
  const pol = normalizePricePolicy(policy || {});
  if (pol.gameName || pol.platform) return [pol.gameName, pol.platform].filter(Boolean).join(" · ");
  const name = String(service.name || service.title || "");
  const category = String(service.category || "");
  const platform = (name.match(PLACE_PLATFORM) || [])[0] || (PLACE_PLATFORM.test(category) ? category : "");
  const server = (name.match(PLACE_SERVER) || [])[0] || "";
  return [platform, server].filter(Boolean).join(" / ");
}

/** Existing game_prices value, only when custom pricing is allowed and the number is inside the admin range. */
export function acceptedLegacyPrice(raw, policy = {}) {
  const parsed = parseMoneyStrict(raw);
  if (parsed.empty || parsed.error || !(parsed.value > 0)) return null;
  const pol = normalizePricePolicy(policy || {});
  if (!pol.allowSelfPrice || pol.min == null || pol.max == null) return null;
  if (parsed.value < Number(pol.min) || parsed.value > Number(pol.max)) return null;
  return parsed.value;
}

function rangeReady(policy) {
  return !!(
    policy &&
    policy.allowSelfPrice &&
    policy.min != null &&
    policy.max != null &&
    Number(policy.max) >= Number(policy.min) &&
    Number(policy.max) > 0 &&
    Number(policy.min) >= 0
  );
}

function unifiedBounds({ standard, policy, levelIndex, caps }) {
  const levelCap = Number(caps[levelIndex]);
  const floor = roundMoney(standard + MIN_LEVEL_MARKUP);
  const ceil = roundMoney(standard + levelCap);
  let min = floor;
  let max = ceil;
  if (policy.min != null) min = Math.max(min, Number(policy.min));
  if (policy.max != null) max = Math.min(max, Number(policy.max));
  min = roundMoney(min);
  max = roundMoney(max);
  return {
    min,
    max,
    markupMin: roundMoney(min - standard),
    markupMax: roundMoney(max - standard),
    levelCap,
    conflict: !(max >= min),
  };
}

export function quoteServiceOffer({ service = {}, policy = {}, saved = null, level = null, markupCaps = null } = {}) {
  const pol = normalizePricePolicy(policy || {});
  const standard = standardPriceOf(service);
  const standardReady = standard != null;
  const customRange = rangeReady(pol);
  const caps = normalizeLevelMarkupCaps(markupCaps);
  const levelIndex = levelIndexFrom(level);
  const enabled = service.enabled !== false && service.allow_order !== false && service.allowOrder !== false;
  const persisted = !!(saved && saved.id);
  const accepting = persisted && saved.accepting !== false && saved.enabled !== false;
  const savedParsed = persisted ? parseMoneyStrict(saved.price) : { empty: true, value: null };
  const savedPrice = savedParsed.error || savedParsed.empty || !(savedParsed.value > 0) ? null : savedParsed.value;
  const bounds =
    standardReady && customRange && levelIndex ? unifiedBounds({ standard, policy: pol, levelIndex, caps }) : null;

  let effective = null;
  let priceStatus = "ready";
  let priceMessage = "";
  let canEditPrice = false;
  let markupClamped = false;
  let savedMarkup = null;
  let effectiveMarkup = null;

  if (!standardReady || (pol.allowSelfPrice && !customRange)) {
    priceStatus = "missing";
    priceMessage = "平台尚未配置价格";
  } else if (!pol.allowSelfPrice) {
    effective = standard;
    priceMessage = "此项目由平台统一定价。";
  } else if (!levelIndex || !bounds) {
    priceStatus = "level_missing";
    priceMessage = "无法确认陪玩等级，暂时不能自定义加价。";
  } else if (bounds.conflict) {
    priceStatus = "conflict";
    priceMessage = "等级加价与后台价格范围没有交集，请联系管理员调整。";
  } else {
    canEditPrice = true;
    if (savedPrice == null) {
      priceStatus = "unset";
      priceMessage = "请先设置加价";
    } else {
      savedMarkup = roundMoney(savedPrice - standard);
      if (savedPrice < bounds.min) {
        priceStatus = "out_of_range";
        priceMessage = `加价必须在 RM ${bounds.markupMin}–${bounds.markupMax} 之间。`;
      } else if (savedPrice > bounds.max) {
        effective = bounds.max;
        effectiveMarkup = bounds.markupMax;
        markupClamped = true;
        priceMessage = `加价已按当前等级上限调整为 RM ${bounds.markupMax}。`;
      } else {
        effective = savedPrice;
        effectiveMarkup = savedMarkup;
      }
    }
  }

  const orderable = !!(enabled && accepting && effective != null && effective > 0 && (priceStatus === "ready" || markupClamped));
  return {
    id: service.id,
    name: service.name || "服务",
    category: service.category || "",
    icon: service.icon || "🎮",
    gameName: pol.gameName,
    platform: pol.platform,
    description: pol.description,
    unit: pol.unit,
    standardPrice: standard,
    min: customRange ? pol.min : null,
    max: customRange ? pol.max : null,
    allowedMin: bounds && !bounds.conflict ? bounds.min : null,
    allowedMax: bounds && !bounds.conflict ? bounds.max : null,
    levelIndex: levelIndex || null,
    levelLabel: levelIndex ? `LV${levelIndex}` : "",
    levelCap: bounds ? bounds.levelCap : levelIndex ? caps[levelIndex] : null,
    markupMin: bounds && !bounds.conflict ? bounds.markupMin : null,
    markupMax: bounds && !bounds.conflict ? bounds.markupMax : null,
    allowSelfPrice: canEditPrice,
    allowSelfOff: true,
    canEditPrice,
    accepting,
    persisted,
    effectivePrice: effective,
    savedPrice,
    savedMarkup,
    effectiveMarkup,
    markupClamped,
    orderable,
    priceStatus,
    priceMessage,
    enabled: service.enabled !== false,
  };
}

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function legalFinal(bounds, price) {
  return price > 0 && price >= bounds.min && price <= bounds.max;
}

export function validateCompanionOfferSave({
  service = {},
  policy = {},
  previous = null,
  next = {},
  level = null,
  markupCaps = null,
} = {}) {
  const pol = normalizePricePolicy(policy || {});
  const standard = standardPriceOf(service);
  const customRange = rangeReady(pol);
  const caps = normalizeLevelMarkupCaps(markupCaps);
  const levelIndex = levelIndexFrom(level);
  const accepting = next.accepting !== false && next.accepting !== "false" && next.enabled !== false && next.enabled !== "false";
  const prevPriceParsed = previous ? parseMoneyStrict(previous.price) : { empty: true, value: null };
  const prevPrice = prevPriceParsed.error || prevPriceParsed.empty ? null : prevPriceParsed.value;
  const markupProvided = next.markup != null && String(next.markup).trim() !== "";
  const bounds =
    pol.allowSelfPrice && customRange && standard != null && levelIndex
      ? unifiedBounds({ standard, policy: pol, levelIndex, caps })
      : null;

  let submitted = { empty: true, value: null };
  if (markupProvided) {
    const markup = parseMoneyStrict(next.markup);
    if (markup.error) fail(markup.error);
    if (!pol.allowSelfPrice) fail("此项目由平台统一定价。");
    if (!customRange || standard == null) fail("平台尚未配置价格");
    if (!levelIndex || !bounds) fail("无法确认陪玩等级，暂时不能自定义加价。");
    if (bounds.conflict) fail("等级加价与后台价格范围没有交集，请联系管理员调整。");
    if (!(markup.value >= bounds.markupMin) || markup.value > bounds.markupMax) {
      fail(`加价必须在 RM ${bounds.markupMin}–${bounds.markupMax} 之间。`);
    }
    submitted = { empty: false, value: roundMoney(standard + markup.value) };
  } else {
    const parsed = parseMoneyStrict(next.price);
    if (parsed.error) fail(parsed.error);
    submitted = parsed;
  }

  let storedPrice = null;
  if (!pol.allowSelfPrice) {
    if (submitted.value != null && standard != null && Math.abs(submitted.value - standard) > 0.001) {
      fail("此项目由平台统一定价。");
    }
    if (submitted.value != null && standard == null) fail("此项目由平台统一定价。");
    storedPrice = null;
  } else if (!customRange || standard == null) {
    if (!submitted.empty || accepting) fail("平台尚未配置价格");
    storedPrice = prevPrice;
  } else if (!levelIndex || !bounds) {
    if (!submitted.empty || accepting) fail("无法确认陪玩等级，暂时不能自定义加价。");
    storedPrice = prevPrice;
  } else if (bounds.conflict) {
    if (!submitted.empty || accepting) fail("等级加价与后台价格范围没有交集，请联系管理员调整。");
    storedPrice = prevPrice;
  } else if (submitted.empty) {
    storedPrice = prevPrice != null && prevPrice > bounds.max ? bounds.max : prevPrice;
  } else if (!legalFinal(bounds, submitted.value)) {
    fail(`加价必须在 RM ${bounds.markupMin}–${bounds.markupMax} 之间。`);
  } else {
    storedPrice = submitted.value;
  }

  if (accepting) {
    if (standard == null || (pol.allowSelfPrice && !customRange)) fail("平台尚未配置价格");
    if (pol.allowSelfPrice) {
      if (!bounds || bounds.conflict) fail("请先设置有效单价后再开启接单。");
      if (!legalFinal(bounds, storedPrice)) fail("请先设置有效单价后再开启接单。");
    }
  }

  return { price: storedPrice, accepting, levelIndex: levelIndex || null };
}

export function mergeOfferLists(previous, incoming, allowed) {
  const keys = new Set((incoming || []).map((item) => `${item.kind}:${item.id}`));
  const kept = (previous || []).filter((item) => {
    const key = `${item.kind}:${item.id}`;
    return !keys.has(key) && allowed && allowed.has(key);
  });
  return (incoming || []).concat(kept).slice(0, 40);
}
