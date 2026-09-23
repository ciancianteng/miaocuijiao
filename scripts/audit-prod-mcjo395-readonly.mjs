#!/usr/bin/env node
/** Production READ-ONLY audit MCJO000395 — soft column selects. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-pay-395");
fs.mkdirSync(outDir, { recursive: true });

function parseEnv(p) {
  const o = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
const url = env.SUPABASE_URL.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (new URL(url).hostname.split(".")[0] !== PRODUCTION_SUPABASE_REF) process.exit(2);
const h = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };

async function rest(q) {
  const r = await fetch(url + q, { headers: h });
  const t = await r.text();
  let rows;
  try {
    rows = JSON.parse(t || "[]");
  } catch {
    rows = { raw: t.slice(0, 500) };
  }
  return { status: r.status, rows };
}

const baseCols =
  "id,order_no,order_type,parent_order_id,status,total_amount,unit_price,hours,companion_id,boss_id,created_at,accepted_at,started_at,completed_at,description";

const parentR = await rest(`/rest/v1/orders?order_no=eq.MCJO000395&select=${baseCols}`);
const parent = Array.isArray(parentR.rows) ? parentR.rows[0] : null;

let paidStamp = null;
if (parent?.id) {
  for (const extra of ["paid_at,paid_cat_food", "paid_at", "paid_cat_food"]) {
    const r = await rest(`/rest/v1/orders?id=eq.${parent.id}&select=id,${extra}`);
    if (r.status === 200 && Array.isArray(r.rows) && r.rows[0]) {
      paidStamp = r.rows[0];
      break;
    }
  }
}

let children = [];
if (parent?.id) {
  const ch = await rest(
    `/rest/v1/orders?parent_order_id=eq.${parent.id}&select=${baseCols}&order=created_at.asc`
  );
  children = Array.isArray(ch.rows) ? ch.rows : [];
}

let wallet = null;
let walletTxNear = [];
let debit70 = [];
if (parent?.boss_id) {
  const w = await rest(`/rest/v1/wallets?user_id=eq.${parent.boss_id}&select=*&limit=1`);
  wallet = Array.isArray(w.rows) ? w.rows[0] : w.rows;
  const since = encodeURIComponent((parent.created_at || "2026-09-23T00:00:00Z").replace(/\+.*/, "Z"));
  for (const table of ["wallet_transactions", "wallet_ledger", "wallet_tx"]) {
    const r = await rest(
      `/rest/v1/${table}?user_id=eq.${parent.boss_id}&created_at=gte.${since}&order=created_at.desc&limit=50`
    );
    if (r.status === 200 && Array.isArray(r.rows)) {
      walletTxNear = r.rows;
      break;
    }
  }
  debit70 = walletTxNear.filter((row) => {
    const amt = Number(row.amount ?? row.cat_food ?? row.cat_food_amount ?? row.delta ?? 0);
    const blob = JSON.stringify(row);
    return Math.abs(amt) === 70 || blob.includes(parent.id) || blob.includes("MCJO000395");
  });
}

const report = {
  ok: true,
  mode: "READ_ONLY",
  orderNo: "MCJO000395",
  parent,
  paidStamp,
  children,
  childCount: children.length,
  walletSummary: wallet
    ? {
        user_id: wallet.user_id || wallet.id,
        balance: wallet.balance ?? wallet.total_balance ?? wallet.paid_balance,
        keys: Object.keys(wallet).slice(0, 30),
      }
    : null,
  walletTxNearCount: walletTxNear.length,
  debit70,
  verdict: {
    parentStatus: parent?.status || null,
    totalAmount: parent?.total_amount ?? null,
    childrenStatuses: children.map((c) => ({ no: c.order_no, status: c.status, amount: c.total_amount })),
    paidAt: paidStamp?.paid_at ?? null,
    paidCatFood: paidStamp?.paid_cat_food ?? null,
    alreadyPastAwaitingPayment: parent?.status && parent.status !== "awaiting_payment",
    debitHitCount: debit70.length,
    note:
      "Parent already in_progress on Production — paid happened without lasting awaiting_payment observation. Wallet debit rows listed when schema allows.",
  },
};

fs.writeFileSync(path.join(outDir, "AUDIT_MCJO000395.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.verdict, null, 2));
console.log("debit70 sample", JSON.stringify(debit70.slice(0, 3), null, 2));
