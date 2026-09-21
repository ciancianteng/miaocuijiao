#!/usr/bin/env node
/**
 * READ-ONLY Production audit: Admin dashboard metrics vs DB.
 * No writes. No migrations. No backfills.
 *
 * Usage:
 *   node scripts/audit-admin-dashboard-prod-readonly.mjs
 *
 * Credentials (mislabeled in this env):
 *   PROD_SUPABASE_URL            → postgresql://… (Production pooler)
 *   PROD_SUPABASE_SERVICE_ROLE_KEY → DB password
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import {
  buildDashboardStats,
  countsAsRevenue,
} from "../server/api/admin/dashboard.js";
import { PLATFORM_STATS_TIMEZONE, localDateYmd } from "../server/api/_platform-day.js";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/admin-dashboard-reconcile");
fs.mkdirSync(outDir, { recursive: true });

function resolveDbUrl() {
  const mislabeled = String(process.env.PROD_SUPABASE_URL || "").trim();
  if (/^postgres(ql)?:\/\//i.test(mislabeled)) return mislabeled;
  throw new Error("PROD_SUPABASE_URL is not a postgresql URL");
}

function projectRefFromDatabaseUrl(dbUrl) {
  const u = new URL(String(dbUrl || ""));
  const host = (u.hostname || "").toLowerCase();
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) return direct[1].toLowerCase();
  const user = decodeURIComponent(u.username || "");
  const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
  if (fromUser) return fromUser[1].toLowerCase();
  if (host.includes(PRODUCTION_SUPABASE_REF)) return PRODUCTION_SUPABASE_REF;
  return "";
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const dbUrl = resolveDbUrl();
  const ref = projectRefFromDatabaseUrl(dbUrl);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing: not Production ref (got ${ref || "unknown"})`);
  }

  const password = String(process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const u = new URL(dbUrl);
  if (password) u.password = password;

  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  await client.connect();

  // Force read-only session (no long transaction — avoid aborted-tx cascade)
  await client.query("SET default_transaction_read_only = on");
  await client.query("SET statement_timeout = '60s'");

  async function q(sql, params) {
    try {
      return await client.query(sql, params);
    } catch (e) {
      return { rows: [], error: String(e.message || e), code: e.code };
    }
  }

  const tables = await q(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY 1
  `);

  const profileCols = await q(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' ORDER BY ordinal_position
  `);
  const orderCols = await q(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' ORDER BY ordinal_position
  `);
  const cpCols = await q(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companion_profiles' ORDER BY ordinal_position
  `);

  const hasIsTest = profileCols.rows.some((r) => r.column_name === "is_test_account");
  const hasParent = orderCols.rows.some((r) => r.column_name === "parent_order_id");
  const hasOrderType = orderCols.rows.some((r) => r.column_name === "order_type");
  const hasAppStatus = cpCols.rows.some((r) => r.column_name === "application_status");
  const hasOnline = cpCols.rows.some((r) => r.column_name === "online_status");

  const roleCounts = await q(`
    SELECT role, status, COUNT(*)::int AS n
    FROM profiles
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const companionsBySource = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM profiles WHERE role='companion') AS profiles_role_companion,
      (SELECT COUNT(*)::int FROM profiles WHERE role='companion' AND COALESCE(status,'')='active') AS profiles_companion_active,
      (SELECT COUNT(*)::int FROM profiles WHERE role='companion' AND COALESCE(${hasIsTest ? "is_test_account" : "false"},false)=false) AS profiles_companion_not_test_flag,
      (SELECT COUNT(*)::int FROM companion_profiles) AS companion_profiles_rows,
      (SELECT COUNT(*)::int FROM companion_profiles WHERE LOWER(COALESCE(verification_status,'')) IN ('approved','verified','passed')) AS cp_approved
  `);

  const hallish = await q(`
    SELECT COUNT(*)::int AS n
    FROM companion_profiles cp
    JOIN profiles p ON p.id = cp.user_id
    WHERE COALESCE(p.status,'') = 'active'
      AND LOWER(COALESCE(cp.verification_status,'')) IN ('approved','verified','passed')
  `);

  const orderStatus = hasParent
    ? await q(`
        SELECT status, COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE parent_order_id IS NULL)::int AS roots,
          COUNT(*) FILTER (WHERE parent_order_id IS NOT NULL)::int AS children
          ${hasOrderType ? ", COUNT(*) FILTER (WHERE order_type = 'multi_group')::int AS multi_group" : ""}
        FROM orders
        GROUP BY status
        ORDER BY n DESC
      `)
    : await q(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status ORDER BY n DESC`);

  const awaitingDetail = await q(`
    SELECT id, order_no, status,
           ${hasOrderType ? "order_type," : "NULL::text AS order_type,"}
           ${hasParent ? "parent_order_id," : "NULL::uuid AS parent_order_id,"}
           boss_id, companion_id, total_amount, payment_method, created_at, title
    FROM orders
    WHERE status = 'awaiting_payment'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const paidish = await q(`
    SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total_amount),0)::float AS sum_amt
    FROM orders
    WHERE status NOT IN ('awaiting_payment','cancelled','expired')
    GROUP BY status ORDER BY n DESC
  `);

  const withdrawals = await q(`
    SELECT status, COUNT(*)::int AS n,
      COALESCE(SUM(COALESCE(net_amount_rm, amount_rm, 0)),0)::float AS sum_rm
    FROM withdrawals
    GROUP BY status ORDER BY n DESC
  `);

  const profilesRaw = await q(
    hasIsTest
      ? `SELECT id, role, email, display_name, is_test_account FROM profiles LIMIT 5000`
      : `SELECT id, role, email, display_name FROM profiles LIMIT 5000`
  );
  const profiles = profilesRaw.rows.map((r) => ({
    id: r.id,
    role: r.role,
    email: r.email,
    display_name: r.display_name,
    is_test_account: r.is_test_account === true,
  }));

  const orderSelect = await q(`
    SELECT id, status, total_amount, created_at, boss_id, companion_id, customer_service_id,
           player_income, companion_income, platform_fee, platform_commission
           ${hasParent ? ", parent_order_id" : ""}
           ${hasOrderType ? ", order_type" : ""}
           , order_no, title
    FROM orders
    ORDER BY created_at DESC
    LIMIT 5000
  `);

  const wdRows = await q(`
    SELECT id, status, user_id, companion_id, net_amount_rm, cat_food_amount, amount_rm
    FROM withdrawals LIMIT 2000
  `);

  const { stats, filter } = buildDashboardStats({
    profiles,
    orders: orderSelect.rows,
    withdrawals: wdRows.rows,
  });

  const companionProfilesDetail = await q(`
    SELECT
      p.id, p.email, p.display_name, p.status AS profile_status, p.role,
      ${hasIsTest ? "COALESCE(p.is_test_account,false) AS is_test_account," : "false AS is_test_account,"}
      cp.verification_status,
      ${hasAppStatus ? "cp.application_status," : "NULL::text AS application_status,"}
      ${hasOnline ? "cp.online_status," : "NULL::text AS online_status,"}
      cp.nickname
    FROM companion_profiles cp
    LEFT JOIN profiles p ON p.id = cp.user_id
    ORDER BY 1
    LIMIT 200
  `);

  const awaitingParents = awaitingDetail.rows.filter((o) => !o.parent_order_id);
  const awaitingChildren = awaitingDetail.rows.filter((o) => o.parent_order_id);

  const businessRoots = orderSelect.rows.filter((o) => !o.parent_order_id);
  const revenueRoots = businessRoots.filter((o) => countsAsRevenue(o));
  const today = localDateYmd(new Date(), PLATFORM_STATS_TIMEZONE);

  let hallApiCount = null;
  try {
    const hall = await fetch("https://www.meowcuijiao.com/api/public/companions").then((r) => r.json());
    hallApiCount = Array.isArray(hall.companions) ? hall.companions.length : null;
  } catch {
    hallApiCount = null;
  }

  // Role mismatch: companion_profiles whose profile.role is NOT companion
  const roleMismatch = await q(`
    SELECT p.role, COUNT(*)::int AS n
    FROM companion_profiles cp
    LEFT JOIN profiles p ON p.id = cp.user_id
    GROUP BY p.role
    ORDER BY n DESC
  `);

  await client.end();

  const report = {
    at: new Date().toISOString(),
    productionRef: ref,
    timezone: PLATFORM_STATS_TIMEZONE,
    todayLocal: today,
    uiReportedByUser: {
      bosses: 27,
      companions: 4,
      customerServices: 1,
      todayOrders: 0,
      awaitingPayment: 1,
      pendingOrders: 0,
      inProgress: 0,
      completed: 0,
      refunds: 0,
      totalAmount: 0,
      todayAmount: 0,
      platformProfit: 0,
      withdrawPending: 0,
      withdrawPaid: 0,
    },
    dashboardApiSimulatedFromDb: stats,
    dashboardFilter: filter,
    tablesPresent: tables.rows.map((r) => r.table_name),
    profileColumns: profileCols.rows.map((r) => r.column_name),
    orderColumns: orderCols.rows.map((r) => r.column_name),
    companionProfileColumns: cpCols.rows.map((r) => r.column_name),
    roleStatusMatrix: roleCounts.rows,
    companionSources: companionsBySource.rows[0],
    hallishApprovedActive: hallish.rows[0],
    hallApiCount,
    orderStatusMatrix: orderStatus.rows,
    awaitingPaymentOrders: awaitingDetail.rows,
    awaitingParentsCount: awaitingParents.length,
    awaitingChildrenCount: awaitingChildren.length,
    paidishByStatus: paidish.rows,
    withdrawalsByStatus: withdrawals.rows,
    companionProfileSample: companionProfilesDetail.rows.slice(0, 30),
    proposedDefinitions: {
      boss_total: "profiles.role='boss' AND status='active' AND NOT test account",
      companion_total:
        "RECOMMENDED: companion_profiles with verification approved + profiles.role=companion + profiles.status=active + NOT test (hall-aligned). CURRENT dashboard: profiles.role=companion NOT test only (ignores companion_profiles / approval).",
      customer_service_total: "profiles.role='customer_service' AND status='active' AND NOT test",
      order_count_business: "COUNT orders WHERE parent_order_id IS NULL (parent/standalone once)",
      awaiting_payment: "parent/standalone status=awaiting_payment only",
      pending_waiting_label: "SUGGEST rename 等待抢单 → 等待陪玩确认; include claimed/confirmed waiting states per product SoT",
      in_progress: "include confirmed+in_progress (and claimed if assigned) for parent roots",
      completed: "status=completed on parent roots",
      refunds: "parent roots in refund_requested|refunded|partial path",
      effective_revenue: "SUM total_amount of paid parent roots minus net refunds; exclude awaiting_payment/cancelled/child rows",
      today_revenue: `same as effective but created_at in ${PLATFORM_STATS_TIMEZONE} calendar day`,
      platform_profit: "SUM platform_fee/platform_commission on revenue parents; do not invent 20% silently in prod metrics without flag",
    },
    revenueIfParentOnly: {
      count: revenueRoots.length,
      sum: revenueRoots.reduce((s, o) => s + money(o.total_amount), 0),
    },
    rootCauseHypotheses: [],
  };

  // Build root cause hypotheses
  const ui = report.uiReportedByUser;
  if (stats.companions === ui.companions) {
    report.rootCauseHypotheses.push(
      `陪玩总数 UI=${ui.companions} matches current dashboard definition (profiles.role=companion excl test). Hall shows ${hallApiCount} — definition mismatch vs hall/companion_profiles, not a random UI bug.`
    );
  } else {
    report.rootCauseHypotheses.push(
      `陪玩 UI=${ui.companions} vs rebuild-from-DB stats.companions=${stats.companions} — API/UI drift or stale client.`
    );
  }
  if (stats.bosses === ui.bosses) {
    report.rootCauseHypotheses.push(`老板总数 UI=${ui.bosses} matches dashboard rebuild (${stats.bosses}).`);
  }
  if (stats.completed === 0 && orderStatus.rows.some((r) => r.status === "completed" && r.n > 0)) {
    report.rootCauseHypotheses.push("completed orders exist but may be test-touched and excluded.");
  }
  if (stats.inProgress === 0) {
    const claimed = orderStatus.rows.find((r) => r.status === "claimed");
    const confirmed = orderStatus.rows.find((r) => r.status === "confirmed");
    if ((claimed && claimed.n) || (confirmed && confirmed.n)) {
      report.rootCauseHypotheses.push(
        `进行中=0 because dashboard only counts status=in_progress; claimed=${claimed?.n || 0} confirmed=${confirmed?.n || 0} ignored.`
      );
    }
  }

  fs.writeFileSync(path.join(outDir, "RECONCILE.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    out: path.join(outDir, "RECONCILE.json"),
    stats,
    companionSources: report.companionSources,
    hallApiCount,
    orderStatusMatrix: report.orderStatusMatrix,
    awaitingPaymentOrders: report.awaitingPaymentOrders.map((o) => ({
      id: o.id,
      order_no: o.order_no,
      parent_order_id: o.parent_order_id,
      order_type: o.order_type,
      total_amount: o.total_amount,
      created_at: o.created_at,
      title: o.title,
    })),
    rootCauseHypotheses: report.rootCauseHypotheses,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
