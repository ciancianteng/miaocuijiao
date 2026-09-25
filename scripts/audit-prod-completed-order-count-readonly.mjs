#!/usr/bin/env node
/**
 * READ-ONLY Production audit: why homepage completedOrders != expected.
 * Never mutates Production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_PROJECT_REF,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";
import { buildDashboardStats, isBusinessOrderRoot } from "../server/api/admin/dashboard.js";
import { indexProfilesForStats, isTestTouchedOrder } from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-completed-order-count");
fs.mkdirSync(outDir, { recursive: true });

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!v || /\[SENSITIVE\]/i.test(v)) continue;
    o[m[1]] = v;
  }
  return o;
}

function loadEnv() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    path.join(root, "../meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local"),
    path.join(root, ".env.prod.local"),
    path.join(root, ".env.vercel.prod.pull.tmp"),
  ];
  const merged = {};
  for (const p of candidates) {
    Object.assign(merged, parseEnv(p));
  }
  for (const [k, v] of Object.entries(merged)) {
    if (v && !/\[SENSITIVE\]/i.test(v)) process.env[k] = v;
  }
}
loadEnv();

const PROD_URL = String(
  process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
)
  .trim()
  .replace(/\/$/, "");
const PROD_KEY = String(
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const APP = "https://www.meowcuijiao.com";

function assertProd() {
  const ref = projectRefFromSupabaseUrl(PROD_URL);
  if (ref !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Expected prod ref ${PRODUCTION_PROJECT_REF}, got ${ref || "(empty)"} urlLen=${PROD_URL.length} http=${/^https?:\/\//i.test(PROD_URL)}`
    );
  }
  if (!PROD_KEY) throw new Error("missing service role key");
}

async function rest(q) {
  const res = await fetch(`${PROD_URL.replace(/\/$/, "")}/rest/v1/${q}`, {
    headers: {
      apikey: PROD_KEY,
      Authorization: `Bearer ${PROD_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`GET ${q} -> ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

assertProd();

const httpStats = await fetch(`${APP}/api/home/daily-stats`, { cache: "no-store" }).then(async (r) => ({
  status: r.status,
  json: await r.json().catch(() => null),
}));

const profiles = await rest("profiles?select=id,role,email,display_name,status,is_test_account&limit=5000").catch(
  async () => rest("profiles?select=id,role,email,display_name,status&limit=5000")
);

const orders = await rest(
  "orders?select=id,order_no,status,total_amount,created_at,completed_at,paid_at,paid_cat_food,boss_id,companion_id,customer_service_id,parent_order_id,order_type&order=created_at.desc&limit=5000"
);

const paymentTx = await rest(
  "payment_transactions?select=id,order_id,gross_amount,net_amount,payment_status,confirmed_at,created_at&limit=5000"
).catch(() => []);

const { byId, testIds } = indexProfilesForStats(profiles);
const completedAll = orders.filter((o) => {
  const s = String(o.status || "").toLowerCase();
  return s === "completed" || s === "reviewed";
});

const rows = completedAll.map((o) => {
  const root = isBusinessOrderRoot(o);
  const test = isTestTouchedOrder(o, testIds, byId);
  return {
    id: o.id,
    order_no: o.order_no,
    status: o.status,
    parent_order_id: o.parent_order_id || null,
    order_type: o.order_type || "",
    total_amount: o.total_amount,
    paid_at: o.paid_at || null,
    paid_cat_food: o.paid_cat_food,
    completed_at: o.completed_at || null,
    is_root: root,
    is_test_touched: test,
    counts_in_current_dashboard: root && !test && String(o.status) === "completed",
    counts_if_reviewed_included: root && !test && (o.status === "completed" || o.status === "reviewed"),
  };
});

const currentCounted = rows.filter((r) => r.counts_in_current_dashboard);
const childrenCompleted = rows.filter((r) => !r.is_root);
const testCompleted = rows.filter((r) => r.is_test_touched);
const rootsCompleted = rows.filter((r) => r.is_root && !r.is_test_touched);

const dash = buildDashboardStats({
  profiles,
  orders,
  paymentTransactions: paymentTx,
  withdrawals: [],
  now: new Date(),
});

const report = {
  at: new Date().toISOString(),
  http_completedOrders: httpStats.json?.completedOrders,
  http_filter: httpStats.json?.filter || null,
  dashboard_completed: dash.stats.completed,
  dashboard_validOrders: dash.stats.validOrders,
  dashboard_totalAmount: dash.stats.totalAmount,
  completed_rows_total: rows.length,
  current_counted: currentCounted.length,
  roots_non_test_completed_or_reviewed: rootsCompleted.length,
  children_completed: childrenCompleted.length,
  test_touched_completed: testCompleted.length,
  current_counted_ids: currentCounted.map((r) => ({
    id: r.id,
    order_no: r.order_no,
    parent_order_id: r.parent_order_id,
    amount: r.total_amount,
    completed_at: r.completed_at,
  })),
  children_completed_ids: childrenCompleted.map((r) => ({
    id: r.id,
    order_no: r.order_no,
    parent_order_id: r.parent_order_id,
    status: r.status,
    amount: r.total_amount,
  })),
  all_completed_detail: rows,
  payment_tx_count: paymentTx.length,
  payment_tx_on_completed_children: paymentTx.filter((tx) =>
    childrenCompleted.some((c) => c.id === tx.order_id)
  ).length,
};

fs.writeFileSync(path.join(outDir, "PROD_AUDIT.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      http_completedOrders: report.http_completedOrders,
      dashboard_completed: report.dashboard_completed,
      current_counted: report.current_counted,
      children_completed: report.children_completed,
      test_touched: report.test_touched_completed,
      roots_non_test: report.roots_non_test_completed_or_reviewed,
      counted_order_nos: report.current_counted_ids.map((x) => x.order_no),
      child_order_nos: report.children_completed_ids.map((x) => x.order_no),
    },
    null,
    2
  )
);
