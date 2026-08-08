import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "gameplay-products.json");

export const CATEGORIES = ["护航", "跑刀", "上分", "代练", "陪练", "语音", "娱乐", "其他"];
export const PRICING_UNITS = ["每局", "每小时", "每单", "每次", "每天", "自定义"];

const BRAND_COVER = "/gameplay-cover-placeholder.jpg";

export const DEFAULT_PRODUCTS = [
  {
    id: "gp-delta-loot",
    name: "三角洲跑刀",
    category: "跑刀",
    gamesText: "三角洲行动",
    gameIds: ["三角洲行动"],
    coverUrl: BRAND_COVER,
    shortDescription: "专业跑刀带路，熟悉地图与物资点",
    description: "服务内容：专业跑刀带队，熟悉物资点与撤离路线。\n服务流程：确认区服与时间 → 客服派单 → 陪玩联系 → 开局服务。\n注意事项：请提前准备好游戏账号与语音。",
    rules: "1. 请提前准备好游戏账号与语音。\n2. 下单后由客服安排陪玩，请保持联系畅通。\n3. 如需改期请至少提前 1 小时联系客服。",
    price: 30,
    pricingUnit: "每局",
    fixedPrice: true,
    showServer: true,
    packages: [
      { id: "std", name: "标准局", price: 30, unit: "每局" },
      { id: "safe", name: "稳撤离", price: 45, unit: "每局" },
      { id: "duo", name: "双排跑刀", price: 55, unit: "每局" },
    ],
    status: "published",
    featured: true,
    soldCount: 128,
    sortOrder: 10,
    dispatchToCs: true,
  },
  {
    id: "gp-apex-boost",
    name: "APEX 上分护航",
    category: "护航",
    gamesText: "Apex Legends",
    gameIds: ["Apex Legends"],
    coverUrl: BRAND_COVER,
    shortDescription: "段位上分护航，稳局沟通",
    description: "服务内容：APEX 上分护航，根据当前段位匹配节奏。\n服务流程：确认段位与目标 → 客服派单 → 开黑上分。\n注意事项：请保持语音畅通。",
    rules: "1. 请如实填写当前段位与目标段位。\n2. 服务期间请保持游戏在线与语音畅通。\n3. 禁止辱骂队友或其他违规行为。",
    price: 50,
    pricingUnit: "每小时",
    fixedPrice: true,
    showServer: true,
    packages: [
      { id: "1h", name: "1 小时护航", price: 50, unit: "每小时" },
      { id: "3h", name: "3 小时护航", price: 140, unit: "每套" },
      { id: "night", name: "深夜档 2 小时", price: 110, unit: "每套" },
    ],
    status: "published",
    featured: true,
    soldCount: 86,
    sortOrder: 20,
    dispatchToCs: true,
  },
  {
    id: "gp-lol-coach",
    name: "LOL 陪练",
    category: "陪练",
    gamesText: "英雄联盟",
    gameIds: ["英雄联盟"],
    coverUrl: BRAND_COVER,
    shortDescription: "位置陪练，复盘思路与对线",
    description: "服务内容：指定位置陪练，讲解对线与团战思路。\n服务流程：确认位置与目标 → 客服派单 → 开局陪练。\n注意事项：请提前说明当前水平。",
    rules: "1. 请填写正确的游戏 ID 与大区。\n2. 陪练以教学沟通为主，请保持礼貌。\n3. 如需指定位置请在备注说明。",
    price: 40,
    pricingUnit: "每小时",
    fixedPrice: true,
    showServer: true,
    packages: [
      { id: "1h", name: "1 小时陪练", price: 40, unit: "每小时" },
      { id: "2h", name: "2 小时陪练", price: 75, unit: "每套" },
    ],
    status: "published",
    featured: false,
    soldCount: 64,
    sortOrder: 30,
    dispatchToCs: true,
  },
  {
    id: "gp-voice-chat",
    name: "语音陪聊",
    category: "语音",
    gamesText: "无特定游戏",
    gameIds: ["无特定游戏"],
    coverUrl: BRAND_COVER,
    shortDescription: "轻松语音陪伴，聊天解压",
    description: "服务内容：语音陪聊，轻松陪伴。\n服务流程：确认时长偏好 → 客服派单 → 开始通话。\n注意事项：请保持礼貌沟通。",
    rules: "1. 请保持礼貌沟通，禁止骚扰与违规内容。\n2. 到时由客服安排陪玩联系。\n3. 无需填写区服时可留空。",
    price: 25,
    pricingUnit: "每小时",
    fixedPrice: true,
    showServer: false,
    packages: [
      { id: "1h", name: "1 小时陪聊", price: 25, unit: "每小时" },
      { id: "2h", name: "2 小时陪聊", price: 45, unit: "每套" },
    ],
    status: "published",
    featured: false,
    soldCount: 210,
    sortOrder: 40,
    dispatchToCs: true,
  },
];

