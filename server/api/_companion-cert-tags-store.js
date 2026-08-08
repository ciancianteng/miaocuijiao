/**
 * Admin-only certification tags (官方推荐 / 金牌陪玩 / …).
 * Separate from style tags (甜妹/御姐) and from ID/deposit/contact verification.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "mcj-local-data")
  : path.join(process.cwd(), ".local-data");
const TAGS_FILE = path.join(DATA_DIR, "companion-cert-tags.json");
const ASSIGN_FILE = path.join(DATA_DIR, "companion-cert-assignments.json");

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
function restUrl(table, query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(
    String(error?.message || error || "")
  );
}

export const DEFAULT_CERT_TAGS = [
  { id: "cert-official", name: "官方推荐", icon: "🏅", color: "#f5c542", sort: 1 },
  { id: "cert-gold", name: "金牌陪玩", icon: "🥇", color: "#ff9f1c", sort: 2 },
  { id: "cert-skill", name: "实力认证", icon: "💪", color: "#4cc9f0", sort: 3 },
].map((row) => ({ ...row, enabled: true }));

export function normalizeCertTag(row = {}, index = 0) {
  const name = String(row.name || row.title || "").trim();
  return {
    id: String(row.id || randomUUID()),
    name,
    title: name,
    icon: String(row.icon || "🏷️").trim() || "🏷️",
    color: String(row.color || "#ff6b9d").trim() || "#ff6b9d",
    sort: Number.isFinite(Number(row.sort ?? row.sort_order))
      ? Number(row.sort ?? row.sort_order)
      : index + 1,
    enabled: row.enabled !== false && row.is_enabled !== false && row.status !== "disabled",
    updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

export function toPublicCertTag(tag) {
  const item = normalizeCertTag(tag);
  return {
    id: item.id,
    name: item.name,
    title: item.name,
    icon: item.icon,
    color: item.color,
    sort: item.sort,
    enabled: item.enabled,
  };
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(file, fallback) {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(String(text || "").replace(/^\uFEFF/, "") || "null") ?? fallback;
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonFile(file, data) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function rowFromDb(row = {}, index = 0) {
  return normalizeCertTag(
    {
      id: row.id,
      name: row.name,
      icon: row.icon,
      color: row.color,
      sort: row.sort_order,
      enabled: row.is_enabled,
      updated_at: row.updated_at,
    },
    index
  );
}

function rowToDb(row) {
  const item = normalizeCertTag(row);
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    color: item.color,
    sort_order: item.sort,
    is_enabled: item.enabled,
    updated_at: new Date().toISOString(),
  };
}

async function readDbTags() {
  if (!hasDb()) return null;
  const response = await fetch(restUrl("companion_cert_tags", "?order=sort_order.asc,name.asc"), {
    headers: serviceHeaders(),
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
  return (Array.isArray(body) ? body : []).map((row, i) => rowFromDb(row, i)).filter((r) => r.name);
}

async function writeDbTags(rows) {
  if (!hasDb()) return null;
  const list = (Array.isArray(rows) ? rows : []).map((r, i) => normalizeCertTag(r, i)).filter((r) => r.name);
  const del = await fetch(restUrl("companion_cert_tags", "?id=neq.__never__"), {
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
  const response = await fetch(restUrl("companion_cert_tags", ""), {
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
  return (Array.isArray(body) ? body : list).map((row, i) =>
    row.sort_order != null ? rowFromDb(row, i) : normalizeCertTag(row, i)
  );
}

export async function readCertTags() {
  try {
    const dbRows = await readDbTags();
    if (Array.isArray(dbRows) && dbRows.length) {
      return dbRows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
    }
  } catch (error) {
    if (!isMissingTable(error)) console.error("[cert-tags] DB read failed", error.message || error);
  }
  const local = await readJsonFile(TAGS_FILE, null);
  if (Array.isArray(local) && local.length) {
    return local.map((r, i) => normalizeCertTag(r, i)).filter((r) => r.name);
  }
  const seeded = DEFAULT_CERT_TAGS.map((r, i) => normalizeCertTag(r, i));
  await writeJsonFile(TAGS_FILE, seeded);
  return seeded;
}

function isServerlessFs() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
}

export async function writeCertTags(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((r, i) => normalizeCertTag(r, i))
    .filter((r) => r.name)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  try {
    const saved = await writeDbTags(list);
    if (Array.isArray(saved)) return saved;
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error("[cert-tags] DB write failed", error.message || error);
      throw Object.assign(new Error(`认证标签保存失败：${error.message || error}`), { status: 503 });
    }
  }
  if (isServerlessFs()) {
    throw Object.assign(
      new Error("认证标签表未就绪，无法在 Staging 写入本地文件。请执行 companion_cert_tags 迁移后重试。"),
      { status: 503 }
    );
  }
  await writeJsonFile(TAGS_FILE, list);
  return list;
}

export async function updateCertTags(mutator) {
  const list = await readCertTags();
  const result = await mutator(list);
  await writeCertTags(list);
  return result;
}

async function readDbAssignments(profileIds = []) {
  if (!hasDb() || !profileIds.length) return null;
  const ids = profileIds.map(encodeURIComponent).join(",");
  const response = await fetch(
    restUrl(
      "companion_cert_tag_assignments",
      `?companion_profile_id=in.(${ids})&select=companion_profile_id,tag_id`
    ),
    { headers: serviceHeaders() }
  );
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
  const map = {};
  for (const row of Array.isArray(body) ? body : []) {
    const pid = String(row.companion_profile_id || "");
    if (!pid) continue;
    if (!map[pid]) map[pid] = [];
    map[pid].push(String(row.tag_id));
  }
  return map;
}

async function writeDbAssignments(profileId, tagIds) {
  if (!hasDb()) return null;
  const del = await fetch(
    restUrl("companion_cert_tag_assignments", `?companion_profile_id=eq.${encodeURIComponent(profileId)}`),
    { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
  );
  if (!del.ok) {
    const text = await del.text();
    const err = new Error(text || `HTTP ${del.status}`);
    if (isMissingTable(err) || del.status === 404) return null;
    throw err;
  }
  const ids = [...new Set((tagIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const rows = ids.map((tag_id) => ({
    companion_profile_id: profileId,
    tag_id,
    created_at: new Date().toISOString(),
  }));
  const response = await fetch(restUrl("companion_cert_tag_assignments", ""), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(text || `HTTP ${response.status}`);
    if (isMissingTable(err) || response.status === 404) return null;
    throw err;
  }
  return ids;
}

async function readLocalAssignments() {
  const data = await readJsonFile(ASSIGN_FILE, {});
  return data && typeof data === "object" ? data : {};
}

export async function getAssignmentsForProfiles(profileIds = []) {
  const ids = [...new Set((profileIds || []).map(String).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const dbMap = await readDbAssignments(ids);
    if (dbMap) return dbMap;
  } catch (error) {
    if (!isMissingTable(error)) console.error("[cert-tags] assign read failed", error.message || error);
  }
  const local = await readLocalAssignments();
  const out = {};
  for (const id of ids) out[id] = Array.isArray(local[id]) ? local[id].map(String) : [];
  return out;
}

export async function setAssignmentsForProfile(profileId, tagIds) {
  const pid = String(profileId || "").trim();
  if (!pid) throw Object.assign(new Error("缺少陪玩资料 ID"), { status: 400 });
  const ids = [...new Set((tagIds || []).map(String).filter(Boolean))];
  try {
    const saved = await writeDbAssignments(pid, ids);
    if (Array.isArray(saved)) return saved;
  } catch (error) {
    if (!isMissingTable(error)) console.error("[cert-tags] assign write failed", error.message || error);
  }
  const local = await readLocalAssignments();
  local[pid] = ids;
  await writeJsonFile(ASSIGN_FILE, local);
  return ids;
}

/** Resolve enabled assigned cert tags for public/boss display. */
export async function resolveCertTagsForProfiles(profileIds = []) {
  const [catalog, assignMap] = await Promise.all([readCertTags(), getAssignmentsForProfiles(profileIds)]);
  const byId = new Map(catalog.filter((t) => t.enabled !== false).map((t) => [String(t.id), t]));
  const out = {};
  for (const pid of profileIds || []) {
    const ids = assignMap[String(pid)] || [];
    out[String(pid)] = ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map(toPublicCertTag)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
  }
  return out;
}
