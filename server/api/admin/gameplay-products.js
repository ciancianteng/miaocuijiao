import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CATEGORIES,
  PRICING_UNITS,
  normalizeProductRow,
  toPublicProduct,
  toDbRow,
  fromDbRow,
  readLocalProducts,
  updateLocalProducts,
} from "../_gameplay-products-store.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

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
    const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
    throw Object.assign(new Error(`${parts[0] || "Supabase 请求失败"}${body?.code ? ` [${body.code}]` : ""} (HTTP ${response.status})`), {
      status: response.status,
      body,
    });
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
  if (!hasDb()) throw Object.assign(new Error("未配置数据库，无法校验管理员身份。"), { status: 503 });
  const authUser = await supabaseJson(authUrl("user"), { headers: authHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权管理更多玩法商品。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号未启用。"), { status: 403 });
  return profile;
}

function cleanProduct(input = {}, { keepId = "" } = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw Object.assign(new Error("请填写商品名称。"), { status: 400 });
  const shortDescription = String(input.shortDescription || input.short_description || "").trim().slice(0, 40);
  if (!shortDescription) throw Object.assign(new Error("请填写商品简介（40 字以内）。"), { status: 400 });
  let status = String(input.status || "published").trim().toLowerCase();
  if (["draft", "草稿"].includes(status)) status = "draft";
  else if (["unpublished", "下架", "disabled"].includes(status) || input.enabled === false) status = "unpublished";
  else if (["deleted"].includes(status)) status = "deleted";
  else status = "published";
  return normalizeProductRow({
    ...input,
    id: keepId || input.id || randomUUID(),
    name,
    shortDescription,
    status,
    updatedAt: new Date().toISOString(),
  });
}

async function listProducts() {
  if (hasDb()) {
    try {
      const rows = await supabaseJson(restUrl("gameplay_products", "?or=(deleted_at.is.null,status.neq.deleted)&order=sort_order.asc,updated_at.desc"), {
        headers: serviceHeaders(),
      });
      return {
        products: (Array.isArray(rows) ? rows : []).map(fromDbRow).filter((item) => item.status !== "deleted").map((item) => toPublicProduct(item, { admin: true })),
        source: "supabase",
      };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  const rows = await readLocalProducts();
  return {
    products: rows.filter((item) => item.status !== "deleted").map((item) => toPublicProduct(item, { admin: true })),
    source: "local",
    message: hasDb()
      ? "gameplay_products 表未初始化，已使用本地商品数据。请执行 supabase/gameplay-products.sql。"
      : "Supabase 未配置，当前使用本地商品数据。",
  };
}

async function saveProduct(body) {
  const id = String(body.id || body.product?.id || "").trim();
  const product = cleanProduct(body.product || body, { keepId: id });
  const dbPayload = toDbRow(product);
  delete dbPayload.created_at;
  if (!id) dbPayload.created_at = new Date().toISOString();

  if (hasDb()) {
    try {
      if (id) {
        const rows = await supabaseJson(restUrl("gameplay_products", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(dbPayload),
        });
        return { product: toPublicProduct(fromDbRow(rows?.[0] || dbPayload), { admin: true }), source: "supabase" };
      }
      const rows = await supabaseJson(restUrl("gameplay_products"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...dbPayload, id: product.id, created_at: new Date().toISOString() }),
      });
      return { product: toPublicProduct(fromDbRow(rows?.[0] || dbPayload), { admin: true }), source: "supabase" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }

  return updateLocalProducts(async (list) => {
    const index = list.findIndex((row) => String(row.id) === String(product.id));
    if (index >= 0) {
      product.createdAt = list[index].createdAt;
      product.soldCount = list[index].soldCount;
      list[index] = product;
    } else {
      list.unshift(product);
    }
    return { product: toPublicProduct(product, { admin: true }), source: "local" };
  });
}

async function setStatus(id, status) {
  if (!id) throw Object.assign(new Error("缺少商品 ID。"), { status: 400 });
  const next = status === "published" ? "published" : status === "draft" ? "draft" : "unpublished";
  if (hasDb()) {
    try {
      const rows = await supabaseJson(restUrl("gameplay_products", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: next, deleted_at: null, updated_at: new Date().toISOString() }),
      });
      return { product: toPublicProduct(fromDbRow(rows?.[0] || { id, status: next }), { admin: true }), source: "supabase" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  return updateLocalProducts(async (list) => {
    const item = list.find((row) => String(row.id) === String(id));
    if (!item) throw Object.assign(new Error("商品不存在。"), { status: 404 });
    item.status = next;
    item.deletedAt = null;
    item.updatedAt = new Date().toISOString();
    return { product: toPublicProduct(item, { admin: true }), source: "local" };
  });
}

async function duplicateProduct(id) {
  if (!id) throw Object.assign(new Error("缺少商品 ID。"), { status: 400 });
  const listed = await listProducts();
  const source = listed.products.find((item) => String(item.id) === String(id));
  if (!source) throw Object.assign(new Error("商品不存在。"), { status: 404 });
  return saveProduct({
    product: {
      ...source,
      id: randomUUID(),
      name: `${source.name} 副本`,
      status: "draft",
      soldCount: 0,
      featured: false,
    },
  });
}

async function softDelete(id) {
  if (!id) throw Object.assign(new Error("缺少商品 ID。"), { status: 400 });
  const now = new Date().toISOString();
  if (hasDb()) {
    try {
      const rows = await supabaseJson(restUrl("gameplay_products", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: "deleted", deleted_at: now, updated_at: now }),
      });
      return { product: toPublicProduct(fromDbRow(rows?.[0] || { id, status: "deleted", deleted_at: now }), { admin: true }), source: "supabase" };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
  }
  return updateLocalProducts(async (list) => {
    const item = list.find((row) => String(row.id) === String(id));
    if (!item) throw Object.assign(new Error("商品不存在。"), { status: 404 });
    item.status = "deleted";
    item.deletedAt = now;
    item.updatedAt = now;
    return { product: toPublicProduct(item, { admin: true }), source: "local" };
  });
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    if (req.method === "GET") {
      const result = await listProducts();
      return json(res, 200, { ok: true, categories: CATEGORIES, pricingUnits: PRICING_UNITS, ...result });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "save" || action === "create") {
      const result = await saveProduct(body);
      return json(res, 200, { ok: true, message: "商品已保存", ...result });
    }
    if (action === "publish" || action === "enable") {
      const result = await setStatus(String(body.id || ""), "published");
      return json(res, 200, { ok: true, message: "已上架", ...result });
    }
    if (action === "unpublish" || action === "disable") {
      const result = await setStatus(String(body.id || ""), "unpublished");
      return json(res, 200, { ok: true, message: "已下架", ...result });
    }
    if (action === "duplicate" || action === "copy") {
      const result = await duplicateProduct(String(body.id || ""));
      return json(res, 200, { ok: true, message: "已复制商品", ...result });
    }
    if (action === "delete") {
      const result = await softDelete(String(body.id || ""));
      return json(res, 200, { ok: true, message: "商品已软删除（下架保留历史）", ...result });
    }

    return json(res, 400, { ok: false, message: "未知操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "更多玩法商品接口异常" });
  }
}