async function ensureDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function truthy(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "是", "开启", "上架", "推荐", "published"].includes(text)) return true;
  if (["0", "false", "no", "off", "否", "关闭", "下架", "不推荐", "draft", "unpublished", "deleted"].includes(text)) return false;
  return fallback;
}

function normalizePackages(row = {}, price = 0, unit = "每单") {
  const raw = row.packages || row.packageOptions || row.package_options || row.skus || row.specs;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  list = list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const pkgPrice = Math.max(0, Number(item.price ?? item.amount ?? price) || 0);
      const name = String(item.name || item.title || item.label || `套餐${index + 1}`).trim();
      if (!name) return null;
      return {
        id: String(item.id || item.code || `pkg-${index + 1}`),
        name,
        price: pkgPrice,
        unit: String(item.unit || item.pricingUnit || unit || "每单").trim() || "每单",
      };
    })
    .filter(Boolean);
  if (!list.length && price > 0) {
    list = [{ id: "default", name: "标准套餐", price, unit: unit || "每单" }];
  }
  return list;
}

function sanitizeCover(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  if (/default-avatar|dummy|sample.?avatar|test.?avatar/i.test(text)) return "";
  if (/meow-cuijiao-brand/i.test(text)) return BRAND_COVER;
  if (/placeholder/i.test(text) && !/gameplay-cover-placeholder/i.test(text)) return "";
  return text;
}

/** Reject preview / demo / mock / acceptance junk from public mall */
export function isJunkGameplayProduct(item = {}) {
  const blob = [
    item.id,
    item.name,
    item.title,
    item.shortDescription,
    item.description,
    item.coverUrl,
    item.gamesText,
  ]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  return /\[?\s*test\s*\]?|\bp0[-\s]?\d+\b|preview|demo|mock|验收|测试玩法|测试商品|测试价|验收商品|p03-test|default-avatar/i.test(
    blob
  );
}

export function normalizeProductRow(row = {}, index = 0) {
  const gameIds = Array.isArray(row.gameIds)
    ? row.gameIds.map((x) => String(x || "").trim()).filter(Boolean)
    : Array.isArray(row.game_ids)
      ? row.game_ids.map((x) => String(x || "").trim()).filter(Boolean)
      : String(row.gamesText || row.games_text || row.game || "")
          .split(/[,，、|/]/)
          .map((x) => x.trim())
          .filter(Boolean);
  const statusRaw = String(row.status || (truthy(row.enabled, true) ? "published" : "unpublished")).toLowerCase();
  let status = "published";
  if (["draft", "草稿"].includes(statusRaw) || row.draft === true) status = "draft";
  else if (["unpublished", "disabled", "offline", "下架", "停用"].includes(statusRaw) || row.enabled === false) status = "unpublished";
  else if (["deleted", "删除"].includes(statusRaw) || row.deleted_at || row.deletedAt) status = "deleted";
  else if (["published", "上架", "启用"].includes(statusRaw)) status = "published";

  const price = Math.max(0, Number(row.price ?? row.fixed_price_amount ?? 0) || 0);
  const unit = String(row.pricingUnit || row.pricing_unit || "每单").trim() || "每单";
  const packages = normalizePackages(row, price, unit);
  const basePrice = packages[0] ? packages[0].price : price;
  return {
    id: String(row.id || randomUUID()),
    name: String(row.name || "").trim(),
    category: CATEGORIES.includes(String(row.category || "").trim()) ? String(row.category).trim() : "其他",
    gameIds: gameIds.length ? gameIds : ["无特定游戏"],
    gamesText: String(row.gamesText || row.games_text || gameIds.join("、") || "无特定游戏").trim(),
    coverUrl: sanitizeCover(row.coverUrl || row.cover_url || row.cover || ""),
    shortDescription: String(row.shortDescription || row.short_description || row.intro || "").trim().slice(0, 80),
    description: String(row.description || row.detail || row.body || "").trim(),
    rules: String(row.rules || row.serviceRules || row.service_rules || "").trim(),
    price: basePrice,
    pricingUnit: PRICING_UNITS.includes(unit) ? unit : unit || "自定义",
    fixedPrice: truthy(row.fixedPrice ?? row.fixed_price, true),
    showServer: truthy(row.showServer ?? row.show_server ?? row.requireServer, true),
    packages,
    status,
    featured: truthy(row.featured ?? row.is_featured ?? row.recommend, false),
    soldCount: Math.max(0, Number(row.soldCount ?? row.sold_count ?? 0) || 0),
    sortOrder: Number.isFinite(Number(row.sortOrder ?? row.sort_order ?? row.sort))
      ? Number(row.sortOrder ?? row.sort_order ?? row.sort)
      : (index + 1) * 10,
    dispatchToCs: truthy(row.dispatchToCs ?? row.dispatch_to_cs, true),
    commissionRate: Math.min(
      100,
      Math.max(0, Number(row.commissionRate ?? row.commission_rate ?? row.platform_commission_rate ?? 0) || 0)
    ),
    deletedAt: row.deletedAt || row.deleted_at || (status === "deleted" ? new Date().toISOString() : null),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString(),
  };
}

