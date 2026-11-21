/**
 * Price-table display helpers: category tabs + game family grouping.
 * Does not change order price math.
 */

export const PRICE_TABLE_DEFAULT_CATEGORIES = [
  { name: "端游", sort: 1, enabled: true },
  { name: "手游", sort: 2, enabled: true },
  { name: "娱乐陪伴", sort: 3, enabled: true },
];

/** Legacy service.category → price-table tab name */
const LEGACY_CATEGORY_ALIAS = {
  端游: "端游",
  手游: "手游",
  娱乐陪伴: "娱乐陪伴",
  娱乐: "娱乐陪伴",
  语音: "娱乐陪伴",
  定制: "娱乐陪伴",
  其他: "娱乐陪伴",
  射击: "端游",
  三角洲行动: "端游",
};

const FAMILY_RULES = [
  [/^三角洲/, "三角洲行动"],
  [/^无畏契约/, "无畏契约"],
  [/^英雄联盟/, "英雄联盟"],
  [/^永劫无间/, "永劫无间"],
  [/^王者荣耀/, "王者荣耀"],
  [/^和平精英/, "和平精英"],
  [/^金铲铲/, "金铲铲"],
  [/^云顶之弈/, "云顶之弈"],
  [/^鹅鸭杀/, "鹅鸭杀"],
  [/^洛克王国/, "洛克王国"],
  [/^原神/, "原神"],
  [/^HOK\b/i, "HOK"],
  [/^CSGO\b/i, "CSGO"],
  [/^APEX\b/i, "APEX"],
];

export function normalizeCategoryRow(row = {}, index = 0) {
  const name = String(row.name || "").trim();
  const sort = Number(row.sort_order ?? row.sort ?? index + 1);
  return {
    id: String(row.id || name || `cat-${index + 1}`),
    name,
    sort: Number.isFinite(sort) ? sort : index + 1,
    enabled: row.is_enabled !== false && row.enabled !== false,
  };
}

export function resolvePriceCategory(serviceCategory, serviceName, enabledNames) {
  const raw = String(serviceCategory || "").trim();
  const name = String(serviceName || "").trim();
  const enabled = Array.isArray(enabledNames) && enabledNames.length
    ? enabledNames
    : PRICE_TABLE_DEFAULT_CATEGORIES.map((c) => c.name);

  if (raw && enabled.includes(raw)) return raw;

  const aliased = LEGACY_CATEGORY_ALIAS[raw];
  if (aliased && enabled.includes(aliased)) return aliased;

  // Name cues beat a wrong/legacy category field.
  if (/手游/.test(name) && enabled.includes("手游")) return "手游";
  if (/端游/.test(name) && enabled.includes("端游")) return "端游";
  if (
    (/娱乐|陪伴|语音|陪聊|好友位|陪跑刀|原神/.test(name + " " + raw) ||
      /^(娱乐|语音|定制)$/.test(raw)) &&
    enabled.includes("娱乐陪伴")
  ) {
    return "娱乐陪伴";
  }
  if (
    /王者|和平精英|金铲铲|鹅鸭杀|洛克王国|HOK|英雄联盟\s*手游|无畏契约\s*手游|永劫无间\s*手游/.test(name) &&
    enabled.includes("手游")
  ) {
    return "手游";
  }
  if (enabled.includes("端游")) return "端游";
  return enabled[0] || raw || "端游";
}

export function inferGameFamily(serviceName) {
  const name = String(serviceName || "").trim();
  if (!name) return "未命名";
  for (const [re, title] of FAMILY_RULES) {
    if (re.test(name)) return title;
  }
  const stripped = name
    .replace(/\s*(端游|手游|国服|国际服|机密|绝密|常规|爆破|战场|模式|steam|vx\/qq区|vx|qq区).*$/i, "")
    .trim();
  if (stripped && stripped.length >= 2 && stripped.length < name.length) return stripped;
  return name;
}

export function groupGamesForPriceTable(games, enabledCategories) {
  const enabledNames = (enabledCategories || [])
    .filter((c) => c && c.enabled !== false)
    .map((c) => c.name);
  const map = new Map();
  for (const game of Array.isArray(games) ? games : []) {
    const priceCategory = resolvePriceCategory(game.category, game.name, enabledNames);
    const family = String(game.family || inferGameFamily(game.name));
    const key = `${priceCategory}::${family}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        id: key,
        title: family,
        category: priceCategory,
        icon: game.icon || "🎮",
        sort: Number(game.sort || 100) || 100,
        services: [],
      };
      map.set(key, bucket);
    }
    bucket.services.push(game);
    bucket.sort = Math.min(bucket.sort, Number(game.sort || 100) || 100);
    if (game.icon) bucket.icon = game.icon;
  }
  return Array.from(map.values())
    .map((g) => {
      g.services = g.services.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), "zh"));
      return g;
    })
    .sort((a, b) => a.sort - b.sort || String(a.title).localeCompare(String(b.title), "zh"));
}
