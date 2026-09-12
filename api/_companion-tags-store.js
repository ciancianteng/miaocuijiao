import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "companion-tags.json");

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
  return `${env("SUPABASE_URL")}/rest/v1/companion_tags${query}`;
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || error || ""));
}
function rowFromDb(row = {}, index = 0) {
  return normalizeTagRow(
    {
      id: row.id,
      name: row.name,
      group: row.tag_group,
      selfSelectable: row.self_selectable,
      requiresAudit: row.requires_audit,
      showInHall: row.show_in_hall,
      supportsFilter: row.supports_filter,
      sort: row.sort_order,
      enabled: row.is_enabled,
      updated_at: row.updated_at,
    },
    index
  );
}
function rowToDb(row) {
  const item = normalizeTagRow(row);
  return {
    id: item.id,
    name: item.name,
    tag_group: item.group,
    self_selectable: item.selfSelectable,
    requires_audit: item.requiresAudit,
    show_in_hall: item.showInHall,
    supports_filter: item.supportsFilter,
    sort_order: item.sort,
    is_enabled: item.enabled,
    updated_at: new Date().toISOString(),
  };
}
async function readDbTags() {
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
async function writeDbTags(rows) {
  if (!hasDb()) return null;
  const list = (Array.isArray(rows) ? rows : []).map((row, index) => normalizeTagRow(row, index)).filter((row) => row.name);
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
    row.tag_group != null ? rowFromDb(row, index) : normalizeTagRow(row, index)
  );
}

export const DEFAULT_TAGS = [
  "甜妹", "御姐", "猛男", "幽默", "搞笑", "温柔", "技术", "娱乐", "夜猫子", "连麦",
].map((name, index) => ({
  id: `tag-${index + 1}`,
  name,
  group: "风格",
  selfSelectable: true,
  requiresAudit: false,
  showInHall: true,
  supportsFilter: true,
  sort: index + 1,
  enabled: true,
}));

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function normalizeTagRow(row = {}, index = 0) {
  const name = String(row.name || row.title || "").trim();
  return {
    id: String(row.id || randomUUID()),
    name,
    title: name,
    group: String(row.group || "风格").trim() || "风格",
    selfSelectable: row.selfSelectable !== false && row.selfSelectable !== "false",
    requiresAudit: row.requiresAudit === true || row.requiresAudit === "true",
    showInHall: row.showInHall !== false && row.showInHall !== "false",
    supportsFilter: row.supportsFilter !== false && row.supportsFilter !== "false",
    sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : index + 1,
    enabled: row.enabled !== false && row.status !== "disabled" && row.status !== "unpublished",
    updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export async function readLocalTags() {
  try {
    const dbRows = await readDbTags();
    if (Array.isArray(dbRows) && dbRows.length) {
      return dbRows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
    }
  } catch (error) {
    if (!isMissingTable(error)) console.error("[companion-tags] DB read failed, fallback local", error.message || error);
  }
  await ensureDir();
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(String(text || "[]").replace(/^\uFEFF/, ""));
    const list = (Array.isArray(parsed) ? parsed : []).map((row, index) => normalizeTagRow(row, index)).filter((row) => row.name);
    if (list.length) return list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seeded = DEFAULT_TAGS.map((row, index) => normalizeTagRow(row, index));
  await writeLocalTags(seeded);
  return seeded;
}

export async function writeLocalTags(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((row, index) => normalizeTagRow(row, index)).filter((row) => row.name)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  try {
    const saved = await writeDbTags(list);
    if (Array.isArray(saved)) return saved.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  } catch (error) {
    if (!isMissingTable(error)) console.error("[companion-tags] DB write failed, fallback local", error.message || error);
  }
  await ensureDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
  return list;
}

export async function updateLocalTags(mutator) {
  const list = await readLocalTags();
  const result = await mutator(list);
  await writeLocalTags(list);
  return result;
}

export function toPublicTag(tag) {
  const item = normalizeTagRow(tag);
  return {
    id: item.id,
    name: item.name,
    title: item.name,
    group: item.group,
    selfSelectable: item.selfSelectable,
    requiresAudit: item.requiresAudit,
    showInHall: item.showInHall,
    supportsFilter: item.supportsFilter,
    sort: item.sort,
    enabled: item.enabled,
    draft: {
      name: item.name,
      group: item.group,
      selfSelectable: item.selfSelectable,
      requiresAudit: item.requiresAudit,
      showInHall: item.showInHall,
      supportsFilter: item.supportsFilter,
      sort: item.sort,
    },
  };
}
