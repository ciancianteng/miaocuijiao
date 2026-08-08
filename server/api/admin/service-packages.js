import fs from "node:fs";
import path from "node:path";

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
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0", Prefer: "return=representation", ...extra };
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
    const base = parts[0] || "Supabase 请求失败";
    const code = body?.code ? ` [${body.code}]` : "";
    const message = `${base}${code} (HTTP ${response.status})`;
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

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}

async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录管理员账号。"), { status: 401 });
  const authUser = await supabaseJson(authUrl("user"), { headers: authHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权管理更多玩法。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号未启用。"), { status: 403 });
  return profile;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(input = {}) {
  const name = String(input.name || "").trim();
  const game = String(input.game || "").trim();
  const fixedPrice = number(input.fixedPrice ?? input.fixed_price, 0);
  const durationMinutes = number(input.durationMinutes ?? input.duration_minutes, 60);
  if (!name) throw Object.assign(new Error("请填写玩法名称。"), { status: 400 });
  if (!game) throw Object.assign(new Error("请填写所属游戏。"), { status: 400 });
  if (fixedPrice <= 0) throw Object.assign(new Error("固定价格必须大于 0。"), { status: 400 });
  if (durationMinutes <= 0) throw Object.assign(new Error("服务时长必须大于 0。"), { status: 400 });
  return {
    name,
    game,
    category: String(input.category || "").trim(),
    fixed_price: fixedPrice,
    duration_minutes: durationMinutes,
    level_min: Math.max(1, Math.min(5, number(input.levelMin ?? input.level_min, 1))),
    level_max: Math.max(1, Math.min(5, number(input.levelMax ?? input.level_max, 5))),
    description: String(input.description || "").trim(),
    sort_order: number(input.sortOrder ?? input.sort_order, 100),
    is_active: input.isActive ?? input.is_active ?? true ? true : false,
    updated_at: new Date().toISOString(),
  };
}

function view(row = {}) {
  return {
    id: row.id,
    name: row.name || "",
    game: row.game || "",
    category: row.category || "",
    fixedPrice: number(row.fixed_price),
    durationMinutes: number(row.duration_minutes),
    levelMin: number(row.level_min, 1),
    levelMax: number(row.level_max, 5),
    description: row.description || "",
    sortOrder: number(row.sort_order, 100),
    isActive: row.is_active !== false,
    updatedAt: row.updated_at || "",
  };
}

async function listPackages() {
  const rows = await supabaseJson(restUrl("service_packages", "?order=sort_order.asc,updated_at.desc"), { headers: serviceHeaders() });
  return (Array.isArray(rows) ? rows : []).map(view);
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, message: "Supabase 未配置，无法管理更多玩法。" });
  try {
    await requireAdmin(req);
    if (req.method === "GET") return json(res, 200, { ok: true, packages: await listPackages() });
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "save");
    if (action === "save") {
      const payload = clean(body.package || body);
      if (body.id || body.package?.id) {
        const id = String(body.id || body.package.id);
        const rows = await supabaseJson(restUrl("service_packages", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(payload),
        });
        return json(res, 200, { ok: true, message: "更多玩法已保存", package: view(rows?.[0]) });
      }
      const rows = await supabaseJson(restUrl("service_packages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
      });
      return json(res, 200, { ok: true, message: "更多玩法已新增", package: view(rows?.[0]) });
    }
    const id = String(body.id || "");
    if (!id) return json(res, 400, { ok: false, message: "缺少玩法 ID。" });
    if (action === "toggle") {
      const rows = await supabaseJson(restUrl("service_packages", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ is_active: Boolean(body.isActive), updated_at: new Date().toISOString() }),
      });
      return json(res, 200, { ok: true, message: Boolean(body.isActive) ? "已启用" : "已停用", package: view(rows?.[0]) });
    }
    if (action === "delete") {
      await supabaseJson(restUrl("service_packages", `?id=eq.${encodeURIComponent(id)}`), { method: "DELETE", headers: serviceHeaders() });
      return json(res, 200, { ok: true, message: "更多玩法已删除" });
    }
    return json(res, 400, { ok: false, message: "未知更多玩法操作。" });
  } catch (error) {
    if (isMissingTable(error)) return json(res, 503, { ok: false, packages: [], message: "service_packages 表未初始化，请先执行 supabase/init.sql 中的更多玩法表结构。" });
    return json(res, error.status || 500, { ok: false, message: error.message || "更多玩法管理接口异常" });
  }
}
