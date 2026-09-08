import fs from "node:fs";
import path from "node:path";
import {
  indexProfilesForStats,
  isTestAccountRecord,
} from "../_test-accounts.js";
import { buildDashboardStats } from "../admin/dashboard.js";
import { PLATFORM_STATS_TIMEZONE, localDateYmd } from "../_platform-day.js";

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

function isMissingColumnError(error) {
  const msg = String(error?.message || error || "");
  return /is_test_account|Could not find the '|schema cache|PGRST204|42703/i.test(msg);
}

async function loadProfiles() {
  const withFlag = "?select=id,role,email,display_name,is_test_account&limit=5000";
  const withoutFlag = "?select=id,role,email,display_name&limit=5000";
  try {
    return await supabaseJson(restUrl("profiles", withFlag));
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return await supabaseJson(restUrl("profiles", withoutFlag));
  }
}

async function loadOrders() {
  const full =
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id,player_income,companion_income,platform_fee,platform_commission&order=created_at.desc&limit=5000";
  const basic =
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id&order=created_at.desc&limit=5000";
  try {
    return await supabaseJson(restUrl("orders", full));
  } catch {
    return await supabaseJson(restUrl("orders", basic)).catch(() => []);
  }
}

async function loadCompanionsOnline(profiles) {
  const { byId, testIds } = indexProfilesForStats(profiles || []);
  const queries = [
    "?select=id,user_id,online_status,availability_status,is_test_account&limit=5000",
    "?select=id,user_id,online_status,availability_status&limit=5000",
    "?select=id,user_id,online_status&limit=5000",
  ];
  let rows = [];
  for (const q of queries) {
    try {
      rows = await supabaseJson(restUrl("companion_profiles", q));
      break;
    } catch {
      rows = [];
    }
  }
  return (rows || []).filter((c) => {
    const uid = c.user_id || c.id;
    if (uid && testIds.has(uid)) return false;
    if (c.is_test_account === true || c.is_test === true) return false;
    const profile = uid ? byId.get(uid) : null;
    if (profile && isTestAccountRecord(profile)) return false;
    const status = String(c.availability_status || c.online_status || "").toLowerCase();
    return status === "online" || /在线/.test(status);
  }).length;
}

/** Pure builder — shared with offline verification. */
export function buildHomeDailyStatsPayload({
  profiles = [],
  orders = [],
  onlineCompanions = 0,
  now = new Date(),
  timeZone = PLATFORM_STATS_TIMEZONE,
} = {}) {
  const { stats, filter } = buildDashboardStats({ profiles, orders, withdrawals: [], now, timeZone });
  const date = localDateYmd(now, timeZone);
  return {
    ok: true,
    configured: true,
    date,
    timezone: timeZone,
    updatedAt: now instanceof Date ? now.toISOString() : new Date().toISOString(),
    // Same口径 as admin dashboard (今日有效订单 / 今日营业额)
    ordersCreated: stats.todayOrders,
    todayOrders: stats.todayOrders,
    grossRevenue: stats.todayAmount,
    todayAmount: stats.todayAmount,
    onlineCompanions: Math.max(0, Number(onlineCompanions) || 0),
    filter: {
      ...filter,
      source: "admin_dashboard_buildDashboardStats",
      revenueRule: "countsAsRevenue (excludes awaiting_payment/cancelled/expired/refunded)",
      dayRule: `local calendar day in ${timeZone}`,
    },
    currency: "CATFOOD",
  };
}

// Re-export for offline verification.
export { buildDashboardStats, localDateYmd, PLATFORM_STATS_TIMEZONE };

export default async function handler(req, res) {
  const timeZone = process.env.HOME_STATS_TIMEZONE || PLATFORM_STATS_TIMEZONE;
  const now = new Date();
  const date = localDateYmd(now, timeZone);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Method Not Allowed", date, timezone: timeZone });
  }

  if (!hasDb()) {
    // Fail closed — never invent mock/demo stats.
    return res.status(503).json({
      ok: false,
      configured: false,
      message: "数据库未配置，主页不展示假今日数据",
      date,
      timezone: timeZone,
    });
  }

  try {
    const [profiles, orders] = await Promise.all([loadProfiles(), loadOrders()]);
    const onlineCompanions = await loadCompanionsOnline(profiles);
    const payload = buildHomeDailyStatsPayload({
      profiles,
      orders,
      onlineCompanions,
      now,
      timeZone,
    });
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      configured: true,
      message: error.message || "今日平台数据加载失败",
      date,
      timezone: timeZone,
    });
  }
}
