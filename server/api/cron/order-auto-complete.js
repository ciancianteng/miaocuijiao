/**
 * Cron / manual: auto-confirm orders after 24h with no dispute/aftersale pause.
 * GET|POST /api/cron/order-auto-complete
 */
import { createOrderCompleteHelpers } from "../_order-complete.js";

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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
  return `${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

async function supabaseJson(endpoint, opts = {}) {
  const response = await fetch(endpoint, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}

function authorized(req) {
  const secret = String(process.env.CRON_SECRET || process.env.MCJ_CRON_SECRET || "").trim();
  if (!secret) return true;
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const header = String(req.headers["x-cron-secret"] || "").trim();
  const q = String((req.query && req.query.secret) || "").trim();
  return (bearer && bearer[1].trim() === secret) || header === secret || q === secret;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!authorized(req)) {
    return json(res, 401, { ok: false, message: "Unauthorized cron" });
  }
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(res, 503, { ok: false, message: "数据库未配置" });
  }
  try {
    const helpers = createOrderCompleteHelpers({
      restUrl,
      supabaseJson,
      serviceHeaders,
      addSystemMessage: async () => {},
    });
    const out = await helpers.expireCompletionAutoConfirms({ limit: 80 });
    return json(res, 200, {
      ok: true,
      message: `自动确认扫描完成：到期 ${out.due}，处理 ${out.processed}`,
      ...out,
    });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "自动确认失败",
    });
  }
}
