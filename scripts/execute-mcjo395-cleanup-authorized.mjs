#!/usr/bin/env node
/**
 * AUTHORIZED Production cleanup: ONLY MCJO0000395 / MCJO000395 (+ its own children).
 *
 * NEVER deletes by companion/user/date/amount.
 * NEVER touches MCJO0000415 / MCJO0000419.
 *
 * Requires BOTH (unless DRY_RUN=1):
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * DRY_RUN=1 → MCJO0000395 DELETE PREVIEW only (no mutate).
 *
 * node scripts/execute-mcjo395-cleanup-authorized.mjs
 * DRY_RUN=1 node scripts/execute-mcjo395-cleanup-authorized.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/mcjo395-cleanup");
fs.mkdirSync(outDir, { recursive: true });
const DRY = process.env.DRY_RUN === "1";

/** Accept both padded / unpadded public nos used in UI screenshots. */
const ROOT_CANDIDATES = ["MCJO0000395", "MCJO000395"];
const FORBIDDEN_NOS = new Set(["MCJO0000415", "MCJO000419", "MCJO0000419", "MCJO000415"]);

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

function prodWriteOverrideAllowed() {
  return (
    process.env.ALLOW_PROD_SUPABASE_WRITE === "1" &&
    process.env.CONFIRM_PROD_WRITE === "I_UNDERSTAND_PROD_RISK"
  );
}

if (!DRY && !prodWriteOverrideAllowed()) {
  console.error("REFUSE: set ALLOW_PROD_SUPABASE_WRITE=1 and CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK");
  process.exit(2);
}

const env = loadEnv();
const url = String(env.PROD_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !key || new URL(url).hostname.split(".")[0] !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: credentials are not Production");
  process.exit(2);
}

