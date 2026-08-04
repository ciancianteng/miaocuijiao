import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "companion-levels.json");

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}
function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}
function serviceHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function restUrl(query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/companion_levels${query}`;
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || error || ""));
}
function rowFromDb(row = {}, index = 0) {
  return normalizeLevelRow(
    {
      id: row.id,
      level: row.level,
      code: row.code,
      name: row.name,
      icon: row.icon,
      color: row.color,
      displayColor: row.display_color,
      cardBackground: row.card_background,
      badgeBorder: row.badge_border,
      badgeText: row.badge_text,
      badgeIcon: row.badge_icon,
      min: row.min_price,
      max: row.max_price,
      maxPlus: row.max_plus,
      commissionRate: row.commission_rate,
      upgradeCondition: row.upgrade_condition,
      description: row.description,
      requirements: row.requirements,
      downgradeCondition: row.downgrade_condition,
      benefits: row.benefits,
      sort: row.sort_order,
      open: row.is_open,
      enabled: row.is_enabled,
      updated_at: row.updated_at,
    },
    index
  );
}
function rowToDb(row) {
  const item = normalizeLevelRow(row);
  return {
    id: item.id,
    level: item.level,
    code: item.code,
    name: item.name,
    icon: item.icon,
    color: item.color,
    display_color: item.displayColor,
    card_background: item.cardBackground,
    badge_border: item.badgeBorder,
    badge_text: item.badgeText,
    badge_icon: item.badgeIcon,
    min_price: item.min,
    max_price: item.max,
    max_plus: item.maxPlus,
    commission_rate: item.commissionRate,
    upgrade_condition: item.upgradeCondition,
    description: item.description,
    requirements: item.requirements || "",
    downgrade_condition: item.downgradeCondition || "",
    benefits: item.benefits || "",
    sort_order: item.sort,
    is_open: item.open,
    is_enabled: item.enabled,
    updated_at: new Date().toISOString(),
  };
}
async function readDbLevels() {
  if (!hasDb()) return null;
  const response = await fetch(restUrl("?order=sort_order.asc,level.asc"), { headers: serviceHeaders() });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const err = new Error(body?.message || body?.hint || text || `HTTP ${response.status}`);
    if (isMissingTable(err) || response.status === 404) return null;
    throw err;
  }
  return (Array.isArray(body) ? body : []).map((row, index) => rowFromDb(row, index));
}
async function writeDbLevels(rows) {
  if (!hasDb()) return null;
  const list = (Array.isArray(rows) ? rows : []).map((row, index) => normalizeLevelRow(row, index));
  const payload = list.map(rowToDb);
  const del = await fetch(restUrl("?id=neq.__never__"), {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
  });
  if (!del.ok) {
    const text = await del.text();
    const err = new Error(text || `HTTP ${del.status}`);
    if (isMissingTable(err) || del.status === 404) return null;
    throw err;
  }
  if (!payload.length) return [];
  const response = await fetch(restUrl(""), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const err = new Error(body?.message || body?.hint || text || `HTTP ${response.status}`);
    if (isMissingTable(err) || response.status === 404) return null;
    throw err;
  }
  return (Array.isArray(body) ? body : payload).map((row, index) =>
    row.id && row.min_price != null ? rowFromDb(row, index) : normalizeLevelRow(row, index)
  );
}

export const DEFAULT_LEVELS = [
  {
    id: "lv1",
    level: 1,
    code: "Lv1",
    name: "萌喵",
    icon: "🩶",
    color: "#9CA3AF",
    displayColor: "#9CA3AF",
    cardBackground: "solid",
    badgeBorder: "#9CA3AF",
    badgeText: "#E5E7EB",
    badgeIcon: "#D1D5DB",
    min: 20,
    max: 30,
    maxPlus: false,
    commissionRate: 20,
    upgradeCondition: "完成基础资料审核并开始接单。\n订单数：达到后台设置门槛\n好评率：达到后台设置门槛\n认证完成：是",
    description: "新加入平台，需要累积订单与评价。",
    sort: 1,
    open: true,
    enabled: true,
  },
  {
    id: "lv2",
    level: 2,
    code: "Lv2",
    name: "灵喵",
    icon: "💙",
    color: "#3B82F6",
    displayColor: "#3B82F6",
    cardBackground: "gradient",
    badgeBorder: "#60A5FA",
    badgeText: "#DBEAFE",
    badgeIcon: "#93C5FD",
    min: 30,
    max: 40,
    maxPlus: false,
    commissionRate: 18,
    upgradeCondition: "累计订单与基础好评达到后台设置条件。\n订单数：达标\n好评率：达标\n认证完成：是",
    description: "已有订单与基础好评，稳定接单。",
    sort: 2,
    open: true,
    enabled: true,
  },
  {
    id: "lv3",
    level: 3,
    code: "Lv3",
    name: "猎喵",
    icon: "💜",
    color: "#A855F7",
    displayColor: "#A855F7",
    cardBackground: "gradient",
    badgeBorder: "#C084FC",
    badgeText: "#F3E8FF",
    badgeIcon: "#D8B4FE",
    min: 40,
    max: 45,
    maxPlus: false,
    commissionRate: 16,
    upgradeCondition: "技术表现、评价和在线时长达到后台设置条件。\n订单数：达标\n好评率：达标\n认证完成：是",
    description: "技术表现优秀、评价较高。",
    sort: 3,
    open: true,
    enabled: true,
  },
  {
    id: "lv4",
    level: 4,
    code: "Lv4",
    name: "喵神",
    icon: "💛",
    color: "#EAB308",
    displayColor: "#EAB308",
    cardBackground: "gradient",
    badgeBorder: "#FACC15",
    badgeText: "#FEF9C3",
    badgeIcon: "#FDE047",
    min: 60,
    max: 75,
    maxPlus: false,
    commissionRate: 14,
    upgradeCondition: "热门游戏专精表现通过后台审核。\n订单数：达标\n好评率：达标\n认证完成：是",
    description: "热门游戏专精陪玩。",
    sort: 4,
    open: false,
    enabled: true,
  },
  {
    id: "lv5",
    level: 5,
    code: "Lv5",
    name: "喵皇",
    icon: "👑",
    color: "#F59E0B",
    displayColor: "#EF4444",
    cardBackground: "glass",
    badgeBorder: "#F59E0B",
    badgeText: "#FEE2E2",
    badgeIcon: "#FBBF24",
    min: 75,
    max: 100,
    maxPlus: true,
    commissionRate: 12,
    upgradeCondition: "招牌陪玩、人气主播或大神级资质通过后台审核。\n订单数：达标\n好评率：达标\n认证完成：是",
    description: "俱乐部招牌、人气主播或大神级陪玩。",
    sort: 5,
    open: false,
    enabled: true,
  },
];

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function normalizeLevelRow(row = {}, index = 0) {
  const levelNo = Math.max(1, Number(row.level || String(row.id || row.code || "").match(/\d+/) || index + 1) || index + 1);
  const fallback = DEFAULT_LEVELS.find((item) => item.level === levelNo) || DEFAULT_LEVELS[0];
  const min = Math.max(0, Number(row.min ?? row.minPrice ?? row.minimum_price ?? fallback.min));
  const max = Math.max(min, Number(row.max ?? row.maxPrice ?? row.maximum_price ?? fallback.max));
  return {
    id: String(row.id || `lv${levelNo}`),
    level: levelNo,
    code: String(row.code || `Lv${levelNo}`).replace(/^Lv\.?/i, "Lv"),
    name: String(row.name || fallback.name || "").trim() || fallback.name,
    icon: String(row.icon || fallback.icon || "🩶"),
    color: String(row.color || row.levelColor || fallback.color || "#9CA3AF"),
    displayColor: String(row.displayColor || row.homeColor || row.color || fallback.displayColor || fallback.color || "#9CA3AF"),
    cardBackground: ["solid", "gradient", "glass"].includes(String(row.cardBackground || row.cardStyle || ""))
      ? String(row.cardBackground || row.cardStyle)
      : fallback.cardBackground || "solid",
    badgeBorder: String(row.badgeBorder || row.badge_border || fallback.badgeBorder || fallback.color),
    badgeText: String(row.badgeText || row.badge_text || fallback.badgeText || "#fff"),
    badgeIcon: String(row.badgeIcon || row.badge_icon || fallback.badgeIcon || fallback.color),
    min,
    max,
    maxPlus: row.maxPlus === true || row.maxPlus === "true" || row.allowAboveMax === true || row.maximum_price_plus === true,
    commissionRate: Math.max(0, Math.min(100, Number(row.commissionRate ?? row.commission ?? fallback.commissionRate ?? 20))),
    upgradeCondition: String(row.upgradeCondition || row.upgrade_condition || fallback.upgradeCondition || ""),
    description: String(row.description || row.desc || fallback.description || ""),
      requirements: String(row.requirements || row.requirement || ""),
      downgradeCondition: String(row.downgradeCondition || row.downgrade_condition || ""),
      benefits: String(row.benefits || row.benefit || ""),
      sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : levelNo,
    open: row.open !== false && row.open !== "否" && row.open !== "关闭",
    enabled: row.enabled !== false && row.enabled !== "停用" && row.status !== "disabled",
    updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export async function readLocalLevels() {
  try {
    const dbRows = await readDbLevels();
    if (Array.isArray(dbRows) && dbRows.length) {
      return dbRows.sort((a, b) => a.sort - b.sort || a.level - b.level);
    }
  } catch (error) {
    if (!isMissingTable(error)) console.error("[companion-levels] DB read failed, fallback local", error.message || error);
  }
  try {
    await ensureDir();
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : []).map((row, index) => normalizeLevelRow(row, index));
    if (list.length) return list.sort((a, b) => a.sort - b.sort || a.level - b.level);
  } catch (error) {
    if (error.code !== "ENOENT") {
      /* read-only serverless FS or parse error → defaults */
    }
  }
  return DEFAULT_LEVELS.map((row, index) => normalizeLevelRow(row, index));
}

export async function writeLocalLevels(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((row, index) => normalizeLevelRow(row, index))
    .sort((a, b) => a.sort - b.sort || a.level - b.level);
  try {
    const saved = await writeDbLevels(list);
    if (Array.isArray(saved)) return saved.sort((a, b) => a.sort - b.sort || a.level - b.level);
  } catch (error) {
    if (!isMissingTable(error)) console.error("[companion-levels] DB write failed, fallback local", error.message || error);
  }
  try {
    await ensureDir();
    await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {
    /* Preview/serverless may be read-only; still return levels for this request */
  }
  return list;
}

export async function updateLocalLevels(mutator) {
  const list = await readLocalLevels();
  const result = await mutator(list);
  await writeLocalLevels(list);
  return result;
}

/** Persist a single level into the catalog (merge → full write). */
export async function upsertLocalLevel(row) {
  const list = await readLocalLevels();
  const next = normalizeLevelRow(row, list.length);
  const idx = list.findIndex((item) => String(item.id) === String(next.id));
  if (idx >= 0) {
    list[idx] = normalizeLevelRow(
      { ...list[idx], ...next, id: list[idx].id, level: list[idx].level || next.level },
      idx
    );
  } else {
    list.push(next);
  }
  return writeLocalLevels(list);
}

function companionProfilesUrl(query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/companion_profiles${query}`;
}

