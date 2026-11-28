import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ROWS,
  DEFAULT_ICONS,
  DISPLAY_POSITIONS,
  normalizeServiceRow,
  readLocalServices,
  readLocalCategories,
  readLocalCategoryRows,
  writeLocalCategories,
  writeLocalCategoryRows,
} from "../_services-store.js";
import { normalizeCategoryRow } from "../_price-table-catalog.js";

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
  const rawPrice = String(input.defaultPrice ?? input.default_price ?? "").trim();
  if (rawPrice) {
    const amount = Number(rawPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error("服务价格必须是大于或等于 0 的数字。"), { status: 400 });
    }
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

async function listCategoryRows({ includeDisabled = true } = {}) {
  if (hasDb()) {
    try {
      const query = includeDisabled
        ? "?order=sort_order.asc,name.asc"
        : "?is_enabled=eq.true&order=sort_order.asc,name.asc";
      const rows = await supabaseJson(restUrl("service_categories", query), {
        headers: serviceHeaders(),
      });
      const mapped = (Array.isArray(rows) ? rows : []).map((row, i) => normalizeCategoryRow(row, i));
      if (mapped.length) return { categoryRows: mapped, categories: mapped.map((r) => r.name), source: "supabase" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
    try {
      const services = await supabaseJson(restUrl("services", "?select=category"), { headers: serviceHeaders() });
      const fromServices = Array.from(
        new Set((Array.isArray(services) ? services : []).map((row) => String(row.category || "").trim()).filter(Boolean))
      );
      const seed = DEFAULT_CATEGORY_ROWS.map((row, i) => normalizeCategoryRow(row, i));
      const byName = new Map(seed.map((r) => [r.name, r]));
      fromServices.forEach((name, i) => {
        if (!byName.has(name)) byName.set(name, normalizeCategoryRow({ name, sort: 100 + i, enabled: true }, seed.length + i));
      });
      const mapped = Array.from(byName.values()).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh"));
      return { categoryRows: mapped, categories: mapped.map((r) => r.name), source: "supabase-derived" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const localRows = await readLocalCategoryRows();
  const mapped = (localRows.length ? localRows : DEFAULT_CATEGORY_ROWS).map((row, i) => normalizeCategoryRow(row, i));
  return { categoryRows: mapped, categories: mapped.map((r) => r.name), source: "local" };
}

async function listCategories() {
  const result = await listCategoryRows({ includeDisabled: true });
  return { categories: result.categories, categoryRows: result.categoryRows, source: result.source };
}

async function ensureCategory(name, { sort = 100, enabled = true } = {}) {
  const category = String(name || "").trim();
  if (!category) return;
  if (hasDb()) {
    try {
      await supabaseJson(restUrl("service_categories?on_conflict=name"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({
          name: category,
          sort_order: Number(sort) || 100,
          is_enabled: enabled !== false,
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    } catch (error) {
      if (!isMissingTable(error)) {
        if (!/duplicate|unique/i.test(error.message || "")) throw error;
        return;
      }
    }
  }
  const list = await readLocalCategoryRows();
  if (!list.some((row) => row.name === category)) {
    list.push({ name: category, sort: Number(sort) || list.length + 1, enabled: enabled !== false });
    await writeLocalCategoryRows(list);
  }
}

async function countServicesInCategory(name) {
  const category = String(name || "").trim();
  if (!category) return 0;
  if (hasDb()) {
    try {
      const rows = await supabaseJson(
        restUrl("services", `?select=id&category=eq.${encodeURIComponent(category)}`),
        { headers: serviceHeaders() }
      );
      return Array.isArray(rows) ? rows.length : 0;
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const services = await readLocalServices();
  return services.filter((row) => String(row.category || "").trim() === category).length;
}

async function reassignServicesCategory(fromName, toName) {
  const from = String(fromName || "").trim();
  const to = String(toName || "").trim();
  if (!from || !to || from === to) return 0;
  if (hasDb()) {
    try {
      const updated = await supabaseJson(restUrl("services", `?category=eq.${encodeURIComponent(from)}`), {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ category: to, updated_at: new Date().toISOString() }),
      });
      return Array.isArray(updated) ? updated.length : 0;
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const list = await readLocalServices();
  let count = 0;
  for (const row of list) {
    if (String(row.category || "").trim() === from) {
      row.category = to;
      row.updated_at = new Date().toISOString();
      count += 1;
    }
  }
  if (count) {
    const { writeLocalServices } = await import("../_services-store.js");
    await writeLocalServices(list);
  }
  return count;
}

async function updateCategoryRecord({ id, name, newName, sort, enabled }) {
  const currentName = String(name || "").trim();
  const nextName = String(newName || currentName || "").trim();
  if (!currentName && !id) throw Object.assign(new Error("缺少分类。"), { status: 400 });
  if (!nextName) throw Object.assign(new Error("请填写分类名称。"), { status: 400 });
  const sortOrder = Number(sort);
  const isEnabled = enabled === undefined ? undefined : enabled !== false;

  if (hasDb()) {
    try {
      const filter = id
        ? `?id=eq.${encodeURIComponent(id)}`
        : `?name=eq.${encodeURIComponent(currentName)}`;
      const payload = { updated_at: new Date().toISOString() };
      if (nextName) payload.name = nextName;
      if (Number.isFinite(sortOrder)) payload.sort_order = sortOrder;
      if (isEnabled !== undefined) payload.is_enabled = isEnabled;
      await supabaseJson(restUrl("service_categories", filter), {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify(payload),
      });
      if (currentName && nextName && currentName !== nextName) {
        await reassignServicesCategory(currentName, nextName);
      }
      return listCategoryRows({ includeDisabled: true });
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }

  const rows = await readLocalCategoryRows();
  const idx = rows.findIndex((row) => (id && String(row.id) === String(id)) || row.name === currentName);
  if (idx < 0) throw Object.assign(new Error("分类不存在。"), { status: 404 });
  const prev = rows[idx].name;
  rows[idx] = {
    ...rows[idx],
    name: nextName,
    sort: Number.isFinite(sortOrder) ? sortOrder : rows[idx].sort,
    enabled: isEnabled === undefined ? rows[idx].enabled !== false : isEnabled,
  };
  await writeLocalCategoryRows(rows);
  if (prev !== nextName) await reassignServicesCategory(prev, nextName);
  return listCategoryRows({ includeDisabled: true });
}

async function reorderCategoryRecords(names) {
  const order = (Array.isArray(names) ? names : []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!order.length) throw Object.assign(new Error("缺少分类顺序。"), { status: 400 });
  if (hasDb()) {
    try {
      for (let i = 0; i < order.length; i += 1) {
        await supabaseJson(restUrl("service_categories", `?name=eq.${encodeURIComponent(order[i])}`), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ sort_order: i + 1, updated_at: new Date().toISOString() }),
        });
      }
      return listCategoryRows({ includeDisabled: true });
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const rows = await readLocalCategoryRows();
  const byName = new Map(rows.map((r) => [r.name, r]));
  const next = order.map((name, i) => {
    const hit = byName.get(name) || { name, enabled: true };
    return { ...hit, sort: i + 1 };
  });
  rows.forEach((row) => {
    if (!order.includes(row.name)) next.push({ ...row, sort: next.length + 1 });
  });
  await writeLocalCategoryRows(next);
  return listCategoryRows({ includeDisabled: true });
}

async function deleteCategoryRecord({ name, id, reassignTo }) {
  const currentName = String(name || "").trim();
  if (!currentName && !id) throw Object.assign(new Error("缺少分类。"), { status: 400 });
  const target = String(reassignTo || "").trim();
  const count = await countServicesInCategory(currentName);
  if (count > 0 && !target) {
    throw Object.assign(
      new Error(`分类「${currentName}」下仍有 ${count} 个游戏服务。请先选择安全迁移目标分类，服务与价格不会被删除。`),
      { status: 400, serviceCount: count }
    );
  }
  if (count > 0 && target === currentName) {
    throw Object.assign(new Error("迁移目标不能与待删除分类相同。"), { status: 400 });
  }
  if (count > 0) {
    await ensureCategory(target);
    await reassignServicesCategory(currentName, target);
  }
  if (hasDb()) {
    try {
      const filter = id
        ? `?id=eq.${encodeURIComponent(id)}`
        : `?name=eq.${encodeURIComponent(currentName)}`;
      await supabaseJson(restUrl("service_categories", filter), {
        method: "DELETE",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
      });
      return { ...(await listCategoryRows({ includeDisabled: true })), reassigned: count, reassignTo: target || null };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const rows = await readLocalCategoryRows();
  const next = rows.filter((row) => (id ? String(row.id) !== String(id) : row.name !== currentName));
  await writeLocalCategoryRows(next);
  return { ...(await listCategoryRows({ includeDisabled: true })), reassigned: count, reassignTo: target || null };
}

async function listFromDb() {
  const rows = await supabaseJson(restUrl("services", "?order=sort.asc,updated_at.desc"), { headers: serviceHeaders() });
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    try {
      out.push(view(row));
    } catch (err) {
      console.warn("[admin/services] skip bad service row", row?.id, err?.message || err);
    }
  }
  return out;
}

async function listServices() {
  let categoryResult;
  try {
    categoryResult = await listCategories();
  } catch (catErr) {
    // Categories must not blank the whole services page.
    console.warn("[admin/services] categories", catErr?.message || catErr);
    categoryResult = {
      categories: DEFAULT_CATEGORIES.slice(),
      categoryRows: DEFAULT_CATEGORY_ROWS.map((row, i) => normalizeCategoryRow(row, i)),
      source: "fallback",
    };
  }
  if (!hasDb()) {
    const rows = await readLocalServices();
    return {
      services: rows.map(view).sort((a, b) => a.sort - b.sort),
      categories: categoryResult.categories,
      categoryRows: categoryResult.categoryRows || [],
      icons: DEFAULT_ICONS,
      positions: DISPLAY_POSITIONS,
      source: "local",
      message: "数据库未配置，当前无法持久同步。请配置 Supabase 并执行 supabase/services.sql。",
    };
  }
  try {
    const services = await listFromDb();
    try {
      const { loadAllOrderFieldConfigs, normalizeOrderFields } = await import("../_order-requirements.js");
      const map = await loadAllOrderFieldConfigs();
      services.forEach((item) => {
        try {
          item.orderFields = normalizeOrderFields(map[item.id] || []);
        } catch {
          item.orderFields = [];
        }
      });
    } catch (fieldErr) {
      console.warn("[admin/services] order fields", fieldErr?.message || fieldErr);
    }
    try {
      const { loadAllPricePolicies, normalizePricePolicy } = await import("../_service-price-policy.js");
      const policies = await loadAllPricePolicies();
      services.forEach((item) => {
        try {
          item.pricePolicy = normalizePricePolicy(policies[item.id] || {});
        } catch {
          item.pricePolicy = {};
        }
      });
    } catch (priceErr) {
      console.warn("[admin/services] price policy", priceErr?.message || priceErr);
    }
    return {
      services,
      categories: categoryResult.categories,
      categoryRows: categoryResult.categoryRows || [],
      icons: DEFAULT_ICONS,
      positions: DISPLAY_POSITIONS,
      source: "supabase",
    };
  } catch (error) {
    if (!isMissingTable(error)) {
      // Surface a clear read failure — never pretend the catalog is empty.
      throw Object.assign(
        new Error(`服务列表读取失败：${error.message || "请稍后重试"}`),
        { status: error.status && error.status >= 400 ? error.status : 500 }
      );
    }
    return {
      services: [],
      categories: categoryResult.categories.length ? categoryResult.categories : DEFAULT_CATEGORIES.slice(),
      categoryRows: categoryResult.categoryRows || [],
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
  // Only treat as update when the client sends an explicit id.
  // normalizeServiceRow() used to invent a randomUUID for missing ids, which made
  // every "create" take the PATCH branch against a non-existent row (200 + []) and
  // return a fake success that never INSERTed.
  const id = String(body.id || body.service?.id || "").trim();
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
      const saved = Array.isArray(rows) ? rows[0] : rows;
      if (!saved?.id) {
        throw Object.assign(new Error("服务不存在或未写入，请刷新后重试。"), { status: 404 });
      }
      return { service: view(saved), source: "supabase" };
    }
    const rows = await supabaseJson(restUrl("services"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ ...dbBody, created_at: new Date().toISOString() }),
    });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    if (!saved?.id) {
      throw Object.assign(new Error("服务保存失败：数据库未返回新记录。"), { status: 502 });
    }
    return { service: view(saved), source: "supabase" };
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

async function countServiceUsage(id, name) {
  const serviceId = String(id || "").trim();
  const serviceName = String(name || "").trim();
  let companionRefs = 0;
  let orderRefs = 0;
  if (!hasDb() || !serviceId) return { companionRefs, orderRefs };
  try {
    const companions = await supabaseJson(
      restUrl("companion_profiles", `?select=id,service_ids&service_ids=cs.{${encodeURIComponent(serviceId)}}&limit=200`),
      { headers: serviceHeaders() }
    ).catch(() => null);
    if (Array.isArray(companions)) companionRefs = companions.length;
    else {
      const all = await supabaseJson(restUrl("companion_profiles", "?select=id,service_ids&limit=2000"), {
        headers: serviceHeaders(),
      }).catch(() => []);
      companionRefs = (Array.isArray(all) ? all : []).filter((row) => {
        const ids = row?.service_ids;
        if (Array.isArray(ids)) return ids.map(String).includes(serviceId);
        return String(ids || "").includes(serviceId);
      }).length;
    }
  } catch (err) {
    console.warn("[admin/services] companion usage", err?.message || err);
  }
  if (serviceName) {
    try {
      const orders = await supabaseJson(
        restUrl("orders", `?select=id&game=eq.${encodeURIComponent(serviceName)}&limit=1`),
        { headers: serviceHeaders({ Prefer: "count=exact" }) }
      ).catch(() => []);
      // Prefer header count when available; fall back to array length.
      orderRefs = Array.isArray(orders) ? orders.length : 0;
    } catch (err) {
      console.warn("[admin/services] order usage", err?.message || err);
    }
  }
  return { companionRefs, orderRefs };
}

async function deleteService(id, { force = false } = {}) {
  if (!hasDb()) throw Object.assign(new Error("数据库未配置。"), { status: 503 });
  try {
    const rows = await supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}&select=id,name&limit=1`), {
      headers: serviceHeaders(),
    });
    const current = Array.isArray(rows) ? rows[0] : null;
    if (!current?.id) throw Object.assign(new Error("服务不存在。"), { status: 404 });
    const usage = await countServiceUsage(current.id, current.name);
    if (!force && (usage.companionRefs > 0 || usage.orderRefs > 0)) {
      throw Object.assign(
        new Error(
          `该服务仍被引用：陪玩资料 ${usage.companionRefs}、同名订单样本 ${usage.orderRefs}。请先停用，或确认后强制删除（历史订单金额与快照仍保留）。`
        ),
        { status: 409, code: "SERVICE_IN_USE", usage }
      );
    }
    await supabaseJson(restUrl("services", `?id=eq.${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    return { source: "supabase", usage };
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

    if (action === "save_order_fields") {
      const serviceId = String(body.id || body.serviceId || "").trim();
      const { saveOrderFieldsForService } = await import("../_order-requirements.js");
      const orderFields = await saveOrderFieldsForService(serviceId, body.orderFields || body.fields || []);
      return json(res, 200, { ok: true, message: "订单要求已保存", orderFields });
    }

    if (action === "save" || action === "create") {
      const result = await saveService(body, categories);
      const serviceId = result?.service?.id;
      const src = body.service || body;
      if (serviceId) {
        const { savePricePolicy } = await import("../_service-price-policy.js");
        try {
          result.service.pricePolicy = await savePricePolicy(serviceId, src);
        } catch (priceErr) {
          const detail = String(priceErr?.message || "请重试").slice(0, 180);
          const message = priceErr?.status === 400 ? detail : `服务名称已写入，但价格、单位或介绍没有保存：${detail}`;
          throw Object.assign(new Error(message), { status: priceErr?.status || 500 });
        }
      }
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

    if (action === "update_category") {
      const result = await updateCategoryRecord({
        id: body.id,
        name: body.name || body.category,
        newName: body.newName || body.nextName || body.name || body.category,
        sort: body.sort ?? body.sort_order,
        enabled: body.enabled ?? body.is_enabled,
      });
      return json(res, 200, { ok: true, message: "分类已更新", ...result });
    }

    if (action === "toggle_category") {
      const result = await updateCategoryRecord({
        id: body.id,
        name: body.name || body.category,
        enabled: body.enabled ?? body.is_enabled ?? !(body.disable === true),
      });
      return json(res, 200, { ok: true, message: "分类启停已更新", ...result });
    }

    if (action === "reorder_categories") {
      const result = await reorderCategoryRecords(body.names || body.order || body.ids || []);
      return json(res, 200, { ok: true, message: "分类顺序已更新", ...result });
    }

    if (action === "delete_category") {
      const result = await deleteCategoryRecord({
        id: body.id,
        name: body.name || body.category,
        reassignTo: body.reassignTo || body.moveTo || body.targetCategory,
      });
      return json(res, 200, {
        ok: true,
        message: result.reassigned
          ? `分类已删除，已将 ${result.reassigned} 个游戏服务安全迁移到「${result.reassignTo}」。服务与价格均保留。`
          : "分类已删除（未连带删除任何游戏服务）。",
        ...result,
      });
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
      const force = body.force === true || body.confirmForce === true || body.forceDelete === true;
      const result = await deleteService(id, { force });
      return json(res, 200, { ok: true, message: "服务已删除", ...result });
    }

    return json(res, 400, { ok: false, message: "未知服务操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "服务管理接口异常" });
  }
}
