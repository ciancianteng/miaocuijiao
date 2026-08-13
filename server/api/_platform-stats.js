/**
 * Shared platform stats — one Supabase source for home / admin / ops counts.
 * Timezone default: Asia/Kuala_Lumpur (HOME_STATS_TIMEZONE).
 */

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_SERVICE_ROLE_KEY") {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  }
  return process.env[key] || "";
}

export function hasPlatformDb() {
  return REQUIRED_ENV.every((key) => !!env(key));
}

export function statsTimezone() {
  return process.env.HOME_STATS_TIMEZONE || "Asia/Kuala_Lumpur";
}

export function todayInTimezone(timezone = statsTimezone()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Paid / in-service / completed revenue. Exclude unpaid drafts and cancelled. */
export function countsAsRevenue(order = {}) {
  const s = String(order.status || "");
  if (!s) return false;
  if (["awaiting_payment", "cancelled", "expired", "refunded"].includes(s)) return false;
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

export function platformProfitOf(order = {}) {
  const gross = money(order.total_amount);
  const companion = money(order.player_income != null ? order.player_income : order.companion_income);
  const fee = money(order.platform_fee != null ? order.platform_fee : order.platform_commission);
  if (fee > 0) return fee;
  if (companion > 0) return Math.max(0, gross - companion);
  return Math.round(gross * 0.2 * 100) / 100;
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
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
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
    const msg = body?.message || body?.hint || body?.error || text || `HTTP ${response.status}`;
    throw Object.assign(new Error(msg), { status: response.status });
  }
  return body;
}

async function supabaseRows(table, query) {
  const body = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
  return Array.isArray(body) ? body : [];
}

async function supabaseCount(table, query) {
  const response = await fetch(restUrl(table, query), {
    headers: serviceHeaders({ Prefer: "count=exact", Range: "0-0" }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
  }
  const cr = String(response.headers.get("content-range") || "");
  const m = cr.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) || 0 : 0;
}

function dayKeyInTz(iso, timezone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function lastNDayKeys(n, timezone) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    keys.push(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d)
    );
  }
  return keys;
}

/**
 * Load canonical platform stats from Supabase tables:
 * profiles, companion_profiles, orders, withdrawals (+ optional applications).
 */