/**
 * Push each level's commission_rate onto companions at that level.
 * New settlements read companion_profiles.commission_rate; historical settled orders keep their snapshot.
 */
export async function syncCompanionCommissionsFromLevels(levels) {
  const list = (Array.isArray(levels) ? levels : []).map((row, index) => normalizeLevelRow(row, index));
  const report = { ok: true, updated: 0, skipped: 0, errors: [] };
  if (!hasDb()) {
    report.skipped = list.length;
    report.message = "无数据库连接，跳过陪玩抽成同步（等级配置仍已写入）。";
    return report;
  }
  for (const level of list) {
    const rate = Math.max(0, Math.min(100, Number(level.commissionRate) || 0));
    const patch = {
      commission_rate: rate,
      commission_effective_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const queries = [
      `?level_id=eq.${encodeURIComponent(level.id)}`,
      `?level_id=eq.${encodeURIComponent(level.code)}`,
    ];
    for (const query of queries) {
      try {
        const response = await fetch(companionProfilesUrl(query), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify(patch),
        });
        const text = await response.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        if (!response.ok) {
          if (response.status === 404 || isMissingTable({ message: text })) continue;
          report.errors.push(`${level.code}: ${body?.message || text || `HTTP ${response.status}`}`);
          report.ok = false;
          continue;
        }
        report.updated += Array.isArray(body) ? body.length : 0;
      } catch (error) {
        report.errors.push(`${level.code}: ${error.message || error}`);
        report.ok = false;
      }
    }
  }
  if (report.errors.length) report.ok = false;
  return report;
}

