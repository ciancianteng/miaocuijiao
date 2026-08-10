/**
 * Admin-configured voice line options (声线).
 * Separate from style tags (随和/技术流) and certification tags.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "mcj-local-data")
  : path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "companion-voice-types.json");

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
  return `${env("SUPABASE_URL")}/rest/v1/companion_voice_types${query}`;
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(
    String(error?.message || error || "")
  );
}

export const DEFAULT_VOICE_TYPES = [
  { id: "voice-tianmei", name: "甜妹", description: "甜美可爱", sort: 1 },
  { id: "voice-yujie", name: "御姐", description: "成熟自信", sort: 2 },
  { id: "voice-shaoyu", name: "少御", description: "少年御姐感", sort: 3 },
  { id: "voice-luoli", name: "萝莉", description: "娇软萝莉", sort: 4 },
  { id: "voice-wenrou", name: "温柔", description: "温柔细腻", sort: 5 },
  { id: "voice-qingleng", name: "清冷", description: "清冷淡然", sort: 6 },
  { id: "voice-yonglan", name: "慵懒", description: "慵懒随性", sort: 7 },
  { id: "voice-cixing", name: "磁性", description: "低沉磁性", sort: 8 },
  { id: "voice-shaonian", name: "少年", description: "清亮少年", sort: 9 },
  { id: "voice-qingshu", name: "青叔", description: "青叔稳重", sort: 10 },
  { id: "voice-dashu", name: "大叔", description: "大叔低沉", sort: 11 },
  { id: "voice-other", name: "其他", description: "自定义声线", sort: 12 },
].map((row) => ({ ...row, enabled: true }));

/** Companion self-select catalog (no admin「声线管理」dependency). */
export const COMPANION_VOICE_OPTIONS = DEFAULT_VOICE_TYPES.map((row) => row.name);

export function normalizeVoiceType(row = {}, index = 0) {
  const name = String(row.name || row.title || "").trim();
  return {
    id: String(row.id || randomUUID()),
    name,
    title: name,
    description: String(row.description || row.desc || "").trim(),
    sort: Number.isFinite(Number(row.sort ?? row.sort_order))
      ? Number(row.sort ?? row.sort_order)
      : index + 1,
    enabled: row.enabled !== false && row.is_enabled !== false && row.status !== "disabled",
    updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export function toPublicVoiceType(row) {
  const item = normalizeVoiceType(row);
  return {
    id: item.id,
    name: item.name,
    title: item.name,
    description: item.description,
    sort: item.sort,
    enabled: item.enabled,
    draft: {
      name: item.name,
      description: item.description,
      sort: item.sort,
    },
  };
}

export function splitVoiceTypeNames(raw) {
  return String(raw == null ? "" : raw)
    .replace(/^声线\s*[:：]\s*/, "")
    .split(/[,，、|/]+/)
    .map((t) => String(t || "").trim())
    .filter((t) => t && !/^(无|暂无|未设置|-|—)$/.test(t));
}

export function joinVoiceTypeNames(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .join("、");
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function rowFromDb(row = {}, index = 0) {
  return normalizeVoiceType(
    {
      id: row.id,
      name: row.name,
      description: row.description,
      sort: row.sort_order,
      enabled: row.is_enabled,
      updated_at: row.updated_at,
    },
    index
  );
}

function rowToDb(row) {
  const item = normalizeVoiceType(row);
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    sort_order: item.sort,
    is_enabled: item.enabled,
    updated_at: new Date().toISOString(),
  };
}

async function readDbRows() {
  if (!hasDb()) return null;
  const response = await fetch(restUrl("?order=sort_order.asc,name.asc"), { headers: serviceHeaders() });
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
  return (Array.isArray(body) ? body : []).map((row, index) => rowFromDb(row, index)).filter((row) => row.name);
}

async function writeDbRows(rows) {
  if (!hasDb()) return null;
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeVoiceType(row, index))
    .filter((row) => row.name);
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
  if (!list.length) return [];
  const response = await fetch(restUrl(""), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(list.map(rowToDb)),
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
  return (Array.isArray(body) ? body : list).map((row, index) =>
    row.sort_order != null ? rowFromDb(row, index) : normalizeVoiceType(row, index)
  );
}

export async function readVoiceTypes() {
  try {
    const dbRows = await readDbRows();
    if (Array.isArray(dbRows) && dbRows.length) {
      return dbRows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
    }
  } catch (error) {
    if (!isMissingTable(error)) console.error("[voice-types] DB read failed, fallback local", error.message || error);
  }
  await ensureDir();
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : [])
      .map((row, index) => normalizeVoiceType(row, index))
      .filter((row) => row.name);
    if (list.length) return list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seeded = DEFAULT_VOICE_TYPES.map((row, index) => normalizeVoiceType(row, index));
  await writeVoiceTypes(seeded);
  return seeded;
}

function isServerlessFs() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
}

export async function writeVoiceTypes(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeVoiceType(row, index))
    .filter((row) => row.name)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  try {
    const saved = await writeDbRows(list);
    if (Array.isArray(saved)) return saved.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error("[voice-types] DB write failed", error.message || error);
      throw Object.assign(new Error(`声线保存失败：${error.message || error}`), { status: 503 });
    }
  }
  if (isServerlessFs()) {
    throw Object.assign(
      new Error("声线表未就绪，无法在 Staging 写入本地文件。请执行 companion_voice_types 迁移后重试。"),
      { status: 503 }
    );
  }
  await ensureDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function updateVoiceTypes(mutator) {
  const list = await readVoiceTypes();
  const result = await mutator(list);
  await writeVoiceTypes(list);
  return result;
}

/** Validate companion-chosen voice labels (fixed catalog + custom「其他」). No admin DB required. */
export async function normalizeSelectedVoiceTypes(raw, { required = false } = {}) {
  const selected = splitVoiceTypeNames(raw)
    .map((name) => String(name || "").replace(/^其他\s*[:：]\s*/, "").trim())
    .filter((name) => name && name !== "其他");
  if (!selected.length) {
    if (required) {
      const err = new Error("请选择声线");
      err.status = 400;
      err.field = "voice_type";
      throw err;
    }
    return "";
  }
  const out = [];
  const seen = new Set();
  for (const name of selected.slice(0, 12)) {
    const n = String(name).slice(0, 20).trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  if (!out.length) {
    if (required) {
      const err = new Error("请选择声线");
      err.status = 400;
      err.field = "voice_type";
      throw err;
    }
    return "";
  }
  return joinVoiceTypeNames(out);
}
