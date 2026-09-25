/**
 * Admin dashboard aggregate stats.
 *
 * Business definitions (keep in sync with UI copy):
 * - boss_total: profiles.role='boss' AND status='active' AND NOT test account
 * - companion_total: approved companion_profiles (verification/application) joined to
 *   active non-test profiles — same SoT as public hall (role may still be 'boss')
 * - customer_service_total: profiles.role='customer_service' AND status='active' AND NOT test
 * - order counts / GMV: parent/standalone rows only (parent_order_id IS NULL);
 *   child multi-order lines are never double-counted
 * - awaiting_payment: parent status awaiting_payment
 * - waiting_companion (UI「等待陪玩确认」): parent status in pending|claimed
 * - in_progress: parent status in confirmed|in_progress
 * - completed / refunds: parent status completed / refund_requested|refunded
 * - revenue / valid orders: ONLY parent roots with CS-approved payment evidence
 *   (payment_transactions.paid OR paid_at / paid_cat_food / cs_approved markers).
 *   Child allocation rows NEVER count as revenue or valid orders.
 *   Amount SoT = payment_transactions.gross_amount → paid_cat_food → total_amount.
 * - "today" metrics use paid_at / TX confirmed_at (Asia/Kuala_Lumpur), not order created_at
 * - platform_profit: SUM platform_fee (else gross - companion_income; else 20% fallback)
 * - withdrawals: companion_withdrawals (not legacy withdrawals table)
 */
