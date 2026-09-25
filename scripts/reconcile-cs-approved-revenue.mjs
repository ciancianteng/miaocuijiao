#!/usr/bin/env node
/**
 * Read-only reconcile: A=SUM(CS-approved parent TX) must equal B=Dashboard totalAmount;
 * C=distinct approved parent TX orders must equal D=validOrders.
 *
 * Prefer RECONCILE_TARGET=staging (default). Production is read-only when env is present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";
import { indexProfilesForStats, isTestTouchedOrder } from "../server/api/_test-accounts.js";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "artifacts", "p0-cs-approved-revenue-lock");
fs.mkdirSync(outDir, { recursive: true });

const target = String(process.env.RECONCILE_TARGET || "staging").toLowerCase();
loadEnvFiles(root);

const extraFiles =
  target === "prod" || target === "production"
    ? [".env.vercel.prod.pull.tmp", ".env.prod.local"]
    : [".env.vercel.staging.pull", ".env.staging.local"];

for (const name of extraFiles) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || !value || /\[SENSITIVE\]/i.test(value)) continue;
    // For target-specific files, allow override of mismatched env.
    process.env[key] = value;
  }
}

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !/^https:\/\//i.test(url) || !key) {
  console.error("Missing/invalid SUPABASE env");
  process.exit(1);
}

const ref = supabaseProjectRef(url);
if ((target === "staging" || target === "stg") && ref !== STAGING_SUPABASE_REF) {
  console.error(`Expected staging ref ${STAGING_SUPABASE_REF}, got ${ref}`);
  process.exit(1);
}
if ((target === "prod" || target === "production") && ref !== PRODUCTION_SUPABASE_REF) {
  console.error(`Expected production ref ${PRODUCTION_SUPABASE_REF}, got ${ref}`);
  process.exit(1);
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function rest(table, query = "") {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${table} ${res.status}: ${text.slice(0, 300)}`);
  return Array.isArray(body) ? body : [];
}

const [profiles, orders, txs] = await Promise.all([
  rest("profiles", "?select=id,role,email,display_name,status,is_test_account&limit=5000").catch(() =>
    rest("profiles", "?select=id,role,email,display_name,status&limit=5000")
  ),
  rest(
    "orders",
    "?select=id,status,total_amount,created_at,paid_at,paid_cat_food,boss_id,companion_id,customer_service_id,companion_income,platform_fee,parent_order_id,order_type&order=created_at.desc&limit=5000"
  ).catch(() =>
    rest("orders", "?select=id,status,total_amount,created_at,boss_id,companion_id,parent_order_id,order_type&limit=5000")
  ),
  rest(
    "payment_transactions",
    "?select=id,order_id,boss_id,gross_amount,net_amount,payment_status,confirmed_at,created_at&payment_status=eq.paid&limit=5000"
  ).catch(() => []),
]);

const { byId, testIds } = indexProfilesForStats(profiles);
const orderById = new Map((orders || []).map((o) => [o.id, o]));

const parentTx = [];
const childTx = [];
for (const tx of txs || []) {
  const o = orderById.get(tx.order_id);
  if (o?.parent_order_id) childTx.push(tx);
  else parentTx.push(tx);
}

const businessParentTx = parentTx.filter((tx) => {
  const o = orderById.get(tx.order_id);
  if (!o) return false;
  if (["cancelled", "expired", "refunded", "awaiting_payment"].includes(String(o.status || ""))) return false;
  return !isTestTouchedOrder(o, testIds, byId);
});

const A = businessParentTx.reduce((s, t) => s + money(t.gross_amount != null ? t.gross_amount : t.net_amount), 0);
const C = new Set(businessParentTx.map((t) => t.order_id)).size;

const dash = buildDashboardStats({
  profiles,
  orders,
  paymentTransactions: txs,
  withdrawals: [],
});
const B = dash.stats.totalAmount;
const D = dash.stats.validOrders;

const result = {
  ok: Math.abs(A - B) < 0.01 && C === D,
  target,
  ref,
  A_parentTxGrossSum: Math.round(A * 100) / 100,
  B_dashboardTotalAmount: Math.round(B * 100) / 100,
  C_parentTxOrderCount: C,
  D_dashboardValidOrders: D,
  equalAB: Math.abs(A - B) < 0.01,
  equalCD: C === D,
  childTxShouldBeZero: childTx.length,
  childTxSample: childTx.slice(0, 10),
  dashboardFilter: dash.filter,
  note:
    Math.abs(A - B) < 0.01 && C === D
      ? "PASS A=B and C=D"
      : "Mismatch — legacy paid_at-without-TX may inflate B/D, or cancelled parents still have TX",
};

fs.writeFileSync(path.join(outDir, `RECONCILE_${target}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