export const PUBLISH_SYNC_TARGETS = [
  { key: "db", label: "数据库 companion_levels" },
  { key: "boss_hall", label: "老板端 · 陪玩大厅" },
  { key: "more_gameplays", label: "更多玩法" },
  { key: "boss_detail", label: "陪玩详情 / 下单" },
  { key: "boss_ranking", label: "排行榜 / 俱乐部等级页" },
  { key: "companion", label: "陪玩端 · 限价与抽成" },
  { key: "cs", label: "客服端 · 等级展示" },
  { key: "admin", label: "后台中心" },
  { key: "device", label: "手机 / PC（同一份配置）" },
];

export function buildPublishSyncChecklist({ verified = false, commission = null, error = "" } = {}) {
  return PUBLISH_SYNC_TARGETS.map((item) => {
    if (error) return { ...item, ok: false, detail: error };
    if (item.key === "db") return { ...item, ok: verified, detail: verified ? "已写入" : "校验失败" };
    if (item.key === "companion" && commission) {
      const detail = commission.ok
        ? `抽成已同步 ${commission.updated || 0} 人`
        : (commission.errors && commission.errors[0]) || commission.message || "抽成同步异常";
      return { ...item, ok: !!commission.ok || !!commission.skipped, detail };
    }
    return { ...item, ok: verified, detail: verified ? "读同一份等级配置" : "未验证" };
  });
}

