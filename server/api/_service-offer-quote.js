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
  };
}

export function assertPricePolicy(policy, raw = {}) {
  const minParsed = parseMoneyStrict(raw.min ?? raw.priceMin);
  const maxParsed = parseMoneyStrict(raw.max ?? raw.priceMax);
  const priceRaw = raw.defaultPrice ?? raw.default_price;
  if (priceRaw != null && String(priceRaw).trim() !== "") {
    const standard = parseMoneyStrict(priceRaw);
    if (standard.error || !(standard.value > 0)) {
      throw Object.assign(new Error(standard.error || "平台标准价格必须大于 0。"), { status: 400 });
    }
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

export function quoteServiceOffer({ service = {}, policy = {}, saved = null } = {}) {
  const pol = normalizePricePolicy(policy || {});
  const standard = standardPriceOf(service);
  const standardReady = standard != null;
  const customRange = rangeReady(pol);
  const enabled = service.enabled !== false && service.allow_order !== false && service.allowOrder !== false;
  const persisted = !!(saved && saved.id);
  const accepting = persisted && saved.accepting !== false && saved.enabled !== false;
  const savedParsed = persisted ? parseMoneyStrict(saved.price) : { empty: true, value: null };
  const savedPrice = savedParsed.error || savedParsed.empty || !(savedParsed.value > 0) ? null : savedParsed.value;

  let effective = null;
  let priceStatus = "ready";
  let priceMessage = "";
  let canEditPrice = false;

  if (!standardReady || (pol.allowSelfPrice && !customRange)) {
    priceStatus = "missing";
    priceMessage = "平台尚未配置价格";
  } else if (!pol.allowSelfPrice) {
    effective = standard;
    priceMessage = "此项目由平台统一定价。";
  } else {
    canEditPrice = true;
    if (savedPrice == null) {
      priceStatus = "unset";
      priceMessage = "请先设置单价";
    } else if (savedPrice < Number(pol.min) || savedPrice > Number(pol.max)) {
      priceStatus = "out_of_range";
      priceMessage = `价格必须在 RM ${pol.min}–${pol.max} / ${pol.unit} 之间。`;
    } else {
      effective = savedPrice;
    }
  }

  const orderable = !!(enabled && accepting && effective != null && effective > 0 && priceStatus === "ready");
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
    allowSelfPrice: canEditPrice,
    allowSelfOff: true,
    canEditPrice,
    accepting,
    persisted,
    effectivePrice: effective,
    savedPrice,
    orderable,
    priceStatus,
    priceMessage,
    enabled: service.enabled !== false,
  };
}

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

export function validateCompanionOfferSave({ service = {}, policy = {}, previous = null, next = {} } = {}) {
  const parsed = parseMoneyStrict(next.price);
  if (parsed.error) fail(parsed.error);
  const pol = normalizePricePolicy(policy || {});
  const standard = standardPriceOf(service);
  const customRange = rangeReady(pol);
  const accepting = next.accepting !== false && next.accepting !== "false" && next.enabled !== false && next.enabled !== "false";
  const prevPriceParsed = previous ? parseMoneyStrict(previous.price) : { empty: true, value: null };
  const prevPrice = prevPriceParsed.error || prevPriceParsed.empty ? null : prevPriceParsed.value;

  let storedPrice = null;
  if (!pol.allowSelfPrice) {
    if (parsed.value != null && standard != null && Math.abs(parsed.value - standard) > 0.001) {
      fail("此项目由平台统一定价。");
    }
    if (parsed.value != null && standard == null) fail("此项目由平台统一定价。");
    storedPrice = null;
  } else if (!customRange || standard == null) {
    if (parsed.value != null || accepting) fail("平台尚未配置价格");
    storedPrice = prevPrice;
  } else if (parsed.empty) {
    storedPrice = prevPrice;
  } else if (!(parsed.value > 0) || parsed.value < Number(pol.min) || parsed.value > Number(pol.max)) {
    fail(`价格必须在 RM ${pol.min}–${pol.max} / ${pol.unit} 之间。`);
  } else {
    storedPrice = parsed.value;
  }

  if (accepting) {
    if (standard == null || (pol.allowSelfPrice && !customRange)) fail("平台尚未配置价格");
    if (pol.allowSelfPrice) {
      const price = storedPrice;
      if (!(price > 0) || price < Number(pol.min) || price > Number(pol.max)) {
        fail("请先设置有效单价后再开启接单。");
      }
    }
  }

  return { price: storedPrice, accepting };
}

export function mergeOfferLists(previous, incoming, allowed) {
  const keys = new Set((incoming || []).map((item) => `${item.kind}:${item.id}`));
  const kept = (previous || []).filter((item) => {
    const key = `${item.kind}:${item.id}`;
    return !keys.has(key) && allowed && allowed.has(key);
  });
  return (incoming || []).concat(kept).slice(0, 40);
}
