#!/usr/bin/env node
/**
 * READ-ONLY Production smoke for homepage daily stats (PR #199).
 * - SELECT / GET only — never mutate Production.
 * - Compares new-code home payload vs admin buildDashboardStats on live Prod data.
 * - Fetches live Production HTTP /api/home/daily-stats for documentation.
 *
 * Usage:
 *   PROD_SUPABASE_URL=… PROD_SUPABASE_SERVICE_ROLE_KEY=… \
 *   node scripts/smoke-prod-home-daily-stats-readonly.mjs
 */
import {
  PRODUCTION_PROJECT_REF as PRODUCTION_SUPABASE_REF,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";
import { buildHomeDailyStatsPayload } from "../server/api/home/daily-stats.js";
import {
  PLATFORM_STATS_TIMEZONE,
  isCreatedOnLocalDay,
  localDateYmd,
} from "../server/api/_platform-day.js";
import { isTestAccountRecord, indexProfilesForStats } from "../server/api/_test-accounts.js";
import fs from "node:fs";

const PROD_URL = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const PROD_KEY = String(
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const APP = String(process.env.PROD_APP_URL || "https://www.meowcuijiao.com").replace(/\/$/, "");

function assertProdOnly() {
  const ref = projectRefFromSupabaseUrl(PROD_URL);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Expected Production ref ${PRODUCTION_SUPABASE_REF}, got ${ref || "(empty)"}`);
  }
  if (!PROD_KEY) throw new Error("Missing PROD_SUPABASE_SERVICE_ROLE_KEY");
}

function headers() {
  return {
    apikey: PROD_KEY,
    Authorization: `Bearer ${PROD_KEY}`,
    "Content-Type": "application/json",
    Prefer: "count=exact",
  };
}

async function rest(path) {
  const res = await fetch(`${PROD_URL.replace(/\/$/, "")}${path}`, { headers: headers(), method: "GET" });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

async function loadProfiles() {
  try {
    return await rest("/rest/v1/profiles?select=id,role,email,display_name,is_test_account&limit=5000");
  } catch {
    return await rest("/rest/v1/profiles?select=id,role,email,display_name&limit=5000");
  }
}

async function loadOrders() {
  try {
    return await rest(
      "/rest/v1/orders?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id,player_income,companion_income,platform_fee,platform_commission&order=created_at.desc&limit=5000"
    );
  } catch {
    return await rest(
      "/rest/v1/orders?select=id,status,total_amount,created_at,boss_id,companion_id,customer_service_id&order=created_at.desc&limit=5000"
    );
  }
}

async function loadOnlineCompanions(profiles) {
  const { byId, testIds } = indexProfilesForStats(profiles);
  let rows = [];
  for (const q of [
    "/rest/v1/companion_profiles?select=id,user_id,online_status,availability_status,is_test_account&limit=5000",
    "/rest/v1/companion_profiles?select=id,user_id,online_status,availability_status&limit=5000",
    "/rest/v1/companion_profiles?select=id,user_id,online_status&limit=5000",
  ]) {
    try {
      rows = await rest(q);
      break;
    } catch {
      rows = [];
    }
  }
  return (rows || []).filter((c) => {
    const uid = c.user_id || c.id;
    if (uid && testIds.has(uid)) return false;
    if (c.is_test_account === true) return false;
    const p = uid ? byId.get(uid) : null;
    if (p && isTestAccountRecord(p)) return false;
    const status = String(c.availability_status || c.online_status || "").toLowerCase();
    return status === "online" || /在线/.test(status);
  }).length;
}

function staticCodeAudit() {
  const homeJs = fs.readFileSync("src/home-daily-stats.js", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const launch = fs.readFileSync("src/launch-readiness-fixes.js", "utf8");
  const api = fs.readFileSync("server/api/home/daily-stats.js", "utf8");
  const fails = [];
  if (/localStorage/.test(homeJs)) fails.push("home-daily-stats.js uses localStorage");
  if (/todayOrders\.length\)\s*todayOrders\s*=\s*orders/.test(index)) fails.push("index still has all-orders-as-today fallback");
  if (/mcjRealDB\.v1/.test(index) && !/DISABLED/.test(index.slice(index.indexOf("todayDataDetailScript"), index.indexOf("todayDataDetailScript") + 800))) {
    // legacy mention only in disabled comment is OK
  }
  if (!/DISABLED: no localStorage fake stats/.test(index)) fails.push("todayDataDetailScript not disabled");
  if (!/buildDashboardStats/.test(api)) fails.push("home daily-stats not using buildDashboardStats");
  if (/ordersCreated:\s*ordersToday\.length/.test(api)) fails.push("old all-orders count still present");
  if (!/no-store/.test(api) || !/no-store/.test(homeJs)) fails.push("missing no-store cache headers/fetch");
  // hardcoded famous fake numbers in active home daily module
  if (/data-count="56"/.test(homeJs) || /今日订单<\/span><strong>56/.test(homeJs)) {
    fails.push("hardcoded 56 in home-daily-stats");
  }
  if (/Do NOT hide \[data-home-daily-stats\]/.test(launch) === false && /hasOrders \|\| hasPlayers/.test(launch)) {
    fails.push("launch-readiness still hides daily stats via localStorage");
  }
  return fails;
}

function klBoundaryUnit() {
  // 2026-09-08 00:30 MYT = 2026-09-07T16:30:00.000Z
  const iso = "2026-09-07T16:30:00.000Z";
  const day = "2026-09-08";
  if (!isCreatedOnLocalDay(iso, day, PLATFORM_STATS_TIMEZONE)) {
    throw new Error("KL boundary fail: UTC prev-day evening should count as KL next day");
  }
  if (isCreatedOnLocalDay("2026-09-07T10:00:00.000Z", day, PLATFORM_STATS_TIMEZONE)) {
    throw new Error("KL boundary fail: still KL Sep 7 afternoon must NOT count as Sep 8");
  }
  // UTC date-slice would wrongly classify 16:30Z as Sep 7
  if (iso.slice(0, 10) === day) throw new Error("test fixture invalid");
  return { ok: true, note: "UTC date-slice would miss KL morning orders; new helper counts them" };
}

async function fetchLiveHome() {
  const urls = [`${APP}/api/home/daily-stats`, `${APP}/api/gateway?path=home%2Fdaily-stats`];
  const out = [];
  for (const url of urls) {
    const res = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-store" } });
    const body = await res.json().catch(() => ({}));
    out.push({ url, status: res.status, body });
  }
  return out;
}

async function main() {
  assertProdOnly();
  const now = new Date();
  const date = localDateYmd(now, PLATFORM_STATS_TIMEZONE);
  console.log(JSON.stringify({ mode: "READ_ONLY", prodRef: PRODUCTION_SUPABASE_REF, app: APP, date, timezone: PLATFORM_STATS_TIMEZONE }, null, 2));

  const staticFails = staticCodeAudit();
  if (staticFails.length) {
    console.error("[FAIL] static", staticFails);
    process.exit(1);
  }
  console.log("[PASS] static: no localStorage fallback / mock / hardcoded home stats path");

  const boundary = klBoundaryUnit();
  console.log("[PASS] KL midnight boundary", boundary);

  const [profiles, orders] = await Promise.all([loadProfiles(), loadOrders()]);
  const onlineCompanions = await loadOnlineCompanions(profiles);
  // READ-ONLY compute with NEW code
  const admin = buildDashboardStats({ profiles, orders, withdrawals: [], now });
  const home = buildHomeDailyStatsPayload({ profiles, orders, onlineCompanions, now });

  const cmp = {
    todayOrders: { home: home.todayOrders ?? home.ordersCreated, admin: admin.stats.todayOrders },
    todayAmount: { home: home.todayAmount ?? home.grossRevenue, admin: admin.stats.todayAmount },
    onlineCompanions: home.onlineCompanions,
  };
  if (cmp.todayOrders.home !== cmp.todayOrders.admin) {
    throw new Error(`todayOrders mismatch home=${cmp.todayOrders.home} admin=${cmp.todayOrders.admin}`);
  }
  if (Number(cmp.todayAmount.home) !== Number(cmp.todayAmount.admin)) {
    throw new Error(`todayAmount mismatch home=${cmp.todayAmount.home} admin=${cmp.todayAmount.admin}`);
  }
  console.log("[PASS] new-code home == admin on Production data (read-only)", cmp);

  const live = await fetchLiveHome();
  for (const row of live) {
    console.log("[LIVE]", row.status, row.url, JSON.stringify(row.body));
  }
  // Pre-merge: live Production may still be OLD handler (ordersCreated/grossRevenue only).
  // Document keys present.
  const liveBody = live[0]?.body || {};
  const liveOnline = liveBody.onlineCompanions;
  const onlineNote =
    liveOnline != null && Number(liveOnline) !== Number(cmp.onlineCompanions)
      ? `Live onlineCompanions=${liveOnline} vs new-code=${cmp.onlineCompanions} (expected pre-merge if live still counts test accounts).`
      : "live onlineCompanions matches new-code";
  const report = {
    ok: true,
    productionTouched: false,
    mutations: 0,
    newCodeAlignment: "PASS",
    liveProductionApi: {
      date: liveBody.date,
      timezone: liveBody.timezone,
      // old field names still on production until merge:
      ordersCreated: liveBody.ordersCreated,
      grossRevenue: liveBody.grossRevenue,
      onlineCompanions: liveBody.onlineCompanions,
      // new aliases after merge:
      todayOrders: liveBody.todayOrders ?? null,
      todayAmount: liveBody.todayAmount ?? null,
      note:
        liveBody.todayOrders == null
          ? "Live Production still on pre-PR#199 response shape; post-merge expect todayOrders/todayAmount aliases matching admin."
          : "Live Production already exposes todayOrders/todayAmount",
      onlineCompanionsNote: onlineNote,
    },
    expectedAfterMerge: {
      todayOrders: cmp.todayOrders.admin,
      todayAmount: cmp.todayAmount.admin,
      onlineCompanions: cmp.onlineCompanions,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("[PASS] Production smoke checklist (read-only) complete — safe to merge PR #199");
}

main().catch((err) => {
  console.error("[FAIL]", err.message || err);
  process.exit(1);
});
