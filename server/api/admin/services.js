import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_ICONS,
  DISPLAY_POSITIONS,
  normalizeServiceRow,
  readLocalServices,
  readLocalCategories,
  writeLocalCategories,
} from "../_services-store.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const POSITION_KEYS = DISPLAY_POSITIONS.map((item) => item.key);

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
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function authHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    Prefer: "return=representation",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
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
    const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""]
      .filter(Boolean);
    const base = parts[0] || "Supabase 请求失败";
    const code = body?.code ? ` [${body.code}]` : "";
    throw Object.assign(new Error(`${base}${code} (HTTP ${response.status})`), { status: response.status, body });
  }
  return body;
}

function isMissingTable(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text);
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}

async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录管理员账号。"), { status: 401 });
  const authUser = await supabaseJson(authUrl("user"), { headers: authHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权管理服务。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号未启用。"), { status: 403 });
  return profile;
}

function truthy(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off", "停用", "关闭", "隐藏", "否"].includes(text)) return false;
  if (["true", "1", "yes", "on", "启用", "开启", "显示", "是"].includes(text)) return true;
  return fallback;
}

function number(value, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function view(row = {}) {
  const normalized = normalizeServiceRow(row);
  return {
    id: normalized.id,
    name: normalized.name,
    category: normalized.category,
    icon: normalized.icon,
    defaultPrice: normalized.default_price,
    default_price: normalized.default_price,
    enabled: normalized.enabled,
    status: normalized.enabled ? "启用" : "停用",
    showHome: normalized.show_home,
    allowApply: normalized.allow_apply,
    allowOrder: normalized.allow_order,
    displayPositions: normalized.display_positions,
    display_positions: normalized.display_positions,
    sort: normalized.sort,
    sortOrder: normalized.sort,
    createdAt: normalized.created_at,
    updatedAt: normalized.updated_at,
  };
}

function dbPayload(normalized) {
  return {
    name: normalized.name,
    category: normalized.category,
    icon: normalized.icon,
    default_price: normalized.default_price,
    enabled: normalized.enabled,
    show_home: normalized.show_home,
    allow_apply: normalized.allow_apply,
    allow_order: normalized.allow_order,
    display_positions: normalized.display_positions,
    sort: normalized.sort,
    updated_at: new Date().toISOString(),
  };
}

function clean(input = {}, categories = DEFAULT_CATEGORIES) {
  const name = String(input.name || "").trim();
  if (!name) throw Object.assign(new Error("请填写服务名称。"), { status: 400 });
  let category = String(input.category || "其他").trim() || "其他";
  const known = Array.isArray(categories) && categories.length ? categories : DEFAULT_CATEGORIES;
  if (!known.includes(category)) {
    // allow new category name from admin
    category = category || "其他";
  }
  const positions = normalizeServiceRow({
    ...input,
    display_positions: input.displayPositions || input.display_positions,
    showHome: input.showHome,
    show_home: input.showHome ?? input.show_home,
  }).display_positions.filter((key) => POSITION_KEYS.includes(key));
  const showHome = truthy(input.showHome ?? input.show_home, positions.includes("home"));
  const finalPositions = showHome
    ? Array.from(new Set(positions.concat(["home"])))
    : positions.filter((key) => key !== "home");
  if (!finalPositions.length) {
    throw Object.assign(new Error("请至少勾选一个显示位置。"), { status: 400 });
  }
  return normalizeServiceRow({
    id: input.id,
    name,
    category,
    icon: String(input.icon || "🎮").trim() || "🎮",
    default_price: String(input.defaultPrice ?? input.default_price ?? "").trim(),
    enabled: truthy(input.enabled, true),
    show_home: finalPositions.includes("home"),
    allow_apply: truthy(input.allowApply ?? input.allow_apply, true),
    allow_order: truthy(input.allowOrder ?? input.allow_order, true),
    display_positions: finalPositions,
    sort: number(input.sort ?? input.sortOrder ?? input.sort_order, 100),
    created_at: input.createdAt || input.created_at,
    updated_at: new Date().toISOString(),
  });
}

async function listCategories() {
  if (hasDb()) {
    try {
      const rows = await supabaseJson(restUrl("service_categories", "?is_enabled=eq.true&order=sort_order.asc,name.asc"), {
        headers: serviceHeaders(),
      });
      const names = (Array.isArray(rows) ? rows : []).map((row) => String(row.name || "").trim()).filter(Boolean);
      if (names.length) return { categories: names, source: "supabase" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
    try {
      const services = await supabaseJson(restUrl("services", "?select=category"), { headers: serviceHeaders() });
      const fromServices = Array.from(
        new Set((Array.isArray(services) ? services : []).map((row) => String(row.category || "").trim()).filter(Boolean))
      );
      const merged = Array.from(new Set(DEFAULT_CATEGORIES.concat(fromServices)));
      return { categories: merged, source: "supabase-derived" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const local = await readLocalCategories();
  return { categories: local.length ? local : DEFAULT_CATEGORIES.slice(), source: "local" };
}

async function ensureCategory(name) {
  const category = String(name || "").trim();
  if (!category) return;
  if (hasDb()) {
    try {
      await supabaseJson(restUrl("service_categories?on_conflict=name"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({
          name: category,
          sort_order: 100,
          is_enabled: true,
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    } catch (error) {
      if (!isMissingTable(error)) {
        // ignore unique conflicts
        if (!/duplicate|unique/i.test(error.message || "")) throw error;
        return;
      }
    }
  }
  const list = await readLocalCategories();
  if (!list.includes(category)) {
    list.push(category);
    await writeLocalCategories(list);
  }
}

async function listFromDb() {
  const rows = await supabaseJson(restUrl("services", "?order=sort.asc,updated_at.desc"), { headers: serviceHeaders() });
  return (Array.isArray(rows) ? rows : []).map(view);
}

async function listServices() {
  const categoryResult = await listCategories();
  if (!hasDb()) {
    const rows = await readLocalServices();
    return {
      services: rows.map(view).sort((a, b) => a.sort - b.sort),
      categories: categoryResult.categories,
      icons: DEFAULT_ICONS,
      positions: DISPLAY_POSITIONS,
      source: "local",
      message: "数据库未配置，当前无法持久同步。请配置 Supabase 并执行 supabase/services.sql。",
    };
  }
  try {
    return {
      services: await listFromDb(),
      categories: categoryResult.categories,
      icons: DEFAULT_ICONS,
      positions: DISPLAY_POSITIONS,
      source: "supabase",
    };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return {
      services: [],
      categories: categoryResult.categories.length ? categoryResult.categories : DEFAULT_CATEGORIES.slice(),
      icons: DEFAULT_ICONS,
      positions: DISPLAY_POSITIONS,
      source: "missing_table",
      message: "services 表未初始化。请先在 Supabase SQL Editor 执行 supabase/services.sql，再新增服务。保存才会真实写入数据库并全站同步。",
    };
  }
}

async function saveService(body, categories) {
  const payload = clean(body.service || body, categories);
  await ensureCategory(payload.category);
  const id = String(body.id || body.service?.id || payload.id || "").trim();
  const dbBody = dbPayload(payload);

  if (!hasDb()) {
    throw Object.assign(new Error("数据库未配置，禁止只保存到本地。"), { status: 503 });
  }

  try {
    if (id) {
      const rows = await supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(dbBody),
      });
      return { service: view(rows?.[0] || { ...dbBody, id }), source: "supabase" };
    }
    const rows = await supabaseJson(restUrl("services"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ ...dbBody, created_at: new Date().toISOString() }),
    });
    return { service: view(rows?.[0] || dbBody), source: "supabase" };
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("services 表未初始化。请先执行 supabase/services.sql。"), { status: 503 });
    }
    throw error;
  }
}

async function toggleService(id, enabled) {
  if (!hasDb()) throw Object.assign(new Error("数据库未配置。"), { status: 503 });
  try {
    const rows = await supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ enabled: Boolean(enabled), updated_at: new Date().toISOString() }),
    });
    return { service: view(rows?.[0] || { id, enabled: Boolean(enabled) }), source: "supabase" };
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("services 表未初始化。请先执行 supabase/services.sql。"), { status: 503 });
    }
    throw error;
  }
}

