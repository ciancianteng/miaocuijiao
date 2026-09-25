#!/usr/bin/env node
/**
 * READONLY dry-run: MCJO000399 + DB-confirmed children only.
 * Never INSERT/UPDATE/DELETE.
 *
 * node scripts/dry-run-mcjo399-cleanup.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/mcjo399-cleanup");
fs.mkdirSync(outDir, { recursive: true });

const ROOT_NO = "MCJO000399";
const EXPECTED_CHILD_NOS = new Set(["MCJO000400", "MCJO000401"]);

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
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
    path.join(root, ".env.vercel.prod.pull.tmp"),
  ];
  let merged = {};
  for (const p of candidates) Object.assign(merged, parseEnv(p));
  return merged;
}

const env = loadEnv();
const url = String(env.PROD_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !key) {
  console.error("Missing Production SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];
if (ref !== PRODUCTION_SUPABASE_REF) {
  console.error("Refused: not Production ref", ref);
  process.exit(1);
}

async function sb(table, query = "", opts = {}) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(
      `${table} ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function soft(table, query) {
  try {
    const rows = await sb(table, query);
    return { ok: true, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const rootRows = await sb(
  "orders",
  `?order_no=eq.${encodeURIComponent(ROOT_NO)}&select=*&limit=5`
);
if (!Array.isArray(rootRows) || !rootRows.length) {
  console.error("ROOT NOT FOUND", ROOT_NO);
  process.exit(1);
}
const rootOrder = rootRows[0];
if (rootOrder.parent_order_id) {
  console.error("Refused: MCJO000399 is not a root (has parent_order_id)");
  process.exit(1);
}

const children = await sb(
  "orders",
  `?parent_order_id=eq.${encodeURIComponent(rootOrder.id)}&select=*&order=created_at.asc`
);
const childList = Array.isArray(children) ? children : [];
for (const c of childList) {
  const no = String(c.order_no || "").toUpperCase();
  if (no && !EXPECTED_CHILD_NOS.has(no)) {
    console.warn("WARN unexpected child order_no (still in-scope via parent_order_id):", no, c.id);
  }
}

const related = [rootOrder, ...childList];
const orderIds = related.map((o) => o.id);
const idIn = orderIds.map(encodeURIComponent).join(",");

const profileIds = [...new Set(related.flatMap((o) => [o.boss_id, o.companion_id]).filter(Boolean))];
const profiles = profileIds.length
  ? await sb(
      "profiles",
      `?id=in.(${profileIds.map(encodeURIComponent).join(",")})&select=id,display_name,boss_uid,email,role`
    )
  : [];
const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

async function byOrderCol(table, col = "order_id", select = "*") {
  return soft(table, `?${col}=in.(${idIn})&select=${select}`);
}

const payment_receipts = await byOrderCol("payment_receipts");
const payment_transactions = await byOrderCol("payment_transactions");
const wallet_order_holds = await byOrderCol("wallet_order_holds");
const wallet_tx_order = await byOrderCol("wallet_transactions");
const wallet_tx_related = await soft(
  "wallet_transactions",
  `?related_order_id=in.(${idIn})&select=*`
);
const transactions = await byOrderCol("transactions");
const boss_commission_earnings = await byOrderCol("boss_commission_earnings");
const companion_earnings = await byOrderCol("companion_earnings");
const referral_commission_records = await byOrderCol("referral_commission_records");
const cs_commission_settlements = await byOrderCol("cs_commission_settlements");
const order_status_logs = await byOrderCol("order_status_logs");
const order_grabs = await byOrderCol("order_grabs");
const messages = await byOrderCol("messages");
const boss_notifications = await soft(
  "boss_notifications",
  `?order_id=in.(${idIn})&select=*`
);
const companion_notifications = await soft(
  "companion_notifications",
  `?order_id=in.(${idIn})&select=*`
);
const refunds = await soft("boss_refund_requests", `?order_id=in.(${idIn})&select=*`);
const user_points = await soft("user_points_ledger", `?related_order_id=in.(${idIn})&select=*`);

// Idempotency-key style wallet rows
const holdKeys = orderIds.flatMap((id) => {
  const o = related.find((x) => x.id === id);
  const no = o?.order_no || id;
  return [`order-hold:${no}`, `order-hold:${id}`, `order-pay:${no}`, `order-pay:${id}`];
});
const wallet_by_idem = [];
for (const k of holdKeys) {
  const r = await soft(
    "wallet_transactions",
    `?idempotency_key=eq.${encodeURIComponent(k)}&select=*`
  );
  wallet_by_idem.push(...r.rows);
}

const bossId = rootOrder.boss_id;
const wallet = bossId
  ? await soft("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&select=*&limit=1`)
  : { ok: false, rows: [] };

const approvedReceipts = (payment_receipts.rows || []).filter((r) =>
  /approved|confirmed|paid/i.test(String(r.status || r.review_status || ""))
);
const proofRows = (payment_receipts.rows || []).filter(
  (r) => r.storage_path || r.payment_proof_path || r.proof_url || r.file_path
);

const gmvContribution = money(rootOrder.total_amount); // root-only

function summarize(label, pack) {
  const rows = pack.rows || [];
  const sum = rows.reduce(
    (n, r) => n + money(r.amount ?? r.total_amount ?? r.boss_commission_amount ?? r.net_amount ?? 0),
    0
  );
  return {
    table_ok: pack.ok,
    error: pack.error || null,
    count: rows.length,
    sum,
    sample: rows.slice(0, 5).map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount ?? r.total_amount ?? r.boss_commission_amount,
      type: r.transaction_type || r.type || null,
      order_id: r.order_id || r.related_order_id || null,
    })),
  };
}

const report = {
  readonly: true,
  produced_at: new Date().toISOString(),
  production_ref: ref,
  ROOT_ORDER: {
    id: rootOrder.id,
    order_no: rootOrder.order_no,
    status: rootOrder.status,
    amount: money(rootOrder.total_amount),
    boss_id: rootOrder.boss_id,
    boss: profileMap[rootOrder.boss_id]?.display_name || "",
    boss_uid: profileMap[rootOrder.boss_id]?.boss_uid || "",
    created_at: rootOrder.created_at,
    paid_at: rootOrder.paid_at || null,
    paid_cat_food: money(rootOrder.paid_cat_food),
    payment_method: rootOrder.payment_method || "",
    order_type: rootOrder.order_type,
    parent_order_id: rootOrder.parent_order_id,
  },
  RELATED_ORDERS: related.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    status: o.status,
    amount: money(o.total_amount),
    companion: profileMap[o.companion_id]?.display_name || "",
    companion_id: o.companion_id || null,
    parent_order_id: o.parent_order_id,
    role: o.parent_order_id ? "child" : "root",
  })),
  RELATED_COMPANIONS: [
    ...new Set(
      related
        .filter((o) => o.companion_id)
        .map((o) => `${profileMap[o.companion_id]?.display_name || o.companion_id}`)
    ),
  ],
  ORDER_IDS: orderIds,
  PAYMENT_PROOF: proofRows.length ? "HAS_PROOF" : "NONE",
  CS_REVIEW: approvedReceipts.length
    ? {
        count: approvedReceipts.length,
        approved_at: approvedReceipts.map((r) => r.reviewed_at || r.confirmed_at || r.approved_at),
      }
    : "NONE",
  CS_APPROVED_AT: approvedReceipts[0]?.reviewed_at || approvedReceipts[0]?.confirmed_at || null,
  WALLET_HOLD: summarize("wallet_order_holds", wallet_order_holds),
  WALLET_LEDGER: {
    by_order_id: summarize("wallet_transactions.order_id", wallet_tx_order),
    by_related_order_id: summarize("wallet_transactions.related_order_id", wallet_tx_related),
    by_idempotency_key: {
      count: wallet_by_idem.length,
      rows: wallet_by_idem.map((r) => ({
        id: r.id,
        amount: r.amount,
        direction: r.direction,
        type: r.transaction_type,
        idempotency_key: r.idempotency_key,
        status: r.status,
      })),
    },
  },
  TRANSACTIONS: summarize("transactions", transactions),
  COMPANION_EARNING: summarize("companion_earnings", companion_earnings),
  COMMISSION: summarize("boss_commission_earnings", boss_commission_earnings),
  REFERRAL_EARNING: summarize("referral_commission_records", referral_commission_records),
  CS_COMMISSION: summarize("cs_commission_settlements", cs_commission_settlements),
  NOTIFICATIONS: {
    boss: summarize("boss_notifications", boss_notifications),
    companion: summarize("companion_notifications", companion_notifications),
  },
  ORDER_EVENTS: summarize("order_status_logs", order_status_logs),
  ORDER_GRABS: summarize("order_grabs", order_grabs),
  MESSAGES: summarize("messages", messages),
  REFUNDS: summarize("boss_refund_requests", refunds),
  POINTS: summarize("user_points_ledger", user_points),
  BOSS_WALLET: wallet.rows?.[0]
    ? {
        id: wallet.rows[0].id,
        balance: money(wallet.rows[0].balance ?? wallet.rows[0].available_balance),
        held: money(wallet.rows[0].held_balance ?? wallet.rows[0].reserved_balance),
        raw_keys: Object.keys(wallet.rows[0]),
      }
    : null,
  GMV_CONTRIBUTION_ROOT: gmvContribution,
  DELETE_BASIS: {
    PAYMENT_PROOF: proofRows.length ? "HAS_PROOF" : "NONE",
    CS_APPROVED_AT: approvedReceipts[0]?.reviewed_at || approvedReceipts[0]?.confirmed_at || "NONE",
    SAFE_TO_DELETE:
      proofRows.length === 0 &&
      approvedReceipts.length === 0 &&
      String(rootOrder.status).toLowerCase() !== "completed",
  },
  EXCLUDED: {
    note: "Do NOT delete MCJO000395/396 — separate tree",
    excluded_order_nos: ["MCJO000395", "MCJO000396"],
  },
};

fs.writeFileSync(path.join(outDir, "DRY_RUN.json"), JSON.stringify(report, null, 2));
const lines = [
  `ROOT_ORDER = ${report.ROOT_ORDER.order_no} ${report.ROOT_ORDER.id} status=${report.ROOT_ORDER.status} amt=${report.ROOT_ORDER.amount}`,
  `RELATED_ORDERS = ${report.RELATED_ORDERS.map((o) => o.order_no).join(", ")}`,
  `RELATED_COMPANIONS = ${report.RELATED_COMPANIONS.join(", ") || "-"}`,
  `PAYMENT_PROOF = ${report.PAYMENT_PROOF}`,
  `CS_REVIEW = ${typeof report.CS_REVIEW === "string" ? report.CS_REVIEW : JSON.stringify(report.CS_REVIEW)}`,
  `CS_APPROVED_AT = ${report.CS_APPROVED_AT || "NONE"}`,
  `WALLET_HOLD = count=${report.WALLET_HOLD.count} sum=${report.WALLET_HOLD.sum}`,
  `WALLET_LEDGER = order_id=${report.WALLET_LEDGER.by_order_id.count} related=${report.WALLET_LEDGER.by_related_order_id.count} idem=${report.WALLET_LEDGER.by_idempotency_key.count}`,
  `COMPANION_EARNING = ${report.COMPANION_EARNING.count}`,
  `COMMISSION = ${report.COMMISSION.count}`,
  `REFERRAL_EARNING = ${report.REFERRAL_EARNING.count}`,
  `NOTIFICATIONS = boss=${report.NOTIFICATIONS.boss.count} companion=${report.NOTIFICATIONS.companion.count}`,
  `GMV_CONTRIBUTION_ROOT = ${report.GMV_CONTRIBUTION_ROOT}`,
  `SAFE_TO_DELETE = ${report.DELETE_BASIS.SAFE_TO_DELETE}`,
];
fs.writeFileSync(path.join(outDir, "DRY_RUN.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log("\nWrote", path.join(outDir, "DRY_RUN.json"));
process.exit(report.DELETE_BASIS.SAFE_TO_DELETE ? 0 : 2);
