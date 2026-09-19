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
 * Production schema notes (do not assume unpaid columns exist):
 *   - orders amount source: total_amount (paid_cat_food may be absent)
 *   - user_points_ledger delta field: delta (not points)
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
const ENV_CANDIDATES = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env"),
  // Sibling main checkout (worktree convenience)
  path.resolve(ROOT, "..", "meow-cuijiao-homepage", ".env.local"),
];
for (const p of ENV_CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/^["']|["']$/g, "");
    // Overwrite empty process values so worktree shells with blank env still work
    if (process.env[key] != null && String(process.env[key]).trim() !== "") continue;
    process.env[key] = val;
  }
}

const PROD_REF = "jqfaknpmcnqwqvatrwgo";
const TARGET_ORDER_NOS = Object.freeze(["MCJO000356", "MCJO000357"]);
const BOSS_DISPLAY_NAME = "1717";
/** Product expectation for acceptance report only — never used to force award amounts. */
const PRODUCT_EXPECT_EACH = 300;
const PRODUCT_EXPECT_TOTAL = 600;

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

const {
  awardBossPointsForCompletedOrder,
  orderPointsIdempotencyKey,
  orderEffectiveCatFoodSpend,
  computeOrderRewardPoints,
  getBossPointsSettings,
} = await import("../server/api/_user-points.js");
const { isPointsAwardEnabled } = await import("../server/api/_feature-flags.js");

// Production may lack paid_cat_food — select only columns known to exist.
// Formal award helper still falls back: paid_cat_food > 0 ? paid_cat_food : total_amount.
const orders = await rest(
  "orders",
  `order_no=in.(${TARGET_ORDER_NOS.map((n) => `"${n}"`).join(",")})&select=id,order_no,boss_id,status,total_amount,completed_at,companion_id`
);
const byNo = Object.fromEntries((orders || []).map((o) => [o.order_no, o]));

const missing = TARGET_ORDER_NOS.filter((no) => !byNo[no]);
if (missing.length) {
  fail(`ABORT: order(s) not found: ${missing.join(", ")}`);
}

const bossIds = [...new Set(TARGET_ORDER_NOS.map((no) => byNo[no].boss_id).filter(Boolean))];
if (bossIds.length !== 1) {
  fail(`ABORT: expected single boss across targets, got ${bossIds.length}: ${bossIds.join(",")}`);
}
const bossId = bossIds[0];

const bossProfile =
  (
    await rest(
      "profiles",
      `id=eq.${encodeURIComponent(bossId)}&select=id,display_name,boss_uid,role&limit=1`
    )
  )?.[0] || null;
const bossName = String(bossProfile?.display_name || "").trim();
if (bossName !== BOSS_DISPLAY_NAME) {
  fail(
    `ABORT: boss display_name must be ${BOSS_DISPLAY_NAME}, got ${JSON.stringify(bossName)} (id=${bossId})`
  );
}

for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  if (String(order.status || "").toLowerCase() !== "completed") {
    fail(`ABORT: ${no} status must be completed, got ${JSON.stringify(order.status)}`);
  }
  if (String(order.boss_id) !== String(bossId)) {
    fail(`ABORT: ${no} boss_id mismatch`);
  }
}

let settingsView;
try {
  settingsView = await getBossPointsSettings();
} catch (e) {
  fail(`ABORT: cannot load points_settings: ${e.message || e}`);
}

const plan = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  const key = orderPointsIdempotencyKey(order.id);
  let existing = [];
  try {
    existing = await rest(
      "user_points_ledger",
      `idempotency_key=eq.${encodeURIComponent(key)}&select=id,delta,gross_points,user_id,source,balance_after,created_at&limit=3`
    );
  } catch (e) {
    fail(`ABORT: ledger lookup failed for ${no}: ${e.message || e}`);
  }
  const spend = orderEffectiveCatFoodSpend(order);
  let expectedPoints = 0;
  try {
    expectedPoints = computeOrderRewardPoints(spend, settingsView);
  } catch {
    expectedPoints = 0;
  }
  plan.push({
    order_no: no,
    order_id: order.id,
    boss_id: order.boss_id,
    status: order.status,
    total_amount: order.total_amount,
    effective_spend_cat_food: spend,
    amount_field_used: "total_amount",
    idempotency_key: key,
    expected_points: expectedPoints,
    product_expect_points: PRODUCT_EXPECT_EACH,
    ledger_exists: Array.isArray(existing) && existing.length > 0,
    existing_ledger: (existing || []).map((row) => ({
      id: row.id,
      delta: row.delta,
      gross_points: row.gross_points,
      user_id: row.user_id,
      source: row.source,
      balance_after: row.balance_after,
      created_at: row.created_at,
    })),
  });
}