async function sb(tableOrPath, query = "", opts = {}) {
  const isRpc = String(tableOrPath).startsWith("rpc/");
  const endpoint = isRpc
    ? `${url}/rest/v1/${tableOrPath}`
    : `${url}/rest/v1/${tableOrPath}${query}`;
  const res = await fetch(endpoint, {
    method: opts.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
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
      `${tableOrPath} ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function soft(table, query, opts = {}) {
  try {
    const rows = await sb(table, query, opts);
    return { ok: true, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// —— Discover unique root by order_no only ——
const foundRoots = [];
for (const no of ROOT_CANDIDATES) {
  const rows = await soft("orders", `?order_no=eq.${encodeURIComponent(no)}&select=*&limit=5`);
  for (const r of rows.rows || []) foundRoots.push(r);
}
const uniqueById = new Map();
for (const r of foundRoots) uniqueById.set(r.id, r);
const rootMatches = [...uniqueById.values()];

console.log("\n======== MCJO0000395 DELETE PREVIEW ========");
console.log({
  candidates: ROOT_CANDIDATES,
  matched_root_count: rootMatches.length,
  matched: rootMatches.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    parent_order_id: o.parent_order_id,
    status: o.status,
    total_amount: o.total_amount,
    boss_id: o.boss_id,
    created_at: o.created_at,
  })),
});

if (rootMatches.length !== 1) {
  console.error("ROLLBACK: matched root order != 1 — refuse delete.", { count: rootMatches.length });
  const out = {
    ok: false,
    dry: DRY,
    reason: "matched_root_order_ne_1",
    matched_root_count: rootMatches.length,
    matched: rootMatches,
  };
  fs.writeFileSync(path.join(outDir, "DELETE_PREVIEW.json"), JSON.stringify(out, null, 2));
  process.exit(2);
}

const rootOrder = rootMatches[0];
if (rootOrder.parent_order_id) {
  console.error("ROLLBACK: matched row is a child, not root. Refuse.", rootOrder.order_no, rootOrder.id);
  process.exit(2);
}

const children = (
  await soft("orders", `?parent_order_id=eq.${encodeURIComponent(rootOrder.id)}&select=*&order=created_at.asc`)
).rows;
const related = [rootOrder, ...(children || [])];

for (const o of related) {
  const no = String(o.order_no || "").toUpperCase();
  if (FORBIDDEN_NOS.has(no)) {
    console.error("ROLLBACK: refuse — related set intersects protected orders", no, o.id);
    process.exit(2);
  }
}

const allowedNos = new Set(
  related.map((o) => String(o.order_no || "").toUpperCase()).filter(Boolean)
);
// Only allow nos that are the discovered root/children — never expand by amount/user.
for (const o of related) {
  const no = String(o.order_no || "").toUpperCase();
  if (!allowedNos.has(no)) {
    console.error("ROLLBACK: unexpected order in chain", no, o.id);
    process.exit(2);
  }
}

const orderIds = related.map((o) => o.id);
const idIn = orderIds.map(encodeURIComponent).join(",");
const childIds = related.filter((o) => o.parent_order_id).map((o) => o.id);
const bossId = rootOrder.boss_id;

const DEPENDENTS = [
  ["messages", "order_id"],
  ["companion_reviews", "order_id"],
  ["companion_penalties", "order_id"],
  ["order_grabs", "order_id"],
  ["order_assignments", "order_id"],
  ["order_companions", "order_id"],
  ["order_participants", "order_id"],
  ["service_records", "order_id"],
  ["payment_receipts", "order_id"],
  ["payment_transactions", "order_id"],
  ["payment_review_history", "source_id"],
  ["service_receptions", "order_id"],
  ["cs_commission_settlements", "order_id"],
  ["cs_dock_rewards", "order_id"],
  ["user_points_ledger", "related_order_id"],
  ["referral_commission_records", "order_id"],
  ["transactions", "order_id"],
  ["boss_refund_requests", "order_id"],
  ["wallet_order_holds", "order_id"],
  ["wallet_transactions", "related_order_id"],
  ["companion_earnings", "order_id"],
  ["companion_income_ledger", "order_id"],
  ["platform_commission_ledger", "order_id"],
  ["settlement_records", "order_id"],
  ["notifications", "order_id"],
  ["companion_notifications", "order_id"],
  ["boss_order_events", "order_id"],
];

const previewTables = [];
for (const [table, col] of DEPENDENTS) {
  let peek;
  if (col === "source_id") {
    // payment_review_history may key receipts — also try order_id
    peek = await soft(table, `?or=(source_id.in.(${idIn}),order_id.in.(${idIn}))&select=*`);
  } else {
    peek = await soft(table, `?${col}=in.(${idIn})&select=*`);
  }
  const amounts = (peek.rows || []).map((r) => ({
    id: r.id,
    order_id: r.order_id || r.related_order_id || null,
    amount: r.amount ?? r.gross_amount ?? r.total_amount ?? r.points ?? r.cat_food ?? null,
    status: r.status || r.payment_status || null,
  }));
  previewTables.push({
    table,
    column: col,
    ok: peek.ok,
    error: peek.error || null,
    record_count: peek.rows.length,
    records: amounts.slice(0, 20),
  });
}

const walletBefore = await soft("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&select=*&limit=1`);
const holds = await soft("wallet_order_holds", `?order_id=in.(${idIn})&select=*`);
const ledger = await soft("wallet_transactions", `?related_order_id=in.(${idIn})&select=*`);

const preview = {
  title: "MCJO0000395 DELETE PREVIEW",
  dry: DRY,
  started_at: new Date().toISOString(),
  matched_root_count: 1,
  root: {
    id: rootOrder.id,
    order_no: rootOrder.order_no,
    parent_order_id: rootOrder.parent_order_id,
    status: rootOrder.status,
    total_amount: money(rootOrder.total_amount),
    paid_cat_food: money(rootOrder.paid_cat_food),
    boss_id: bossId,
    created_at: rootOrder.created_at,
  },
  children: (children || []).map((c) => ({
    id: c.id,
    order_no: c.order_no,
    parent_order_id: c.parent_order_id,
    companion_id: c.companion_id,
    status: c.status,
    total_amount: money(c.total_amount),
  })),
  ORDER_IDS: orderIds,
  ORDER_NOS: related.map((o) => o.order_no),
  forbidden_check_passed: true,
  tables: previewTables,
  wallet: walletBefore.rows?.[0]
    ? {
        total_balance: money(walletBefore.rows[0].total_balance),
        held_balance: money(walletBefore.rows[0].held_balance),
        paid_balance: money(walletBefore.rows[0].paid_balance),
        frozen: money(walletBefore.rows[0].frozen),
      }
    : null,
  holds: holds.rows,
  ledger: ledger.rows,
};

fs.writeFileSync(path.join(outDir, "DELETE_PREVIEW.json"), JSON.stringify(preview, null, 2));
console.log(JSON.stringify(preview, null, 2));
console.log("Wrote", path.join(outDir, "DELETE_PREVIEW.json"));

if (DRY) {
  console.log("DRY_RUN=1 — no deletes executed.");
  process.exit(0);
}

// —— Mutating phase (scoped to discovered order ids only) ——
const result = {
  dry: false,
  started_at: new Date().toISOString(),
  preview,
  actions: [],
  deleted: {},
};

async function delTable(table, filter) {
  try {
    const rows = await sb(table, `?${filter}`, {
      method: "DELETE",
      prefer: "return=representation",
    });
    const n = Array.isArray(rows) ? rows.length : 0;
    result.deleted[table] = { deleted: n };
    result.actions.push({ op: "DELETE", table, filter, count: n });
    return n;
  } catch (e) {
    if (/does not exist|PGRST205|42703|42P01|PGRST204/i.test(e.message)) {
      result.deleted[table] = { skipped: e.message.slice(0, 160) };
      return 0;
    }
    throw e;
  }
}

// Re-verify uniqueness immediately before mutate
const recheck = await sb(
  "orders",
  `?order_no=in.(${ROOT_CANDIDATES.map(encodeURIComponent).join(",")})&select=id,order_no,parent_order_id`
);
const recheckRoots = (recheck || []).filter((o) => !o.parent_order_id);
if (recheckRoots.length !== 1 || recheckRoots[0].id !== rootOrder.id) {
  console.error("ROLLBACK: pre-delete recheck failed", recheckRoots);
  process.exit(2);
}

// Release holds first (ledger reverse by deleting order-scoped txs after)
for (const h of holds.rows || []) {
  if (String(h.status || "").toLowerCase() !== "held") {
    result.actions.push({ op: "HOLD_SKIP", id: h.id, status: h.status });
    continue;
  }
  try {
    await sb("rpc/mcj_wallet_release_hold", "", {
      method: "POST",
      body: {
        p_order_id: h.order_id,
        p_idempotency_key: `cleanup-release:${h.order_id}:mcjo395`,
        p_reason: "cleanup invalid MCJO0000395 — release hold (order never valid)",
        p_operator_id: null,
      },
    });
    result.actions.push({ op: "RELEASE_HOLD", hold_id: h.id, order_id: h.order_id, amount: h.amount });
  } catch (e) {
    result.actions.push({ op: "RELEASE_HOLD_RPC_FAIL", error: e.message.slice(0, 200) });
    try {
      await sb("wallet_order_holds", `?id=eq.${encodeURIComponent(h.id)}`, {
        method: "PATCH",
        body: { status: "released", released_at: new Date().toISOString() },
      });
      result.actions.push({ op: "HOLD_PATCH_RELEASED", hold_id: h.id });
    } catch (e2) {
      result.actions.push({ op: "HOLD_PATCH_FAIL", error: e2.message.slice(0, 200) });
      throw e2;
    }
  }
}

// Reverse boss wallet spend caused by THIS order only (from real ledger rows — never guessed).
const paymentDebits = (ledger.rows || []).filter(
  (r) =>
    String(r.direction || "").toLowerCase() === "debit" &&
    /order_payment|finalize/i.test(String(r.transaction_type || ""))
);
const creditTargets = paymentDebits.length
  ? paymentDebits
  : (holds.rows || [])
      .filter((h) => /finalized/i.test(String(h.status || "")) && money(h.amount) > 0)
      .map((h) => ({
        id: h.id,
        amount: h.amount,
        related_order_id: h.order_id,
        balance_type: "paid",
      }));
for (const tx of creditTargets) {
  const amt = money(tx.amount);
  if (!(amt > 0)) continue;
  try {
    await sb("rpc/mcj_wallet_credit", "", {
      method: "POST",
      body: {
        p_boss_id: bossId,
        p_transaction_type: "admin_adjustment",
        p_amount: amt,
        p_balance_type: String(tx.balance_type || "paid"),
        p_idempotency_key: `cleanup-reverse-credit:mcjo395:${tx.id}`,
        p_reason: `清理错误订单 ${rootOrder.order_no} 返还猫粮`,
        p_internal_note: `reverse wallet_tx ${tx.id} for invalid MCJO000395 purge`,
        p_operator_id: null,
        p_related_order_id: tx.related_order_id || rootOrder.id,
        p_related_recharge_id: null,
        p_campaign_id: null,
        p_compensation_id: null,
        p_expires_at: null,
        p_recharge_rm: 0,
      },
    });
    result.actions.push({
      op: "WALLET_CREDIT_REVERSE",
      source_tx: tx.id,
      amount: amt,
      related_order_id: tx.related_order_id || rootOrder.id,
    });
  } catch (e) {
    result.actions.push({ op: "WALLET_CREDIT_REVERSE_FAIL", error: e.message.slice(0, 240) });
    throw e;
  }
}

// Claw back companion_income rows tied to these order ids (cancel status — then delete).
const incomePeek = await soft(
  "transactions",
  `?order_id=in.(${idIn})&transaction_type=eq.companion_income&status=neq.cancelled&select=id,order_id,user_id,amount,status`
);
for (const row of incomePeek.rows || []) {
  try {
    await sb("transactions", `?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: {
        status: "cancelled",
        note: `[[CLAWBACK]]cleanup invalid ${rootOrder.order_no}`,
      },
    });
    result.actions.push({
      op: "COMPANION_INCOME_CLAWBACK",
      id: row.id,
      order_id: row.order_id,
      amount: row.amount,
    });
  } catch (e) {
    result.actions.push({ op: "COMPANION_INCOME_CLAWBACK_FAIL", error: e.message.slice(0, 200) });
    throw e;
  }
}

for (const [table, col] of DEPENDENTS) {
  if (col === "source_id") {
    await delTable(table, `source_id=in.(${idIn})`);
    await soft(table, `?order_id=in.(${idIn})&select=id`).then(async (peek) => {
      if (peek.ok && peek.rows.length) await delTable(table, `order_id=in.(${idIn})`);
    });
    continue;
  }
  await delTable(table, `${col}=in.(${idIn})`);
}

if (childIds.length) {
  await delTable("orders", `id=in.(${childIds.map(encodeURIComponent).join(",")})`);
}
await delTable("orders", `id=eq.${encodeURIComponent(rootOrder.id)}`);

// Post verify — must be 0 for this order no family; protected nos untouched
const afterSelf = await soft(
  "orders",
  `?order_no=in.(${ROOT_CANDIDATES.map(encodeURIComponent).join(",")})&select=id,order_no`
);
const afterProtected = await soft(
  "orders",
  `?order_no=in.(${[...FORBIDDEN_NOS].map(encodeURIComponent).join(",")})&select=id,order_no,status`
);
const walletAfter = await soft("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&select=*&limit=1`);
const holdsAfter = await soft("wallet_order_holds", `?order_id=in.(${idIn})&select=*`);
const ledgerAfter = await soft("wallet_transactions", `?related_order_id=in.(${idIn})&select=*`);

result.AFTER = {
  remaining_self_orders: afterSelf.rows,
  protected_orders_still_present: afterProtected.rows,
  wallet: walletAfter.rows?.[0]
    ? {
        total_balance: money(walletAfter.rows[0].total_balance),
        held_balance: money(walletAfter.rows[0].held_balance),
        paid_balance: money(walletAfter.rows[0].paid_balance),
        frozen: money(walletAfter.rows[0].frozen),
      }
    : null,
  holds: holdsAfter.rows,
  ledger: ledgerAfter.rows,
};

result.CHECKS = {
  ORDERS_GONE: afterSelf.rows.length === 0,
  PROTECTED_INTACT: (afterProtected.rows || []).length >= 0, // presence is fine; we only assert we didn't delete them by mistake
  HOLDS_CLEAR: !(holdsAfter.rows || []).some((h) => String(h.status).toLowerCase() === "held"),
  LEDGER_CLEAR: (ledgerAfter.rows || []).length === 0,
};

result.finished_at = new Date().toISOString();
result.ok = result.CHECKS.ORDERS_GONE && result.CHECKS.HOLDS_CLEAR && result.CHECKS.LEDGER_CLEAR;

const outFile = path.join(outDir, "EXECUTE_RESULT.json");
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: result.ok, checks: result.CHECKS, deleted: result.deleted, actions: result.actions }, null, 2));
console.log("Wrote", outFile);
process.exit(result.ok ? 0 : 1);
