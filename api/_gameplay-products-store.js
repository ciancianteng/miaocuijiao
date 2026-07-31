import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "gameplay-products.json");

export const CATEGORIES = ["护航", "跑刀", "上分", "代练", "陪练", "语音", "娱乐", "其他"];
export const PRICING_UNITS = ["每局", "每小时", "每单", "每次", "每天", "自定义"];

export const DEFAULT_PRODUCTS = [
  {
    id: "gp-delta-loot",
    name: "三角洲跑刀",
    category: "跑刀",
    gamesText: "三角洲行动",
    gameIds: ["三角洲行动"],
    coverUrl: "",
    shortDescription: "专业跑刀带路，熟悉地图与物资点",
    description: "服务内容：专业跑刀带队，熟悉物资点与撤离路线。\n服务流程：确认区服与时间 → 客服派单 → 陪玩联系 → 开局服务。\n注意事项：请提前准备好游戏账号与语音。\n预计时长：按局计费。",
    price: 30,
    pricingUnit: "每局",
    fixedPrice: true,
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
    coverUrl: "",
    shortDescription: "段位上分护航，稳局沟通",
    description: "服务内容：APEX 上分护航，根据当前段位匹配节奏。\n服务流程：确认段位与目标 → 客服派单 → 开黑上分。\n注意事项：请保持语音畅通。\n预计时长：按小时计费。",
    price: 50,
    pricingUnit: "每小时",
    fixedPrice: true,
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
    coverUrl: "",
    shortDescription: "位置陪练，复盘思路与对线",
    description: "服务内容：指定位置陪练，讲解对线与团战思路。\n服务流程：确认位置与目标 → 客服派单 → 开局陪练。\n注意事项：请提前说明当前水平。\n预计时长：按小时计费。",
    price: 40,
    pricingUnit: "每小时",
    fixedPrice: true,
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
    coverUrl: "",
    shortDescription: "轻松语音陪伴，聊天解压",
    description: "服务内容：语音陪聊，轻松陪伴。\n服务流程：确认时长偏好 → 客服派单 → 开始通话。\n注意事项：请保持礼貌沟通。\n预计时长：按小时计费。",
    price: 25,
    pricingUnit: "每小时",
    fixedPrice: false,
    status: "published",
    featured: false,
    soldCount: 210,
    sortOrder: 40,
    dispatchToCs: true,
  },
];

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function truthy(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "是", "开启", "上架", "推荐", "published"].includes(text)) return true;
  if (["0", "false", "no", "off", "否", "关闭", "下架", "不推荐", "draft", "unpublished", "deleted"].includes(text)) return false;
  return fallback;
}

export function normalizeProductRow(row = {}, index = 0) {
  const gameIds = Array.isArray(row.gameIds)
    ? row.gameIds.map((x) => String(x || "").trim()).filter(Boolean)
    : Array.isArray(row.game_ids)
      ? row.game_ids.map((x) => String(x || "").trim()).filter(Boolean)
      : String(row.gamesText || row.games_text || row.games || "")
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
  return {
    id: String(row.id || randomUUID()),
    name: String(row.name || "").trim(),
    category: CATEGORIES.includes(String(row.category || "").trim()) ? String(row.category).trim() : "其他",
    gameIds: gameIds.length ? gameIds : ["无特定游戏"],
    gamesText: String(row.gamesText || row.games_text || gameIds.join("、") || "无特定游戏").trim(),
    coverUrl: String(row.coverUrl || row.cover_url || row.cover || "").trim(),
    shortDescription: String(row.shortDescription || row.short_description || row.intro || "").trim().slice(0, 40),
    description: String(row.description || row.detail || row.body || "").trim(),
    price,
    pricingUnit: PRICING_UNITS.includes(unit) ? unit : "自定义",
    fixedPrice: truthy(row.fixedPrice ?? row.fixed_price, true),
    status,
    featured: truthy(row.featured ?? row.is_featured ?? row.recommend, false),
    soldCount: Math.max(0, Number(row.soldCount ?? row.sold_count ?? 0) || 0),
    sortOrder: Number.isFinite(Number(row.sortOrder ?? row.sort_order ?? row.sort))
      ? Number(row.sortOrder ?? row.sort_order ?? row.sort)
      : (index + 1) * 10,
    dispatchToCs: truthy(row.dispatchToCs ?? row.dispatch_to_cs, true),
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
    price: item.price,
    pricingUnit: item.pricingUnit,
    fixedPrice: item.fixedPrice,
    status: item.status,
    featured: item.featured,
    soldCount: item.soldCount,
    sortOrder: item.sortOrder,
    dispatchToCs: item.dispatchToCs,
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
    price: row.price,
    pricingUnit: row.pricing_unit,
    fixedPrice: row.fixed_price,
    status: row.status,
    featured: row.featured,
    soldCount: row.sold_count,
    sortOrder: row.sort_order,
    dispatchToCs: row.dispatch_to_cs,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function readLocalProducts() {
  await ensureDir();
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : []).map((row, index) => normalizeProductRow(row, index));
    if (list.length) return list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seeded = DEFAULT_PRODUCTS.map((row, index) => normalizeProductRow(row, index));
  await writeLocalProducts(seeded);
  return seeded;
}

export async function writeLocalProducts(rows) {
  await ensureDir();
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeProductRow(row, index))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function updateLocalProducts(mutator) {
  const list = await readLocalProducts();
  const result = await mutator(list);
  await writeLocalProducts(list);
  return result;
}