export function toPublicProduct(row, { admin = false } = {}) {
  const item = normalizeProductRow(row);
  const base = {
    id: item.id,
    name: item.name,
    category: item.category,
    gameIds: item.gameIds,
    gamesText: item.gamesText,
    coverUrl: item.coverUrl,
    shortDescription: item.shortDescription,
    description: item.description,
    rules: item.rules,
    price: item.price,
    pricingUnit: item.pricingUnit,
    fixedPrice: item.fixedPrice,
    showServer: item.showServer,
    packages: item.packages,
    status: item.status,
    featured: item.featured,
    soldCount: item.soldCount,
    sortOrder: item.sortOrder,
    dispatchToCs: item.dispatchToCs,
    commissionRate: item.commissionRate,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (admin) base.deletedAt = item.deletedAt;
  return base;
}

export function toDbRow(row) {
  const item = normalizeProductRow(row);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    game_ids: item.gameIds,
    games_text: item.gamesText,
    cover_url: item.coverUrl,
    short_description: item.shortDescription,
    description: item.description,
    price: item.price,
    pricing_unit: item.pricingUnit,
    fixed_price: item.fixedPrice,
    status: item.status,
    featured: item.featured,
    sold_count: item.soldCount,
    sort_order: item.sortOrder,
    dispatch_to_cs: item.dispatchToCs,
    commission_rate: item.commissionRate,
    deleted_at: item.deletedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export function fromDbRow(row) {
  return normalizeProductRow({
    id: row.id,
    name: row.name,
    category: row.category,
    gameIds: row.game_ids,
    gamesText: row.games_text,
    coverUrl: row.cover_url,
    shortDescription: row.short_description,
    description: row.description,
    rules: row.rules || row.service_rules,
    price: row.price,
    pricingUnit: row.pricing_unit,
    fixedPrice: row.fixed_price,
    showServer: row.show_server,
    packages: row.packages || row.package_options,
    status: row.status,
    featured: row.featured,
    soldCount: row.sold_count,
    sortOrder: row.sort_order,
    dispatchToCs: row.dispatch_to_cs,
    commissionRate: row.commission_rate,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function readLocalProducts() {
  try {
    await ensureDir();
  } catch {
    return DEFAULT_PRODUCTS.map((row, index) => normalizeProductRow(row, index));
  }
  try {
    const text = await fsp.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : []).map((row, index) => normalizeProductRow(row, index));
    if (list.length) return list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      return DEFAULT_PRODUCTS.map((row, index) => normalizeProductRow(row, index));
    }
  }
  const seeded = DEFAULT_PRODUCTS.map((row, index) => normalizeProductRow(row, index));
  try {
    await writeLocalProducts(seeded);
  } catch {
    /* read-only serverless FS */
  }
  return seeded;
}

export async function writeLocalProducts(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeProductRow(row, index))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw Object.assign(
      new Error("玩法商品必须写入数据库。请确认 gameplay_products 表已迁移后再保存。"),
      { status: 503 }
    );
  }
  await ensureDir();
  await fsp.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function updateLocalProducts(mutator) {
  const list = await readLocalProducts();
  const result = await mutator(list);
  await writeLocalProducts(list);
  return result;
}
