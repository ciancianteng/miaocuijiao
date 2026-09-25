#!/usr/bin/env node
/**
 * AUTHORIZED Production cleanup: MCJO000399 + children only.
 *
 * Requires BOTH:
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * DRY_RUN=1 → snapshot + plan only (no mutate).
 *
 * node scripts/execute-mcjo399-cleanup-authorized.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/mcjo399-cleanup");
fs.mkdirSync(outDir, { recursive: true });
const DRY = process.env.DRY_RUN === "1";

const ALLOWED_NOS = new Set(["MCJO000399", "MCJO000400", "MCJO000401"]);
const ROOT_NO = "MCJO000399";

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

// —— Discover allowlist ——
const rootRows = await sb("orders", `?order_no=eq.${encodeURIComponent(ROOT_NO)}&select=*&limit=2`);
if (!rootRows?.length) {
  console.error("ROOT already gone or not found:", ROOT_NO);
  process.exit(1);
}
const rootOrder = rootRows[0];
const children = await sb(
  "orders",
  `?parent_order_id=eq.${encodeURIComponent(rootOrder.id)}&select=*&order=created_at.asc`
);
const related = [rootOrder, ...(children || [])];
for (const o of related) {
  const no = String(o.order_no || "").toUpperCase();
  if (!ALLOWED_NOS.has(no)) {
    console.error("REFUSE: unexpected order in chain", no, o.id);
    process.exit(2);
  }
}
const orderIds = related.map((o) => o.id);
const idIn = orderIds.map(encodeURIComponent).join(",");
const childIds = related.filter((o) => o.parent_order_id).map((o) => o.id);
const bossId = rootOrder.boss_id;

// Re-verify delete basis
const receipts = await soft("payment_receipts", `?order_id=in.(${idIn})&select=*`);
const approved = (receipts.rows || []).filter((r) =>
  /approved|confirmed|paid/i.test(String(r.status || r.review_status || ""))
);
const proof = (receipts.rows || []).filter(
  (r) => r.storage_path || r.payment_proof_path || r.proof_url || r.file_path
);
if (proof.length || approved.length) {
  console.error("REFUSE: proof or CS approve present", { proof: proof.length, approved: approved.length });
  process.exit(2);
}

const walletBefore = await soft("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&select=*&limit=1`);
const holds = await soft("wallet_order_holds", `?order_id=in.(${idIn})&select=*`);
const ledger = await soft("wallet_transactions", `?related_order_id=in.(${idIn})&select=*`);

// Root-only GMV proxy: count in_progress/completed parents today (snapshot by listing 399 contribution)
const gmvBefore = {
  root_amount: money(rootOrder.total_amount),
  root_status: rootOrder.status,
  counts_as_revenue: !rootOrder.parent_order_id && !["awaiting_payment", "cancelled"].includes(String(rootOrder.status)),
};

const result = {
  dry: DRY,
  started_at: new Date().toISOString(),
  ORDER_IDS: orderIds,
  ORDER_NOS: related.map((o) => o.order_no),
  BEFORE: {
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
    gmv: gmvBefore,
    messages: (await soft("messages", `?order_id=in.(${idIn})&select=id`)).rows.length,
  },
  actions: [],
  deleted: {},
};

async function delTable(table, filter) {
  if (DRY) {
    const peek = await soft(table, `?${filter}&select=id`);
    result.deleted[table] = { planned: peek.rows.length };
    result.actions.push({ op: "DELETE_PLAN", table, filter, count: peek.rows.length });
    return peek.rows.length;
  }
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
    if (/does not exist|PGRST205|42703|42P01/i.test(e.message)) {
      result.deleted[table] = { skipped: e.message.slice(0, 120) };
      return 0;
    }
    throw e;
  }
}

// 1) Release wallet hold for root (and any child holds)
for (const h of holds.rows || []) {
  if (String(h.status || "").toLowerCase() !== "held") {
    result.actions.push({ op: "HOLD_SKIP", id: h.id, status: h.status });
    continue;
  }
  if (DRY) {
    result.actions.push({ op: "RELEASE_HOLD_PLAN", hold_id: h.id, order_id: h.order_id, amount: h.amount });
    continue;
  }
  try {
    await sb("rpc/mcj_wallet_release_hold", "", {
      method: "POST",
      body: {
        p_order_id: h.order_id,
        p_idempotency_key: `cleanup-release:${h.order_id}:mcjo399`,
        p_reason: "cleanup invalid MCJO000399 — release hold (order never valid)",
        p_operator_id: null,
      },
    });
    result.actions.push({ op: "RELEASE_HOLD", hold_id: h.id, order_id: h.order_id, amount: h.amount });
  } catch (e) {
    // Fallback: mark hold released if RPC fails but row exists
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

// 2) Order-scoped dependents (best-effort)
const DEPENDENTS = [
  ["messages", "order_id"],
  ["companion_reviews", "order_id"],
  ["companion_penalties", "order_id"],
  ["order_grabs", "order_id"],
  ["payment_receipts", "order_id"],
  ["payment_transactions", "order_id"],
  ["service_receptions", "order_id"],
  ["cs_commission_settlements", "order_id"],
  ["cs_dock_rewards", "order_id"],
  ["user_points_ledger", "related_order_id"],
  ["referral_commission_records", "order_id"],
  ["transactions", "order_id"],
  ["boss_refund_requests", "order_id"],
  ["wallet_order_holds", "order_id"],
  ["wallet_transactions", "related_order_id"],
];

for (const [table, col] of DEPENDENTS) {
  await delTable(table, `${col}=in.(${idIn})`);
}

// 3) Delete child orders then root
if (childIds.length) {
  await delTable("orders", `id=in.(${childIds.map(encodeURIComponent).join(",")})`);
}
await delTable("orders", `id=eq.${encodeURIComponent(rootOrder.id)}`);

// 4) Post verify
const afterOrders = await soft(
  "orders",
  `?order_no=in.(${[...ALLOWED_NOS].map(encodeURIComponent).join(",")})&select=id,order_no,status`
);
const walletAfter = await soft("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&select=*&limit=1`);
const holdsAfter = await soft("wallet_order_holds", `?order_id=in.(${idIn})&select=*`);
const ledgerAfter = await soft("wallet_transactions", `?related_order_id=in.(${idIn})&select=*`);

result.AFTER = {
  remaining_orders: afterOrders.rows,
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
  ORDERS_GONE: afterOrders.rows.length === 0,
  HOLDS_CLEAR: !(holdsAfter.rows || []).some((h) => String(h.status).toLowerCase() === "held"),
  GMV_ROLLBACK_EXPECTED: gmvBefore.root_amount,
  WALLET_HELD_DELTA:
    money(result.BEFORE.wallet?.held_balance) - money(result.AFTER.wallet?.held_balance),
};

result.finished_at = new Date().toISOString();
result.ok = DRY
  ? true
  : result.CHECKS.ORDERS_GONE && result.CHECKS.HOLDS_CLEAR;

const outFile = path.join(outDir, DRY ? "EXECUTE_DRY.json" : "EXECUTE_RESULT.json");
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: result.ok, dry: DRY, checks: result.CHECKS, deleted: result.deleted, actions: result.actions }, null, 2));
console.log("Wrote", outFile);
process.exit(result.ok ? 0 : 1);