export function toPublicLevel(level) {
  const item = normalizeLevelRow(level);
  return {
    id: item.id,
    level: item.level,
    code: item.code,
    name: item.name,
    title: `${item.code} ${item.name}`,
    icon: item.icon,
    color: item.color,
    displayColor: item.displayColor,
    cardBackground: item.cardBackground,
    badgeBorder: item.badgeBorder,
    badgeText: item.badgeText,
    badgeIcon: item.badgeIcon,
    min: item.min,
    max: item.max,
    minPrice: item.min,
    maxPrice: item.max,
    maxPlus: item.maxPlus,
    commissionRate: item.commissionRate,
    upgradeCondition: item.upgradeCondition,
    description: item.description,
    sort: item.sort,
    open: item.open,
    enabled: item.enabled,
    draft: {
      code: item.code,
      name: item.name,
      icon: item.icon,
      color: item.color,
      displayColor: item.displayColor,
      cardBackground: item.cardBackground,
      badgeBorder: item.badgeBorder,
      badgeText: item.badgeText,
      badgeIcon: item.badgeIcon,
      minPrice: item.min,
      maxPrice: item.max,
      maxPlus: item.maxPlus,
      commissionRate: item.commissionRate,
      upgradeCondition: item.upgradeCondition,
      description: item.description,
      sort: item.sort,
    },
  };
}