import {
  filterBusinessProfiles,
  indexProfilesForStats,
  isTestAccountRecord,
  isTestTouchedOrder,
} from "../_test-accounts.js";
import { PLATFORM_STATS_TIMEZONE, isCreatedOnLocalDay, localDateYmd } from "../_platform-day.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const WAITING_COMPANION_STATUSES = new Set(["pending", "claimed"]);
const IN_PROGRESS_STATUSES = new Set(["confirmed", "in_progress"]);
const REFUND_STATUSES = new Set(["refund_requested", "refunded"]);
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
  todayAmount: 0,
  validOrders: 0,
  platformProfit: 0,
  withdrawPending: 0,
  withdrawPaid: 0,
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
function isMissingRelationError(error) {
  const msg = String(error?.message || error || "");
  return /Could not find the table|does not exist|PGRST205|42P01/i.test(msg);
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

/**
 * True when parent payment was CS-approved / ledgered.
 * Status alone is NEVER enough — unpaid drafts that somehow left awaiting_payment must not inflate GMV.
 */
export function hasCsApprovedPayment(order = {}) {
  if (!order || typeof order !== "object") return false;
  if (order._paymentTxPaid === true) return true;
  if (money(order.payment_tx_gross) > 0 || money(order.approved_amount) > 0) return true;
  if (order.paid_at || order.paidAt) return true;
  if (money(order.paid_cat_food) > 0 || money(order.paidCatFood) > 0) return true;
  if (order.cs_approved_at || order.csApprovedAt) return true;
  if (order.payment_reviewed_at || order.paymentReviewedAt) return true;
  const receiptStatus = String(order.payment_receipt_status || order.paymentReceiptStatus || "").toLowerCase();
  if (receiptStatus === "approved" || receiptStatus === "confirmed" || receiptStatus === "paid") return true;
  return false;
}

/**
 * Revenue gate: parent business root + CS-approved payment + not cancelled/refunded/unpaid.
 * Child multi-order allocation rows never count (defense in depth beyond isBusinessOrderRoot).
 */
export function countsAsRevenue(order = {}) {
  if (!isBusinessOrderRoot(order)) return false;
  const s = String(order.status || "");
  if (!s) return false;
  if (["awaiting_payment", "cancelled", "expired", "refunded"].includes(s)) return false;
  if (!hasCsApprovedPayment(order)) return false;
  return [
    "pending",
    "waiting_boss_confirm",
    "claimed",
    "confirmed",
    "in_progress",
    "completed",
    "refund_requested",
  ].includes(s);
}

/** Unique effective Boss payment amount for a parent (never child allocation). */
export function approvedRevenueAmount(order = {}) {
  const fromTx = money(order.approved_amount != null ? order.approved_amount : order.payment_tx_gross);
  if (fromTx > 0) return fromTx;
  const paidCat = money(order.paid_cat_food != null ? order.paid_cat_food : order.paidCatFood);
  if (paidCat > 0) return paidCat;
  const listed = money(order.total_amount != null ? order.total_amount : order.totalAmount != null ? order.totalAmount : order.amount);
  return listed > 0 ? listed : 0;
}

/** Calendar-day timestamp for "today" revenue — prefer CS approval / ledger time. */
export function revenueRecognizedAt(order = {}) {
  return (
    order.paid_at ||
    order.paidAt ||
    order.payment_tx_confirmed_at ||
    order.paymentTxConfirmedAt ||
    order.cs_approved_at ||
    order.csApprovedAt ||
    order.payment_reviewed_at ||
    order.paymentReviewedAt ||
    order.created_at ||
    order.createdAt ||
    ""
  );
}

/**
 * Attach payment_transactions rows onto orders (mutates copies).
 * Child TX rows are ignored — only parent order_id ledger counts.
 */
export function attachPaymentApprovals(orders = [], transactions = []) {
  const txByOrder = new Map();
  for (const tx of transactions || []) {
    if (!tx || typeof tx !== "object") continue;
    const oid = String(tx.order_id || tx.orderId || "").trim();
    if (!oid) continue;
    const st = String(tx.payment_status || tx.status || "paid").toLowerCase();
    if (st && st !== "paid") continue;
    const gross = money(tx.gross_amount != null ? tx.gross_amount : tx.net_amount);
    const prev = txByOrder.get(oid);
    if (!prev || gross > money(prev.gross_amount)) txByOrder.set(oid, tx);
  }
  return (orders || []).map((o) => {
    const id = String(o?.id || o?.orderId || "").trim();
    const tx = id ? txByOrder.get(id) : null;
    if (!tx) return { ...o };
    const gross = money(tx.gross_amount != null ? tx.gross_amount : tx.net_amount);
    return {
      ...o,
      _paymentTxPaid: true,
      payment_tx_gross: gross,
      approved_amount: gross,
      payment_tx_confirmed_at: tx.confirmed_at || tx.confirmedAt || tx.created_at || "",
      paid_at: o.paid_at || o.paidAt || tx.confirmed_at || tx.confirmedAt || "",
    };
  });
}

function platformProfitOf(order = {}) {
  const gross = approvedRevenueAmount(order);
  const companion = money(order.player_income != null ? order.player_income : order.companion_income);
  const fee = money(order.platform_fee != null ? order.platform_fee : order.platform_commission);
  if (fee > 0) return fee;
  if (companion > 0) return Math.max(0, gross - companion);
  return Math.round(gross * 0.2 * 100) / 100;
}

/** Parent / standalone business order (never count multi-group children twice). */
export function isBusinessOrderRoot(order = {}) {
  if (order.parent_order_id) return false;
  const t = String(order.order_type || "").toLowerCase();
  // Defensive: some legacy rows may mark children only via type.
  if (t === "multi_group_child" || t === "child") return false;
  return true;
}

export function isApprovedCompanionProfile(row = {}) {
  const ver = String(row.verification_status || "").toLowerCase();
  const app = String(row.application_status || "").toLowerCase();
  if (["approved", "verified", "passed"].includes(ver)) return true;
  if (["approved", "published"].includes(app)) return true;
  return false;
}

/**
 * Hall-aligned companion total: approved companion_profiles × active non-test profile.
 * Does NOT require profiles.role === 'companion' (dual-role bosses with approved CP count).
 */
export function countApprovedCompanions({ profiles = [], companionProfiles = [] } = {}) {
  const { byId } = indexProfilesForStats(profiles);
  const seen = new Set();
  let n = 0;
  for (const cp of companionProfiles || []) {
    const uid = cp.user_id || cp.profile_id;
    if (!uid || seen.has(uid)) continue;
    if (!isApprovedCompanionProfile(cp)) continue;
    if (cp.is_test_account === true || cp.is_test === true) continue;
    const p = byId.get(uid);
    if (!p) continue;
    if (String(p.status || "active") !== "active") continue;
    if (isTestAccountRecord(p, { nickname: cp.nickname, is_test_account: cp.is_test_account })) continue;
    seen.add(uid);
    n += 1;
  }
  return n;
}

function filterActiveBusinessProfiles(profiles = [], role) {
  return filterBusinessProfiles(profiles, role).filter((p) => String(p.status || "active") === "active");
}

/**
 * Aggregate dashboard stats with smoke / @meow.test / is_test_account / vip.deploy fixtures excluded.
 * Exported for unit verification without HTTP.
 */
export function buildDashboardStats({
  profiles = [],
  orders = [],
  withdrawals = [],
  companionProfiles = [],
  paymentTransactions = [],
  now = new Date(),
  timeZone = PLATFORM_STATS_TIMEZONE,
} = {}) {
  const { byId, testIds } = indexProfilesForStats(profiles);
  const enrichedOrders =
    Array.isArray(paymentTransactions) && paymentTransactions.length
      ? attachPaymentApprovals(orders, paymentTransactions)
      : orders || [];
  const rootOrders = enrichedOrders.filter((o) => isBusinessOrderRoot(o));
  const businessOrders = rootOrders.filter((o) => !isTestTouchedOrder(o, testIds, byId));
  const today = localDateYmd(now, timeZone);
  const revenueOrders = businessOrders.filter((o) => countsAsRevenue(o));
  const paidToday = revenueOrders.filter((o) => isCreatedOnLocalDay(revenueRecognizedAt(o), today, timeZone));

  const wd = (Array.isArray(withdrawals) ? withdrawals : []).filter((w) => {
    const uid = w.user_id || w.companion_id || w.boss_id || w.profile_id;
    if (uid && testIds.has(uid)) return false;
    const p = uid ? byId.get(uid) : null;
    if (p && isTestAccountRecord(p)) return false;
    return true;
  });
  const withdrawPending = wd
    .filter((w) => !["completed", "paid", "rejected", "cancelled", "pay_failed"].includes(String(w.status || "")))
    .reduce((sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm != null ? w.amount_rm : w.amount), 0);
  const withdrawPaid = wd
    .filter((w) => ["completed", "paid", "paid_pending_receipt"].includes(String(w.status || "")))
    .reduce((sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm != null ? w.amount_rm : w.amount), 0);

  const platformProfit = revenueOrders.reduce((sum, o) => sum + platformProfitOf(o), 0);
  const bosses = filterActiveBusinessProfiles(profiles, "boss");
  const customerServices = filterActiveBusinessProfiles(profiles, "customer_service");
  const companions =
    Array.isArray(companionProfiles) && companionProfiles.length
      ? countApprovedCompanions({ profiles, companionProfiles })
      : filterActiveBusinessProfiles(profiles, "companion").length;

  const totalAmount = revenueOrders.reduce((sum, o) => sum + approvedRevenueAmount(o), 0);
  const todayAmount = paidToday.reduce((sum, o) => sum + approvedRevenueAmount(o), 0);

  return {
    stats: {
      bosses: bosses.length,
      companions,
      customerServices: customerServices.length,
      todayOrders: paidToday.length,
      validOrders: revenueOrders.length,
      awaitingPayment: businessOrders.filter((o) => o.status === "awaiting_payment").length,
      // Kept key pendingOrders for API compat; UI label = 等待陪玩确认
      pendingOrders: businessOrders.filter((o) => WAITING_COMPANION_STATUSES.has(String(o.status || ""))).length,
      inProgress: businessOrders.filter((o) => IN_PROGRESS_STATUSES.has(String(o.status || ""))).length,
      completed: businessOrders.filter((o) => o.status === "completed").length,
      refunds: businessOrders.filter((o) => REFUND_STATUSES.has(String(o.status || ""))).length,
      totalAmount,
      todayAmount,
      platformProfit: Math.round(platformProfit * 100) / 100,
      withdrawPending: Math.round(withdrawPending * 100) / 100,
      withdrawPaid: Math.round(withdrawPaid * 100) / 100,
    },
    filter: {
      testAccountsExcluded: true,
      parentOrdersOnly: true,
      revenueSource: "cs_approved_parent_payment",
      companionSource: "companion_profiles.approved+profiles.active",
      timezone: timeZone,
      excludedBosses: (profiles || []).filter((p) => p.role === "boss").length - bosses.length,
      excludedCompanionsRoleOnly:
        (profiles || []).filter((p) => p.role === "companion").length -
        filterActiveBusinessProfiles(profiles, "companion").length,
      excludedCustomerServices:
        (profiles || []).filter((p) => p.role === "customer_service").length - customerServices.length,
      excludedOrders: enrichedOrders.length - businessOrders.length,
      childOrdersSkipped: enrichedOrders.filter((o) => !isBusinessOrderRoot(o)).length,
      smokeGmvExcluded: true,
      paymentTransactionsAttached: Array.isArray(paymentTransactions) ? paymentTransactions.length : 0,
    },
    definitions: {
      boss_total: "profiles.role=boss AND status=active AND NOT test",
      companion_total:
        "companion_profiles approved (verification|application) JOIN profiles status=active NOT test (role may be boss)",
      customer_service_total: "profiles.role=customer_service AND status=active AND NOT test",
      order_scope: "parent_order_id IS NULL only",
      revenue_rule:
        "parent + CS-approved (payment_transactions|paid_at|paid_cat_food); amount=TX.gross→paid_cat_food→total_amount; children never count",
      waiting_companion_statuses: [...WAITING_COMPANION_STATUSES],
      in_progress_statuses: [...IN_PROGRESS_STATUSES],
      timezone: timeZone,
    },
  };
}

async function loadProfilesForStats() {
  const withFlag = "?select=id,role,email,display_name,status,is_test_account&limit=5000";
  const withoutFlag = "?select=id,role,email,display_name,status&limit=5000";
  try {
    return await supabaseJson(restUrl("profiles", withFlag), { headers: serviceHeaders() });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return await supabaseJson(restUrl("profiles", withoutFlag), { headers: serviceHeaders() });
  }
}

async function loadCompanionProfilesForStats() {
  const queries = [
    "?select=id,user_id,nickname,verification_status,application_status,is_test_account&limit=5000",
    "?select=id,user_id,nickname,verification_status,application_status&limit=5000",
    "?select=id,user_id,nickname,verification_status&limit=5000",
  ];
  for (const q of queries) {
    try {
      const rows = await supabaseJson(restUrl("companion_profiles", q), { headers: serviceHeaders() });
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (isMissingRelationError(error)) return [];
      if (!isMissingColumnError(error)) {
        /* try next shape */
      }
    }
  }
  return [];
}

async function loadOrdersForStats() {
  const queries = [
    "?select=id,status,total_amount,created_at,paid_at,paid_cat_food,boss_id,companion_id,customer_service_id,companion_income,platform_fee,parent_order_id,order_type&order=created_at.desc&limit=5000",
    "?select=id,status,total_amount,created_at,paid_at,boss_id,companion_id,customer_service_id,companion_income,platform_fee,parent_order_id,order_type&order=created_at.desc&limit=5000",
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id,companion_income,platform_fee,parent_order_id,order_type&order=created_at.desc&limit=5000",
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id,parent_order_id,order_type&order=created_at.desc&limit=5000",
    "?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id&order=created_at.desc&limit=5000",
  ];
  for (const q of queries) {
    try {
      const rows = await supabaseJson(restUrl("orders", q), { headers: serviceHeaders() });
      return Array.isArray(rows) ? rows : [];
    } catch {
      /* try next */
    }
  }
  return [];
}

async function loadPaymentTransactionsForStats() {
  const queries = [
    "?select=id,order_id,boss_id,gross_amount,net_amount,payment_status,confirmed_at,created_at&payment_status=eq.paid&order=confirmed_at.desc&limit=5000",
    "?select=id,order_id,boss_id,gross_amount,net_amount,payment_status,confirmed_at,created_at&order=confirmed_at.desc&limit=5000",
    "?select=id,order_id,gross_amount,net_amount,payment_status,confirmed_at&limit=5000",
  ];
  for (const q of queries) {
    try {
      const rows = await supabaseJson(restUrl("payment_transactions", q), { headers: serviceHeaders() });
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (isMissingRelationError(error)) return [];
      /* try next shape */
    }
  }
  return [];
}

async function loadWithdrawalsForStats() {
  // Production SoT is companion_withdrawals (legacy `withdrawals` table does not exist).
  const queries = [
    {
      table: "companion_withdrawals",
      q: "?select=id,status,companion_id,net_amount_rm,cat_food_amount,amount,gross_amount_rm&limit=2000",
    },
    {
      table: "companion_withdrawals",
      q: "?select=id,status,companion_id,net_amount_rm,amount&limit=2000",
    },
    { table: "withdrawals", q: "?select=id,status,user_id,companion_id,net_amount_rm,amount_rm&limit=2000" },
    { table: "withdrawals", q: "?select=id,status,net_amount_rm,amount_rm&limit=2000" },
  ];
  for (const { table, q } of queries) {
    try {
      const rows = await supabaseJson(restUrl(table, q), { headers: serviceHeaders() });
      return Array.isArray(rows) ? rows : [];
    } catch {
      /* try next */
    }
  }
  return [];
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
    const [profiles, orders, withdrawals, companionProfiles, paymentTransactions] = await Promise.all([
      loadProfilesForStats(),
      loadOrdersForStats(),
      loadWithdrawalsForStats(),
      loadCompanionProfilesForStats(),
      loadPaymentTransactionsForStats(),
    ]);
    const { stats, filter, definitions } = buildDashboardStats({
      profiles,
      orders,
      withdrawals,
      companionProfiles,
      paymentTransactions,
    });
    return json(res, 200, { ok: true, configured: true, stats, filter, definitions });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "后台统计接口异常。" });
  }
}
