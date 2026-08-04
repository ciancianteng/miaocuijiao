import fs from "node:fs";
import path from "node:path";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

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

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function json(res, status, data) {
  res.status(status).json(data);
}

function anonHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
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

function nowIso() {
  return new Date().toISOString();
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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
    const msg =
      body?.error_description ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      `${response.status} ${response.statusText}`;
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  return body;
}

function isAuthTokenFailure(message, status) {
  const text = String(message || "").toLowerCase();
  if (Number(status) === 401) return true;
  return (
    text.includes("403 forbidden") ||
    text.includes("jwt") ||
    text.includes("expired") ||
    text.includes("invalid claim") ||
    text.includes("unable to parse") ||
    text.includes("invalid token") ||
    text.includes("not authenticated")
  );
}

async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录。"), { status: 401 });
  let authUser;
  try {
    authUser = await supabaseJson(authUrl("user"), {
      headers: anonHeaders({ Authorization: `Bearer ${token}` }),
    });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (isAuthTokenFailure(message, error?.status)) {
      throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401 });
    }
    throw Object.assign(new Error(message || "登录校验失败。"), { status: 401 });
  }
  if (!authUser?.id) throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401 });
  const rows = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("账号未启用。"), { status: 403 });
  if (profile.role !== "boss") {
    throw Object.assign(new Error("只有老板账号可以查看通知。"), { status: 403 });
  }
  return profile;
}

function mapRow(row) {
  return {
    id: row.id,
    title: row.title || "通知",
    body: row.body || "",
    kind: row.kind || "system",
    relatedId: row.related_id || "",
    readAt: row.read_at || null,
    read: !!row.read_at,
    createdAt: row.created_at || "",
  };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, {
      ok: false,
      configured: false,
      message: "通知暂时无法加载，请稍后重试",
    });
  }

  try {
    const profile = await profileFromToken(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(
      (req.method === "GET" ? req.query.action : body.action) || "list"
    ).trim();

    if (req.method === "GET" && (action === "list" || action === "unread")) {
      const rows = await supabaseJson(
        restUrl(
          "boss_notifications",
          `?boss_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=50`
        ),
        { headers: serviceHeaders() }
      ).catch((err) => {
        if (/does not exist|Could not find the table|schema cache/i.test(String(err.message || ""))) {
          return [];
        }
        throw err;
      });
      const items = (Array.isArray(rows) ? rows : []).map(mapRow);
      const unread = items.filter((item) => !item.read).length;
      return json(res, 200, { ok: true, items, unread });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    if (action === "mark_read" || action === "read") {
      const id = String(body.id || body.notification_id || "").trim();
      if (id) {
        await supabaseJson(
          restUrl(
            "boss_notifications",
            `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`
          ),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ read_at: nowIso() }),
          }
        );
      }
      return json(res, 200, { ok: true, message: "已标记已读" });
    }

    if (action === "mark_all_read" || action === "read_all") {
      await supabaseJson(
        restUrl(
          "boss_notifications",
          `?boss_id=eq.${encodeURIComponent(profile.id)}&read_at=is.null`
        ),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ read_at: nowIso() }),
        }
      );
      return json(res, 200, { ok: true, message: "全部已读" });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "通知暂时无法加载，请稍后重试",
    });
  }
}