let accountBefore = null;
try {
  accountBefore =
    (
      await rest(
        "user_points_accounts",
        `user_id=eq.${encodeURIComponent(bossId)}&select=user_id,balance,lifetime_earned&limit=1`
      )
    )?.[0] || null;
} catch {
  accountBefore = null;
}

const computedTotal = plan.reduce((n, p) => n + Number(p.expected_points || 0), 0);
const missingLedger = plan.filter((p) => !p.ledger_exists);
const pendingTotal = missingLedger.reduce((n, p) => n + Number(p.expected_points || 0), 0);

const summary = {
  MCJO000356_found: "YES",
  MCJO000357_found: "YES",
  both_completed: plan.every((p) => String(p.status).toLowerCase() === "completed") ? "YES" : "NO",
  both_boss_1717: bossName === BOSS_DISPLAY_NAME ? "YES" : "NO",
  existing_order_points_ledger: Object.fromEntries(
    plan.map((p) => [p.order_no, p.ledger_exists ? "YES" : "NO"])
  ),
  expected: Object.fromEntries(plan.map((p) => [p.order_no, p.expected_points])),
  expected_total: computedTotal,
  pending_backfill_total: pendingTotal,
  product_expect_total: PRODUCT_EXPECT_TOTAL,
  matches_product_expectation:
    computedTotal === PRODUCT_EXPECT_TOTAL &&
    plan.every((p) => p.expected_points === PRODUCT_EXPECT_EACH),
  production_write: allowWrite ? "YES" : "NO",
  dry_run: allowWrite ? "NO" : "YES",
};

const report = {
  ok: true,
  mode: allowWrite ? "WRITE" : "DRY_RUN",
  projectRef: ref,
  boss_hint: BOSS_DISPLAY_NAME,
  boss_id: bossId,
  boss_display_name: bossName,
  points_award_enabled_local_env: isPointsAwardEnabled(),
  points_settings: {
    enabled: settingsView?.enabled ?? null,
    points_per_cat_food: settingsView?.pointsPerCatFood ?? settingsView?.pointsPerRm ?? null,
    min_order_cat_food: settingsView?.minOrderCatFood ?? settingsView?.minOrderAmount ?? null,
    max_reward_points: settingsView?.maxRewardPoints ?? null,
    rounding_mode: settingsView?.roundingMode ?? null,
  },
  expected_total: computedTotal,
  account_before: accountBefore,
  plan,
  summary,
  note: allowWrite
    ? "WRITE mode: will call awardBossPointsForCompletedOrder per missing order."
    : "DRY_RUN only. Set ALLOW_PROD_POINTS_BACKFILL=1 and CONFIRM_PROD_POINTS_BACKFILL=I_UNDERSTAND_PROD_RISK to apply.",
};

if (!allowWrite) {
  console.log(JSON.stringify(report, null, 2));
  const dryOk =
    summary.both_completed === "YES" &&
    summary.both_boss_1717 === "YES" &&
    summary.matches_product_expectation === true;
  process.exit(dryOk ? 0 : 1);
}

if (!isPointsAwardEnabled()) {
  fail("POINTS_AWARD_ENABLED is off — refuse write backfill (would only skip). Enable flag first.");
}

const results = [];
for (const row of plan) {
  if (row.ledger_exists) {
    results.push({ ...row, action: "skip_existing", awarded: 0 });
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
  accountAfter =
    (
      await rest(
        "user_points_accounts",
        `user_id=eq.${encodeURIComponent(bossId)}&select=user_id,balance,lifetime_earned&limit=1`
      )
    )?.[0] || null;
}

const verify = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
  const key = orderPointsIdempotencyKey(order.id);
  const ledger = await rest(
    "user_points_ledger",
    `idempotency_key=eq.${encodeURIComponent(key)}&select=id,delta,gross_points,user_id,source,balance_after,created_at&limit=3`
  );
  verify.push({
    order_no: no,
    order_id: order.id,
    idempotency_key: key,
    ledger_count: (ledger || []).length,
    delta: ledger?.[0]?.delta ?? null,
    gross_points: ledger?.[0]?.gross_points ?? null,
  });
}

// Idempotent re-run probe (should not increase again)
const rerun = [];
for (const no of TARGET_ORDER_NOS) {
  const order = byNo[no];
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

const allHaveLedger = verify.every(
  (v) => v.ledger_count >= 1 && Number(v.delta) === PRODUCT_EXPECT_EACH
);
if (!allHaveLedger) process.exit(1);
