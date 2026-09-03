import {
  filterBusinessProfiles,
  indexProfilesForStats,
  isTestTouchedOrder,
} from "../_test-accounts.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const ZERO = {
  bosses: 0,
  companions: 0,
  customerServices: 0,
  todayOrders: 0,
  awaitingPayment: 0,
  pendingOrders: 0,
  inProgress: 0,
  completed: 0,
  refunds: 0,
  totalAmount: 0,
};
function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
function supabaseError(body, response) {
  const parts = [
    body?.error_description,
    body?.msg,
    body?.message,
    body?.error,
    body?.hint,
    body?.details,
    typeof body === "string" ? body : "",
  ].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
  return body;
}
function isMissingColumnError(error) {
  const msg = String(error?.message || error || "");
  return /is_test_account|Could not find the '|schema cache|PGRST204|42703/i.test(msg);
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问后台。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
/** Revenue: paid / in service / completed. Exclude unpaid drafts and cancelled. */
function countsAsRevenue(order = {}) {
  const s = String(order.status || "");
  if (!s) return false;
  if (["awaiting_payment", "cancelled", "expired", "refunded"].includes(s)) return false;
  // pending (大厅) may be unpaid open-grab after proof — still count after payment sync
  return ["pending", "waiting_boss_confirm", "claimed", "confirmed", "in_progress", "completed", "refund_requested"].includes(s) || !["awaiting_payment","cancelled","expired"].includes(s);
}
function platformProfitOf(order = {}) {
  const gross = money(order.total_amount);
  const companion = money(order.player_income != null ? order.player_income : order.companion_income);
  const fee = money(order.platform_fee != null ? order.platform_fee : order.platform_commission);
  if (fee > 0) return fee;
  if (companion > 0) return Math.max(0, gross - companion);
  // default 20% platform share when breakdown missing
  return Math.round(gross * 0.2 * 100) / 100;
}

async function loadProfilesForStats() {
  const withFlag =
    "?select=id,role,email,display_name,is_test_account&limit=5000";
  const withoutFlag = "?select=id,role,email,display_name&limit=5000";
  try {
    return await supabaseJson(restUrl("profiles", withFlag), { headers: serviceHeaders() });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return await supabaseJson(restUrl("profiles", withoutFlag), { headers: serviceHeaders() });
  }
}

/**
 * Aggregate dashboard stats with smoke / @meow.test / is_test_account excluded.
 * Exported for unit verification without HTTP.
 */
export function buildDashboardStats({ profiles = [], orders = [], withdrawals = [], now = new Date() } = {}) {
  const { byId, testIds } = indexProfilesForStats(profiles);
  const businessOrders = (orders || []).filter((o) => !isTestTouchedOrder(o, testIds, byId));
  const today = now.toISOString().slice(0, 10);
  const revenueOrders = businessOrders.filter((o) => countsAsRevenue(o));
  const paidToday = revenueOrders.filter((o) => String(o.created_at || "").slice(0, 10) === today);
  const wd = Array.isArray(withdrawals) ? withdrawals : [];
  const withdrawPending = wd
    .filter((w) => !["completed", "paid", "rejected", "cancelled", "pay_failed"].includes(String(w.status || "")))
    .reduce((sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm), 0);
  const withdrawPaid = wd
    .filter((w) => ["completed", "paid", "paid_pending_receipt"].includes(String(w.status || "")))
    .reduce((sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm), 0);
  const platformProfit = revenueOrders.reduce((sum, o) => sum + platformProfitOf(o), 0);
  const bosses = filterBusinessProfiles(profiles, "boss");
  const companions = filterBusinessProfiles(profiles, "companion");
  const customerServices = filterBusinessProfiles(profiles, "customer_service");
  return {
    stats: {
      bosses: bosses.length,
      companions: companions.length,
      customerServices: customerServices.length,
      todayOrders: paidToday.length,
      awaitingPayment: businessOrders.filter((o) => o.status === "awaiting_payment").length,
      pendingOrders: businessOrders.filter((o) => o.status === "pending").length,
      inProgress: businessOrders.filter((o) => o.status === "in_progress").length,
      completed: businessOrders.filter((o) => o.status === "completed").length,
      refunds: businessOrders.filter((o) => o.status === "refund_requested" || o.status === "refunded").length,
      totalAmount: revenueOrders.reduce((sum, o) => sum + money(o.total_amount), 0),
      todayAmount: paidToday.reduce((sum, o) => sum + money(o.total_amount), 0),
      platformProfit: Math.round(platformProfit * 100) / 100,
      withdrawPending: Math.round(withdrawPending * 100) / 100,
      withdrawPaid: Math.round(withdrawPaid * 100) / 100,
    },
    filter: {
      testAccountsExcluded: true,
      excludedBosses: (profiles || []).filter((p) => p.role === "boss").length - bosses.length,
      excludedCompanions: (profiles || []).filter((p) => p.role === "companion").length - companions.length,
      excludedCustomerServices:
        (profiles || []).filter((p) => p.role === "customer_service").length - customerServices.length,
      excludedOrders: (orders || []).length - businessOrders.length,
    },
  };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 200, {
      ok: true,
      configured: false,
      stats: ZERO,
      message: "未配置 Supabase，后台首页只显示 0，不返回假统计。",
    });
  }
  try {
    await requireAdmin(req);
    const [profiles, orders, withdrawals] = await Promise.all([
      loadProfilesForStats(),
      loadOrdersForStats(),
      supabaseJson(restUrl("withdrawals", "?select=id,status,net_amount_rm,cat_food_amount,amount_rm&limit=2000"), {
        headers: serviceHeaders(),
      }).catch(() => []),
    ]);
    const { stats, filter } = buildDashboardStats({ profiles, orders, withdrawals });
    return json(res, 200, { ok: true, configured: true, stats, filter });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "后台统计接口异常。" });
  }
}

async function loadOrdersForStats() {
  const full =
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id,player_income,companion_income,platform_fee,platform_commission&order=created_at.desc&limit=5000";
  const basic =
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id&order=created_at.desc&limit=5000";
  try {
    return await supabaseJson(restUrl("orders", full), { headers: serviceHeaders() });
  } catch {
    return await supabaseJson(restUrl("orders", basic), { headers: serviceHeaders() }).catch(() => []);
  }
}
