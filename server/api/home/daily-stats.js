import fs from "node:fs";
import path from "node:path";

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

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function hasDb() {
  return REQUIRED_ENV.every((key) => env(key));
}

function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function restUrl(table, query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function todayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function supabaseJson(url) {
  const response = await fetch(url, { headers: serviceHeaders() });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.hint || text || `HTTP ${response.status}`), {
      status: response.status,
    });
  }
  return Array.isArray(body) ? body : [];
}

export default async function handler(req, res) {
  const timezone = process.env.HOME_STATS_TIMEZONE || "Asia/Kuala_Lumpur";
  const date = todayInTimezone(timezone);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!hasDb()) {
    return res.status(503).json({
      ok: false,
      configured: false,
      message: "数据库未配置",
      date,
      timezone,
    });
  }

  try {
    const dayStart = `${date}T00:00:00.000Z`;
    const [profiles, companions, orders] = await Promise.all([
      supabaseJson(restUrl("profiles", "?select=id,role,created_at&limit=5000")),
      supabaseJson(
        restUrl("companion_profiles", "?select=id,online_status,created_at,user_id&limit=5000")
      ).catch(() => []),
      supabaseJson(restUrl("orders", "?select=id,status,total_amount,created_at&order=created_at.desc&limit=5000")).catch(
        () => []
      ),
    ]);

    const ordersToday = orders.filter((o) => String(o.created_at || "").slice(0, 10) === date);
    const payload = {
      ok: true,
      configured: true,
      date,
      timezone,
      ordersCreated: ordersToday.length,
      ordersCompleted: ordersToday.filter((o) => o.status === "completed").length,
      newCustomers: profiles.filter((p) => p.role === "boss" && String(p.created_at || "").slice(0, 10) === date).length,
      newCompanions: profiles.filter((p) => p.role === "companion" && String(p.created_at || "").slice(0, 10) === date)
        .length,
      onlineCompanions: companions.filter((c) => /online|在线/i.test(String(c.online_status || ""))).length,
      grossRevenue: ordersToday.reduce((sum, o) => sum + money(o.total_amount), 0),
      currency: process.env.HOME_STATS_CURRENCY || "MYR",
    };
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      configured: true,
      message: error.message || "今日平台数据加载失败",
      date,
      timezone,
    });
  }
}