async function deleteService(id) {
  if (!hasDb()) throw Object.assign(new Error("数据库未配置。"), { status: 503 });
  try {
    await supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    return { source: "supabase" };
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("services 表未初始化。请先执行 supabase/services.sql。"), { status: 503 });
    }
    throw error;
  }
}

async function duplicateService(id) {
  const listed = await listServices();
  const source = listed.services.find((row) => String(row.id) === String(id));
  if (!source) throw Object.assign(new Error("服务不存在。"), { status: 404 });
  return saveService(
    {
      service: {
        ...source,
        id: "",
        name: `${source.name} 副本`,
        sort: Number(source.sort || 100) + 1,
      },
    },
    listed.categories
  );
}

async function reorderServices(ids) {
  const ordered = (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ordered.length) throw Object.assign(new Error("缺少排序列表。"), { status: 400 });
  if (!hasDb()) throw Object.assign(new Error("数据库未配置。"), { status: 503 });
  try {
    await Promise.all(
      ordered.map((id, index) =>
        supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ sort: index + 1, updated_at: new Date().toISOString() }),
        })
      )
    );
    return { source: "supabase" };
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("services 表未初始化。请先执行 supabase/services.sql。"), { status: 503 });
    }
    throw error;
  }
}

async function addCategory(name) {
  const category = String(name || "").trim();
  if (!category) throw Object.assign(new Error("请填写分类名称。"), { status: 400 });
  await ensureCategory(category);
  const result = await listCategories();
  return result;
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    if (req.method === "GET") {
      const result = await listServices();
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save");
    const categories = (await listCategories()).categories;

    if (action === "save" || action === "create") {
      const result = await saveService(body, categories);
      return json(res, 200, {
        ok: true,
        message: body.id || body.service?.id ? "服务已保存，全站已同步。" : "服务已新增，全站已同步。",
        ...result,
      });
    }

    if (action === "add_category") {
      const result = await addCategory(body.name || body.category);
      return json(res, 200, { ok: true, message: "分类已添加", ...result });
    }

    if (action === "reorder") {
      const result = await reorderServices(body.ids || body.order || []);
      return json(res, 200, { ok: true, message: "排序已更新，首页将同步。", ...result });
    }

    const id = String(body.id || "").trim();
    if (!id) return json(res, 400, { ok: false, message: "缺少服务 ID。" });

    if (action === "duplicate" || action === "copy") {
      const result = await duplicateService(id);
      return json(res, 200, { ok: true, message: "已复制服务", ...result });
    }

    if (action === "enable" || action === "disable" || action === "toggle") {
      const enabled = action === "enable" ? true : action === "disable" ? false : Boolean(body.enabled ?? body.isActive);
      const result = await toggleService(id, enabled);
      return json(res, 200, { ok: true, message: enabled ? "已启用" : "已停用", ...result });
    }

    if (action === "delete") {
      const result = await deleteService(id);
      return json(res, 200, { ok: true, message: "服务已删除", ...result });
    }

    return json(res, 400, { ok: false, message: "未知服务操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "服务管理接口异常" });
  }
}
