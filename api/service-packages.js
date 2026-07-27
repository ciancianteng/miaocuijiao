import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function loadLocalEnv() {
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(apiDir, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0", ...extra };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || "Supabase 请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function isMissingTable(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text);
}

function view(row = {}) {
  return {
    id: row.id,
    name: row.name || "",
    game: row.game || "",
    category: row.category || "",
    fixedPrice: Number(row.fixed_price || 0),
    durationMinutes: Number(row.duration_minutes || 0),
    levelMin: Number(row.level_min || 1),
    levelMax: Number(row.level_max || 5),
    description: row.description || "",
    sortOrder: Number(row.sort_order || 100),
    isActive: row.is_active !== false,
    updatedAt: row.updated_at || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) return json(res, 503, { ok: false, message: "Supabase 未配置，无法读取更多玩法。" });
  try {
    const id = String(req.query.id || "").trim();
    const query = id
      ? `?id=eq.${encodeURIComponent(id)}&limit=1`
      : "?is_active=eq.true&order=sort_order.asc,created_at.desc";
    const rows = await supabaseJson(restUrl("service_packages", query), { headers: serviceHeaders() });
    const packages = (Array.isArray(rows) ? rows : []).map(view);
    return json(res, 200, { ok: true, packages, package: id ? packages[0] || null : null });
  } catch (error) {
    if (isMissingTable(error)) return json(res, 503, { ok: false, packages: [], message: "service_packages 表未初始化，请先执行 supabase/init.sql 中的更多玩法表结构。" });
    return json(res, error.status || 500, { ok: false, message: error.message || "更多玩法接口异常" });
  }
}
