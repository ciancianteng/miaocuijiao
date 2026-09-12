import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "mcj-mvp-db.json");

const DEFAULT_STORE = {
  users: [],
  companions: [],
  bosses: [],
  customer_services: [],
  orders: [],
  banners: [],
  games: [],
  tags: [],
  announcements: [],
  order_operation_logs: [],
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function normalizeStore(value = {}) {
  const store = { ...DEFAULT_STORE, ...(value || {}) };
  Object.keys(DEFAULT_STORE).forEach((key) => {
    if (!Array.isArray(store[key])) store[key] = [];
  });
  return store;
}

export async function readMvpStore() {
  await ensureDataDir();
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    return normalizeStore(JSON.parse(String(text || "{}").replace(/^\uFEFF/, "")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const store = normalizeStore();
    await writeMvpStore(store);
    return store;
  }
}

export async function writeMvpStore(store) {
  await ensureDataDir();
  const normalized = normalizeStore(store);
  await fs.writeFile(DATA_FILE, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export async function updateMvpStore(mutator) {
  const store = await readMvpStore();
  const result = await mutator(store);
  await writeMvpStore(store);
  return result;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function truthy(value) {
  return value === true || value === 1 || ["true", "1", "yes", "on", "启用", "显示", "是"].includes(String(value).trim().toLowerCase());
}

export function isApprovedCompanion(row = {}) {
  const audit = String(row.audit_status || row.auditStatus || row.approval_status || row.approvalStatus || "").trim();
  const status = String(row.status || row.account_status || row.accountStatus || "启用").trim();
  const visible = row.visible !== false && row.is_visible !== false && row.on_shelf !== false;
  const approved = /approved|通过|已通过|启用/i.test(audit);
  const enabled = !/停用|禁用|冻结|封禁|黑名单|disabled|blocked|suspended/i.test(status);
  return approved && enabled && visible;
}

export function publicCompanion(row = {}) {
  const id = row.id || row.uid || row.companion_id || row.player_uid || "";
  const uid = row.uid || row.player_uid || row.companion_id || id;
  const price = money(row.current_price ?? row.price ?? row.default_price ?? row.hourly_price);
  return {
    id,
    uid,
    name: row.nickname || row.name || "未命名陪玩",
    nickname: row.nickname || row.name || "未命名陪玩",
    game: row.main_game || row.game || row.primary_game || "",
    mainGame: row.main_game || row.game || row.primary_game || "",
    serviceType: row.service_type || row.type || row.category || "",
    level: row.level_name || row.level || row.level_id || "",
    levelName: row.level_name || row.level || row.level_id || "",
    price,
    priceValue: price,
    hourlyPrice: price,
    gender: row.gender || "保密",
    onlineStatus: row.online_status || row.work_status || "离线",
    status: row.online_status || row.work_status || "离线",
    avatar: row.avatar_url || row.avatar || row.cover || row.card_cover || "assets/meow-cuijiao-brand.jpg",
    cover: row.cover || row.card_cover || row.avatar_url || row.avatar || "assets/meow-cuijiao-brand.jpg",
    tags: Array.isArray(row.tags) ? row.tags : String(row.tags || row.service_tags || "").split(/[,，、\s]+/).filter(Boolean),
    desc: row.bio || row.introduction || row.description || "",
  };
}

export function orderForApi(row = {}) {
  const amount = money(row.amount ?? row.actual_paid_amount ?? row.paid_amount);
  return {
    ...row,
    id: row.id || row.order_no,
    order_no: row.order_no || row.id || "",
    boss_uid: row.boss_uid || row.customer_uid || row.boss_id || "",
    boss_name: row.boss_name || row.customer_name || row.boss_nickname || "",
    player_uid: row.player_uid || row.player_id || row.companion_uid || "",
    player_name: row.player_name || row.companion_name || "",
    game: row.game || "",
    game_id: row.game_id || row.boss_game_id || row.customer_game_id || "",
    service_content: row.service_content || row.service || row.requirements || "",
    amount,
    actual_paid_amount: money(row.actual_paid_amount) || amount,
    order_type: row.order_type || "自定义订单",
    order_status: row.order_status || row.status || "待客服确认",
    payment_status: row.payment_status || "未支付",
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
  };
}

