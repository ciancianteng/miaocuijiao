#!/usr/bin/env node
/**
 * P0 READ-ONLY Production preflight for companion settlement schema + target orders.
 * No writes.
 *
 * Usage:
 *   node scripts/p0-settlement-preflight-readonly.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(ROOT);
loadEnvFiles(path.resolve(ROOT, "..", "meow-cuijiao-homepage"));

const URL = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const KEY = String(
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const TARGET_NOS = ["MCJO000356", "MCJO000357"];

function refOf(url) {
  return supabaseProjectRef(url);
}

async function rest(q) {
  const res = await fetch(`${URL.replace(/\/$/, "")}/rest/v1/${q}`, {
    method: "GET",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
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
  return { ok: res.ok, status: res.status, body };
}

async function columnExists(table, column) {
  const r = await rest(`${table}?select=${column}&limit=1`);
  if (r.ok) return { exists: true };
  const msg = JSON.stringify(r.body || "");
  if (/42703|does not exist/i.test(msg)) return { exists: false, err: msg.slice(0, 180) };
  return { exists: null, err: `HTTP ${r.status} ${msg.slice(0, 180)}` };
}

async function main() {
  const ref = refOf(URL);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Expected Production ${PRODUCTION_SUPABASE_REF}, got ${ref || "(empty)"}`);
  }
  if (!KEY) throw new Error("Missing service role key");

  const cols = {};
  for (const c of [
    "platform_fee",
    "companion_income",
    "settlement_status",
    "settlement_note",
    "platform_fee_rate",
  ]) {
    cols[c] = await columnExists("orders", c);
  }

  const txIdem = await columnExists("transactions", "idempotency_key");
  const txProbe = await rest(
    "transactions?select=id,user_id,order_id,transaction_type,amount,status,note,created_at&limit=1"
  );

  // Index existence via REST is not available — note for SQL apply script to verify via pg.
  const incomeGlobal = await rest(
    "transactions?transaction_type=eq.companion_income&select=id&limit=5"
  );
  const incomeCount = Array.isArray(incomeGlobal.body) ? incomeGlobal.body.length : null;

  const orders = [];
  for (const no of TARGET_NOS) {
    const r = await rest(
      `orders?order_no=eq.${encodeURIComponent(no)}&select=id,order_no,status,total_amount,companion_id,boss_id,completed_at,order_type,parent_order_id&limit=1`
    );
    const row = Array.isArray(r.body) ? r.body[0] : null;
    let income = [];
    if (row?.id && row?.companion_id) {
      const t = await rest(
        `transactions?order_id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(row.companion_id)}&transaction_type=eq.companion_income&select=id,amount,status&limit=5`
      );
      income = Array.isArray(t.body) ? t.body : [];
    }
    orders.push({
      orderNo: no,
      found: !!row,
      status: row?.status || null,
      amount: row?.total_amount ?? null,
      companionIdShort: row?.companion_id ? String(row.companion_id).slice(0, 8) + "…" : null,
      completedAt: row?.completed_at || null,
      companionIncomeTx: income,
      companionIncomeCount: income.length,
    });
  }

  const companionId = (() => {
    // from first found order via re-query with id only shown short — need full for balance
    return null;
  })();

  // Load companion txs for 晴子 via first order
  let companionSummary = null;
  const first = await rest(
    `orders?order_no=eq.${encodeURIComponent(TARGET_NOS[0])}&select=companion_id&limit=1`
  );
  const cid = Array.isArray(first.body) ? first.body[0]?.companion_id : null;
  if (cid) {
    const allTx = await rest(
      `transactions?user_id=eq.${encodeURIComponent(cid)}&select=id,transaction_type,amount,status&limit=50`
    );
    const list = Array.isArray(allTx.body) ? allTx.body : [];
    const income = list.filter((t) => t.transaction_type === "companion_income" && t.status !== "cancelled");
    companionSummary = {
      companionIdShort: String(cid).slice(0, 8) + "…",
      txCount: list.length,
      companionIncomeActive: income.length,
      companionIncomeSum: income.reduce((n, t) => n + Number(t.amount || 0), 0),
    };
  }

  const report = {
    mode: "READ_ONLY",
    productionRef: ref,
    auditedAt: new Date().toISOString(),
    settlementColumns: cols,
    transactionsIdempotencyKeyColumn: txIdem,
    transactionsSelectOk: txProbe.ok,
    transactionsSampleFields: txProbe.ok && txProbe.body?.[0] ? Object.keys(txProbe.body[0]) : [],
    globalCompanionIncomeSampleCount: incomeCount,
    note:
      "Unique index existence must be confirmed via Postgres information_schema/pg_indexes during apply (REST cannot list indexes).",
    targetOrders: orders,
    companionSummary,
    dbPushWarning:
      "Production has no schema_migrations history suitable for bulk db push — use single-file apply only.",
    scopedSqlFiles: [
      "supabase/pending-prod/p0_01_orders_settlement_columns.sql",
      "supabase/pending-prod/p0_02_transactions_companion_income_uidx.sql",
    ],
  };

  const out = path.join(ROOT, "docs", `p0-settlement-preflight-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error("Wrote " + out);

  const missingCols = Object.entries(cols).filter(([, v]) => v.exists === false).map(([k]) => k);
  if (missingCols.length) {
    console.error("MISSING_COLUMNS=" + missingCols.join(","));
  }
  const badOrders = orders.filter((o) => !o.found || o.status !== "completed" || o.companionIncomeCount > 0);
  if (orders.some((o) => !o.found)) console.error("WARN_ORDER_NOT_FOUND");
  if (orders.every((o) => o.found && o.status === "completed" && o.companionIncomeCount === 0)) {
    console.error("PREFLIGHT_ORDERS_OK_READY_FOR_SCHEMA");
  }
}

main().catch((e) => {
  console.error("PREFLIGHT_FAILED", e.message || e);
  process.exit(1);
});
