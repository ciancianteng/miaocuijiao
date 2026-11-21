import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "platform-services.json");
const CATEGORY_FILE = path.join(DATA_DIR, "service-categories.json");

export const DEFAULT_CATEGORIES = ["端游", "手游", "娱乐陪伴", "语音", "娱乐", "定制", "其他"];
export const DEFAULT_CATEGORY_ROWS = [
  { name: "端游", sort: 1, enabled: true },
  { name: "手游", sort: 2, enabled: true },
  { name: "娱乐陪伴", sort: 3, enabled: true },
  { name: "语音", sort: 4, enabled: true },
  { name: "娱乐", sort: 5, enabled: true },
  { name: "定制", sort: 6, enabled: true },
  { name: "其他", sort: 7, enabled: true },
];
export const DEFAULT_ICONS = ["🎮", "🎤", "⚔️", "🛡️", "🎯", "🎲", "💬"];
export const DISPLAY_POSITIONS = [
  { key: "home", label: "首页" },
  { key: "gameplay", label: "更多玩法" },
  { key: "cs_order", label: "客服建单" },
  { key: "companion_apply", label: "陪玩申请" },
  { key: "companion_profile", label: "陪玩资料编辑" },
  { key: "boss_order", label: "老板下单" },
];

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function parsePositions(raw, fallback) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsePositions(parsed, fallback);
    } catch {
      return raw
        .split(/[,|]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return Array.isArray(fallback) ? fallback.slice() : [];
}

function defaultPositionsFromFlags(row = {}) {
  const list = [];
  if (row.show_home !== false && row.showHome !== false) list.push("home");
  if (row.allow_apply !== false && row.allowApply !== false) list.push("companion_apply", "companion_profile");
  if (row.allow_order !== false && row.allowOrder !== false) list.push("boss_order", "cs_order", "gameplay");
  if (!list.length) list.push("home", "gameplay", "boss_order", "companion_apply", "cs_order");
  return Array.from(new Set(list));
}

export function normalizeServiceRow(row = {}) {
  const showHome = row.show_home !== false && row.showHome !== false;
  const allowApply = row.allow_apply !== false && row.allowApply !== false;
  const allowOrder = row.allow_order !== false && row.allowOrder !== false;
  let positions = parsePositions(row.display_positions ?? row.displayPositions, null);
  if (!positions.length) positions = defaultPositionsFromFlags(row);
  if (showHome && !positions.includes("home")) positions.push("home");
  if (!showHome) positions = positions.filter((key) => key !== "home");
  const rawId = row.id != null && String(row.id).trim() ? String(row.id).trim() : "";
  return {
    id: rawId,
    name: String(row.name || "").trim(),
    category: String(row.category || "其他").trim() || "其他",
    icon: String(row.icon || "🎮").trim() || "🎮",
    default_price: String(row.default_price ?? row.defaultPrice ?? "").trim(),
    enabled: row.enabled !== false && row.status !== "disabled" && row.status !== "停用",
    show_home: positions.includes("home"),
    allow_apply: allowApply,
    allow_order: allowOrder,
    display_positions: positions,
    sort: Number.isFinite(Number(row.sort ?? row.sort_order ?? row.sortOrder))
      ? Number(row.sort ?? row.sort_order ?? row.sortOrder)
      : 100,
    created_at: row.created_at || row.createdAt || new Date().toISOString(),
    updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export async function readLocalServices() {
  await ensureDir();
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    return (Array.isArray(parsed) ? parsed : []).map(normalizeServiceRow);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeLocalServices([]);
    return [];
  }
}

export async function writeLocalServices(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((row) => {
    const normalized = normalizeServiceRow(row);
    if (!normalized.id) normalized.id = randomUUID();
    return normalized;
  });
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw Object.assign(new Error("服务分类必须写入数据库，请确认 services 表已迁移。"), { status: 503 });
  }
  await ensureDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function updateLocalServices(mutator) {
  const list = await readLocalServices();
  const result = await mutator(list);
  await writeLocalServices(list);
  return result;
}

function normalizeLocalCategoryRow(row, index = 0) {
  if (typeof row === "string") {
    const name = String(row || "").trim();
    return name ? { id: name, name, sort: index + 1, enabled: true } : null;
  }
  const name = String((row && row.name) || "").trim();
  if (!name) return null;
  const sort = Number(row.sort_order ?? row.sort ?? index + 1);
  return {
    id: String(row.id || name),
    name,
    sort: Number.isFinite(sort) ? sort : index + 1,
    enabled: row.is_enabled !== false && row.enabled !== false,
  };
}

export async function readLocalCategoryRows() {
  await ensureDir();
  try {
    const text = await fs.readFile(CATEGORY_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : [])
      .map((row, i) => normalizeLocalCategoryRow(row, i))
      .filter(Boolean);
    if (list.length) {
      return list.sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), "zh"));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeLocalCategoryRows(DEFAULT_CATEGORY_ROWS);
  return DEFAULT_CATEGORY_ROWS.map((row, i) => normalizeLocalCategoryRow(row, i));
}

export async function readLocalCategories() {
  const rows = await readLocalCategoryRows();
  return rows.map((row) => row.name);
}

export async function writeLocalCategoryRows(rows) {
  const list = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const normalized = normalizeLocalCategoryRow(row, i);
    if (!normalized || seen.has(normalized.name)) return;
    seen.add(normalized.name);
    list.push(normalized);
  });
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw Object.assign(new Error("服务分类必须写入数据库，请确认 service_categories 表已迁移。"), { status: 503 });
  }
  await ensureDir();
  await fs.writeFile(CATEGORY_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function writeLocalCategories(rows) {
  if (Array.isArray(rows) && rows.length && typeof rows[0] === "object") {
    return writeLocalCategoryRows(rows);
  }
  const list = Array.from(
    new Set((Array.isArray(rows) ? rows : []).map((name) => String(name || "").trim()).filter(Boolean))
  ).map((name, i) => ({ name, sort: i + 1, enabled: true }));
  return writeLocalCategoryRows(list);
}
