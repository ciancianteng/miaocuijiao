#!/usr/bin/env node
/**
 * READONLY: Production wallet / orders for boss id hrmn.
 * Never INSERT/UPDATE/DELETE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-hrmn-wallet");
fs.mkdirSync(outDir, { recursive: true });

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !/\[SENSITIVE\]/i.test(v)) o[m[1]] = v;
  }
  return o;
}

function loadEnv() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, ".env.vercel.prod.pull.tmp"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    "C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local",
  ];
  const merged = {};
  for (const p of candidates) {
    for (const [k, v] of Object.entries(parseEnv(p))) {
      if (!merged[k]) merged[k] = v;
    }
  }
  return merged;
}

const env = loadEnv();
const url = String(env.PROD_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
const ref = url ? new URL(url).hostname.split(".")[0] : "";
if (!url || !key || ref !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: production credentials missing or wrong ref", ref || "none");
  process.exit(2);
}

async function rest(table, query) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) return { ok: false, status: res.status, error: body?.message || body?.hint || text.slice(0, 240) };
  return { ok: true, rows: Array.isArray(body) ? body : [] };
}

const needle = "hrmn";
const profiles = await rest(
  "profiles",
  `?or=(display_name.ilike.*${needle}*,email.ilike.*${needle}*,boss_uid.ilike.*${needle}*)&select=id,boss_uid,display_name,email,role,is_test_account,status&limit=20`
);

const report = { ref, profileQueryOk: profiles.ok, profileError: profiles.error || null, matches: [] };

for (const p of profiles.rows || []) {
  const id = p.id;
  const wallet = await rest("wallets", `?boss_id=eq.${encodeURIComponent(id)}&select=*&limit=2`);
  const txs = await rest(
    "wallet_transactions",
    `?boss_id=eq.${encodeURIComponent(id)}&select=id,transaction_type,amount,direction,balance_type,related_order_id,compensation_id,reason,idempotency_key,paid_balance_after,bonus_balance_after,total_balance_after,created_at&order=created_at.asc&limit=200`
  );
  const holds = await rest(
    "wallet_order_holds",
    `?boss_id=eq.${encodeURIComponent(id)}&select=id,order_id,order_no,amount,status,paid_taken,bonus_taken,created_at,updated_at,finalized_at,released_at&order=created_at.asc&limit=50`
  );
  const orders = await rest(
    "orders",
    `?boss_id=eq.${encodeURIComponent(id)}&select=id,order_no,status,total_amount,paid_cat_food,hours,unit_price,game,order_type,assignment_type,companion_id,created_at,paid_at&order=created_at.asc&limit=50`
  );
  report.matches.push({
    profile: {
      id: p.id,
      boss_uid: p.boss_uid,
      public_id: p.public_id || null,
      display_name: p.display_name,
      nickname: p.nickname || null,
      email: p.email,
      role: p.role,
      is_test_account: p.is_test_account,
      status: p.status,
    },
    wallet: wallet.ok ? wallet.rows : { error: wallet.error },
    txs: txs.ok ? txs.rows : { error: txs.error },
    holds: holds.ok ? holds.rows : { error: holds.error },
    orders: orders.ok ? orders.rows : { error: orders.error, status: orders.status },
  });
}

const orderIds = ["1a979188-6878-4fa5-81dc-9538ec798ce4", "4f08aee7-01c6-4437-816f-ccaeed1de82f"];
report.ordersById = await rest(
  "orders",
  `?id=in.(${orderIds.join(",")})&select=id,order_no,status,total_amount,paid_cat_food,paid_at,order_type,assignment_type,companion_id,customer_service_id,created_at&limit=10`
);
report.grabs435 = await rest(
  "order_grabs",
  "?order_id=eq.4f08aee7-01c6-4437-816f-ccaeed1de82f&select=id,companion_id,status,created_at&limit=20"
);
report.listings435 = await rest(
  "order_grab_listings",
  "?order_id=eq.4f08aee7-01c6-4437-816f-ccaeed1de82f&select=id,status,created_at&limit=5"
);

report.compRow = await rest(
  "wallet_transactions",
  "?id=eq.ce99b431-e64d-433b-8674-07bfe8f9fd8a&select=id,transaction_type,amount,direction,reason,internal_note,idempotency_key,compensation_id,paid_balance_after,bonus_balance_after,created_at&limit=1"
);

const out = path.join(outDir, "AUDIT.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  matches: report.matches.length,
  names: report.matches.map((m) => ({
    id: m.profile.id,
    uid: m.profile.boss_uid,
    name: m.profile.display_name || m.profile.nickname,
    role: m.profile.role,
    walletOk: Array.isArray(m.wallet),
    txCount: Array.isArray(m.txs) ? m.txs.length : m.txs,
    holdCount: Array.isArray(m.holds) ? m.holds.length : m.holds,
    orderErr: m.orders?.error || null,
    orderCount: Array.isArray(m.orders) ? m.orders.length : null,
  })),
  profileError: report.profileError,
  out,
}, null, 2));
