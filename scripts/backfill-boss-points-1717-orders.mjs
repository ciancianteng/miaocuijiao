#!/usr/bin/env node
/**
 * One-shot idempotent backfill for boss 1717 missing order points (MCJO000356 / MCJO000357).
 *
 * DEFAULT = DRY RUN (no writes).
 *
 * Production write requires BOTH:
 *   ALLOW_PROD_POINTS_BACKFILL=1
 *   CONFIRM_PROD_POINTS_BACKFILL=I_UNDERSTAND_PROD_RISK
 *
 * Uses awardBossPointsForCompletedOrder → order_points:{order_id} ledger (never raw UPDATE balance).
 *
 * Usage:
 *   node scripts/backfill-boss-points-1717-orders.mjs
 *   ALLOW_PROD_POINTS_BACKFILL=1 CONFIRM_PROD_POINTS_BACKFILL=I_UNDERSTAND_PROD_RISK \\
 *     node scripts/backfill-boss-points-1717-orders.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PROD_REF = "jqfaknpmcnqwqvatrwgo";
const TARGET_ORDER_NOS = Object.freeze(["MCJO000356", "MCJO000357"]);
const EXPECTED_EACH = 300;
const EXPECTED_TOTAL = 600;
const BOSS_HINT = "1717";

const URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = URL.replace(/^https?:\/\//, "").split(".")[0];

const allowWrite =
  String(process.env.ALLOW_PROD_POINTS_BACKFILL || "").trim() === "1" &&
  String(process.env.CONFIRM_PROD_POINTS_BACKFILL || "").trim() === "I_UNDERSTAND_PROD_RISK";

function fail(msg, code = 2) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(code);
}

if (!URL || !KEY) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
if (ref !== PROD_REF) fail(`NOT_PRODUCTION ref=${ref} (expected ${PROD_REF})`);

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function rest(table, qs, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${table}?${qs}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${table} ${res.status} ${String(text).slice(0, 400)}`);
  }
  return json;
}

const { awardBossPointsForCompletedOrder, orderPointsIdempotencyKey } = await import(
  "../server/api/_user-points.js"
);
const { isPointsAwardEnabled } = await import("../server/api/_feature-flags.js");

const orders = await rest(
  "orders",
  `order_no=in.(${TARGET_ORDER_NOS.map((n) => `"${n}"`).join(",")})&select=id,order_no,boss_id,status,total_amount,paid_cat_food,completed_at,companion_id`
);
const byNo = Object.fromEntries((orders || []).map((o) => [o.order_no, o]));

const plan = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  if (!order) {
    plan.push({ order_no: no, ok: false, error: "order_not_found" });
    continue;
  }
  const key = orderPointsIdempotencyKey(order.id);
  let existing = [];
  try {
    existing = await rest("user_points_ledger", `idempotency_key=eq.${encodeURIComponent(key)}&select=id,points,user_id,created_at&limit=3`);
  } catch (e) {
    plan.push({ order_no: no, order_id: order.id, ok: false, error: String(e.message || e) });
    continue;
  }
  plan.push({
    order_no: no,
    order_id: order.id,
    boss_id: order.boss_id,
    status: order.status,
    total_amount: order.total_amount,
    paid_cat_food: order.paid_cat_food,
    idempotency_key: key,
    expected_points: EXPECTED_EACH,
    ledger_exists: Array.isArray(existing) && existing.length > 0,
    existing_ledger: existing || [],
  });
}

const bossId = plan.find((p) => p.boss_id)?.boss_id || null;
let accountBefore = null;
if (bossId) {
  try {
    accountBefore = (
      await rest("user_points_accounts", `user_id=eq.${encodeURIComponent(bossId)}&select=user_id,balance,lifetime_earned&limit=1`)
    )?.[0] || null;
  } catch {
    accountBefore = null;
  }
}

const report = {
  ok: true,
  mode: allowWrite ? "WRITE" : "DRY_RUN",
  projectRef: ref,
  boss_hint: BOSS_HINT,
  boss_id: bossId,
  points_award_enabled: isPointsAwardEnabled(),
  expected_total: EXPECTED_TOTAL,
  account_before: accountBefore,
  plan,
  note: allowWrite
    ? "WRITE mode: will call awardBossPointsForCompletedOrder per missing order."
    : "DRY_RUN only. Set ALLOW_PROD_POINTS_BACKFILL=1 and CONFIRM_PROD_POINTS_BACKFILL=I_UNDERSTAND_PROD_RISK to apply.",
};

if (!allowWrite) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (!isPointsAwardEnabled()) {
  fail("POINTS_AWARD_ENABLED is off — refuse write backfill (would only skip). Enable flag first.");
}

const results = [];
for (const row of plan) {
  if (!row.order_id) {
    results.push(row);
    continue;
  }
  if (row.ledger_exists) {
    results.push({ ...row, action: "skip_existing", awarded: 0 });
    continue;
  }
  if (String(row.status || "").toLowerCase() !== "completed") {
    results.push({ ...row, action: "skip_not_completed", awarded: 0 });
    continue;
  }
  const order = byNo[row.order_no];
  const award = await awardBossPointsForCompletedOrder(order, {
    method: "admin_force",
    operatorId: null,
  });
  results.push({
    ...row,
    action: "award",
    award,
    awarded: Number(award?.points) || 0,
  });
}

let accountAfter = null;
if (bossId) {
  accountAfter = (
    await rest("user_points_accounts", `user_id=eq.${encodeURIComponent(bossId)}&select=user_id,balance,lifetime_earned&limit=1`)
  )?.[0] || null;
}

const verify = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  if (!order) continue;
  const key = orderPointsIdempotencyKey(order.id);
  const ledger = await rest(
    "user_points_ledger",
    `idempotency_key=eq.${encodeURIComponent(key)}&select=id,points,user_id,source,created_at&limit=3`
  );
  verify.push({
    order_no: no,
    order_id: order.id,
    idempotency_key: key,
    ledger_count: (ledger || []).length,
    points: ledger?.[0]?.points ?? null,
  });
}

// Idempotent re-run probe (should not increase again)
const rerun = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  if (!order) continue;
  const award = await awardBossPointsForCompletedOrder(order, { method: "admin_force" });
  rerun.push({
    order_no: no,
    duplicate: !!award?.duplicate || !!award?.skipped,
    points: Number(award?.points) || 0,
    error: award?.error || null,
  });
}

const out = {
  ...report,
  mode: "WRITE",
  results,
  account_after: accountAfter,
  verify,
  rerun,
  balance_delta:
    accountAfter && accountBefore
      ? Number(accountAfter.balance || 0) - Number(accountBefore.balance || 0)
      : accountAfter
        ? Number(accountAfter.balance || 0)
        : null,
};

console.log(JSON.stringify(out, null, 2));

const allHaveLedger = verify.every((v) => v.ledger_count >= 1 && Number(v.points) === EXPECTED_EACH);
if (!allHaveLedger) process.exit(1);
