import fs from "node:fs";
import path from "node:path";
import { normalizeServiceRow } from "../_services-store.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
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

function serviceHeaders() {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0" };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function isMissingTable(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text);
}

function view(row = {}) {
  const normalized = normalizeServiceRow(row);
  return {
    id: normalized.id,
    name: normalized.name,
    title: normalized.name,
    category: normalized.category,
    icon: normalized.icon,
    defaultPrice: normalized.default_price,
    default_price: normalized.default_price,
    enabled: normalized.enabled,
    showHome: normalized.show_home,
    showOnHome: normalized.show_home,
    allowApply: normalized.allow_apply,
    allowOrder: normalized.allow_order,
    displayPositions: normalized.display_positions,
    display_positions: normalized.display_positions,
    sort: normalized.sort,
    createdAt: normalized.created_at,
    updatedAt: normalized.updated_at,
  };
}

function hasPosition(item, key) {
  const positions = item.displayPositions || item.display_positions || [];
  return Array.isArray(positions) && positions.indexOf(key) >= 0;
}

async function fetchDbServices() {
  const response = await fetch(restUrl("services", "?enabled=eq.true&order=sort.asc,updated_at.desc"), {
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
    throw Object.assign(new Error(body?.message || `读取 services 失败 (HTTP ${response.status})`), {
      status: response.status,
      body,
    });
  }
  return (Array.isArray(body) ? body : []).map(view);
}

export async function loadPublicServices() {
  if (!hasDb()) {
    return { services: [], source: "unconfigured", message: "数据库未配置。" };
  }
  try {
    return { services: await fetchDbServices(), source: "supabase" };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return {
      services: [],
      source: "missing_table",
      message: "services 表未初始化。请在 Supabase SQL Editor 执行 supabase/services.sql。",
    };
  }
}

function filterByScope(services, scope) {
  const list = Array.isArray(services) ? services : [];
  if (scope === "home") {
    return list.filter((item) => item.showHome !== false && hasPosition(item, "home"));
  }
  if (scope === "apply") {
    return list.filter((item) => item.allowApply !== false && hasPosition(item, "companion_apply"));
  }
  if (scope === "profile") {
    // Companion price/game list: all enabled services so admin-added games appear without code changes.
    return list.filter((item) => item.enabled !== false);
  }
  if (scope === "order" || scope === "boss") {
    return list.filter((item) => item.allowOrder !== false && hasPosition(item, "boss_order"));
  }
  if (scope === "cs") {
    return list.filter((item) => item.allowOrder !== false && hasPosition(item, "cs_order"));
  }
  if (scope === "gameplay") {
    return list.filter((item) => hasPosition(item, "gameplay"));
  }
  return list;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const scope = String(req.query.scope || "all");
    const loaded = await loadPublicServices();
    const services = filterByScope(loaded.services, scope);
    return json(res, 200, {
      ok: true,
      services,
      configured: hasDb(),
      source: loaded.source,
      message: loaded.message || "",
      scope,
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "服务列表读取失败", services: [] });
  }
}