export async function loadPlatformStats() {
  const timezone = statsTimezone();
  const today = todayInTimezone(timezone);
  if (!hasPlatformDb()) {
    return {
      ok: true,
      configured: false,
      date: today,
      timezone,
      stats: emptyStats(),
      trends: emptyTrends(),
      pending: { companionAudits: 0, withdrawals: 0, refunds: 0, tickets: 0 },
      message: "未配置 Supabase，不返回假统计。",
    };
  }

  const orderSelect =
    "id,status,total_amount,player_income,companion_income,platform_fee,platform_commission,created_at";
  const [
    bosses,
    companions,
    customerServices,
    orders,
    companionPresenceRows,
    withdrawals,
    companionAudits,
  ] = await Promise.all([
    supabaseCount("profiles", "?role=eq.boss"),
    supabaseCount("profiles", "?role=eq.companion"),
    supabaseCount("profiles", "?role=eq.customer_service"),
    supabaseRows("orders", `?select=${orderSelect}&order=created_at.desc&limit=8000`).catch(() => []),
    supabaseRows("companion_profiles", "?select=id,online_status&limit=5000").catch(() => []),
    supabaseRows("withdrawals", "?select=id,status,net_amount_rm,amount_rm,cat_food_amount&limit=5000").catch(
      () => []
    ),
    supabaseCount(
      "companion_applications",
      "?or=(status.eq.pending,status.eq.submitted,status.eq.under_review,audit_status.eq.pending)"
    ).catch(() => 0),
  ]);

  const companionsOnline = (Array.isArray(companionPresenceRows) ? companionPresenceRows : []).filter((c) =>
    /online|在线/i.test(String(c.online_status || ""))
  ).length;

  const revenueOrders = orders.filter((o) => countsAsRevenue(o));
  const createdToday = orders.filter((o) => dayKeyInTz(o.created_at, timezone) === today);
  const revenueToday = revenueOrders.filter((o) => dayKeyInTz(o.created_at, timezone) === today);

  const wd = Array.isArray(withdrawals) ? withdrawals : [];
  const withdrawPendingRows = wd.filter(
    (w) => !["completed", "paid", "rejected", "cancelled", "pay_failed"].includes(String(w.status || ""))
  );
  const withdrawPending = withdrawPendingRows.reduce(
    (sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm),
    0
  );
  const withdrawPaid = wd
    .filter((w) => ["completed", "paid", "paid_pending_receipt"].includes(String(w.status || "")))
    .reduce((sum, w) => sum + money(w.net_amount_rm != null ? w.net_amount_rm : w.amount_rm), 0);

  const platformProfit = revenueOrders.reduce((sum, o) => sum + platformProfitOf(o), 0);
  const todayPlatformProfit = revenueToday.reduce((sum, o) => sum + platformProfitOf(o), 0);

  const dayKeys = lastNDayKeys(7, timezone);
  const orderTrend = dayKeys.map((key) => orders.filter((o) => dayKeyInTz(o.created_at, timezone) === key).length);
  const revenueTrend = dayKeys.map((key) =>
    revenueOrders
      .filter((o) => dayKeyInTz(o.created_at, timezone) === key)
      .reduce((sum, o) => sum + money(o.total_amount), 0)
  );
  const profitTrend = dayKeys.map((key) =>
    revenueOrders
      .filter((o) => dayKeyInTz(o.created_at, timezone) === key)
      .reduce((sum, o) => sum + platformProfitOf(o), 0)
  );

  const stats = {
    bosses,
    companions,
    customerServices,
    onlineCompanions: companionsOnline,
    ordersTotal: orders.length,
    todayOrdersCreated: createdToday.length,
    todayOrders: revenueToday.length,
    todayOrdersCompleted: createdToday.filter((o) => o.status === "completed").length,
    awaitingPayment: orders.filter((o) => o.status === "awaiting_payment").length,
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    inProgress: orders.filter((o) => o.status === "in_progress" || o.status === "confirmed").length,
    completed: orders.filter((o) => o.status === "completed").length,
    refunds: orders.filter((o) => o.status === "refund_requested" || o.status === "refunded").length,
    totalAmount: Math.round(revenueOrders.reduce((sum, o) => sum + money(o.total_amount), 0) * 100) / 100,
    todayAmount: Math.round(revenueToday.reduce((sum, o) => sum + money(o.total_amount), 0) * 100) / 100,
    platformProfit: Math.round(platformProfit * 100) / 100,
    todayPlatformProfit: Math.round(todayPlatformProfit * 100) / 100,
    withdrawPending: Math.round(withdrawPending * 100) / 100,
    withdrawPaid: Math.round(withdrawPaid * 100) / 100,
    // Home aliases (same numbers)
    ordersCreated: createdToday.length,
    grossRevenue: Math.round(revenueToday.reduce((sum, o) => sum + money(o.total_amount), 0) * 100) / 100,
    newCustomers: 0,
    newCompanions: 0,
  };

  return {
    ok: true,
    configured: true,
    date: today,
    timezone,
    stats,
    trends: {
      days: dayKeys,
      orders: orderTrend,
      revenue: revenueTrend,
      profit: profitTrend,
    },
    pending: {
      companionAudits,
      withdrawals: withdrawPendingRows.length,
      refunds: stats.refunds,
      tickets: 0,
    },
  };
}

function emptyStats() {
  return {
    bosses: 0,
    companions: 0,
    customerServices: 0,
    onlineCompanions: 0,
    ordersTotal: 0,
    todayOrdersCreated: 0,
    todayOrders: 0,
    todayOrdersCompleted: 0,
    awaitingPayment: 0,
    pendingOrders: 0,
    inProgress: 0,
    completed: 0,
    refunds: 0,
    totalAmount: 0,
    todayAmount: 0,
    platformProfit: 0,
    todayPlatformProfit: 0,
    withdrawPending: 0,
    withdrawPaid: 0,
    ordersCreated: 0,
    grossRevenue: 0,
    newCustomers: 0,
    newCompanions: 0,
  };
}

function emptyTrends() {
  return { days: [], orders: [], revenue: [], profit: [] };
}
