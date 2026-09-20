#!/usr/bin/env node
/**
 * P0 backfill companion settlement for fixed order numbers ONLY.
 * Default: DRY_RUN (no writes). WRITE requires dual gates + CONFIRM_P0_SETTLEMENT_BACKFILL.
 *
 * Does NOT:
 * - re-run finalizeOrderCompletion / change order status
 * - debit boss wallet
 * - award boss points
 *
 * Uses createOrderCompleteHelpers().settleCompanionIncome (same calc as live path).
 * Requires SETTLEMENT_ENABLED=true in process.env for live settle path (not skipped).
 *
 * Usage:
 *   node scripts/backfill-companion-settlement-p0.mjs
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *     CONFIRM_P0_SETTLEMENT_BACKFILL=I_BACKFILL_MCJO000356_357 \
 *     SETTLEMENT_ENABLED=true \
 *     node scripts/backfill-companion-settlement-p0.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";
import { createOrderCompleteHelpers } from "../server/api/_order-complete.js";
import { resolvePlatformCommission } from "../server/api/_commission-rates.js";
import { isSettlementEnabled } from "../server/api/_feature-flags.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(ROOT);
loadEnvFiles(path.resolve(ROOT, "..", "meow-cuijiao-homepage"));

const TARGET_NOS = ["MCJO000356", "MCJO000357"];
const WRITE = process.argv.includes("--write");

const URL = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const KEY = String(
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function serviceHeaders(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-P0-Settlement-Backfill/1.0",
    ...extra,
  };
}
function restUrl(table, query = "") {
  return `${URL.replace(/\/$/, "")}/rest/v1/${table}${query}`;
}
async function supabaseJson(endpoint, opts = {}) {
  const response = await fetch(endpoint, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}

async function loadOrder(orderNo) {
  const rows = await supabaseJson(
    restUrl(
      "orders",
      `?order_no=eq.${encodeURIComponent(orderNo)}&select=*&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function existingIncome(order) {
  const rows = await supabaseJson(
    restUrl(
      "transactions",
      `?order_id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(order.companion_id)}&transaction_type=eq.companion_income&status=neq.cancelled&select=id,amount,status,note&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function expectedFor(order) {
  const amount = money(order.total_amount);
  let cp = null;
  try {
    const rows = await supabaseJson(
      restUrl(
        "companion_profiles",
        `?user_id=eq.${encodeURIComponent(order.companion_id)}&select=user_id,commission_rate,level_id,level_name&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    cp = Array.isArray(rows) ? rows[0] : null;
  } catch {
    cp = null;
  }
  const { platformRate, companionShareRate } = resolvePlatformCommission(cp?.commission_rate, 20);
  const companionNet = Math.round(((amount * companionShareRate) / 100) * 100) / 100;
  const platformFee = Math.round((amount - companionNet) * 100) / 100;
  return { gross: amount, platformRate, companionShareRate, platformFee, companionNet };
}

async function main() {
  const ref = supabaseProjectRef(URL);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Expected Production ${PRODUCTION_SUPABASE_REF}, got ${ref || "(empty)"}`);
  }
  if (!KEY) throw new Error("Missing service role key");

  if (WRITE) {
    if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1") {
      throw new Error("WRITE refused: ALLOW_PROD_SUPABASE_WRITE=1 required");
    }
    if (process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") {
      throw new Error("WRITE refused: CONFIRM_PROD_WRITE required");
    }
    if (process.env.CONFIRM_P0_SETTLEMENT_BACKFILL !== "I_BACKFILL_MCJO000356_357") {
      throw new Error("WRITE refused: CONFIRM_P0_SETTLEMENT_BACKFILL=I_BACKFILL_MCJO000356_357 required");
    }
    if (!isSettlementEnabled(process.env)) {
      throw new Error("WRITE refused: SETTLEMENT_ENABLED must be true in process.env for settle path");
    }
  }

  const helpers = createOrderCompleteHelpers({
    restUrl,
    supabaseJson,
    serviceHeaders,
    addSystemMessage: async () => {},
  });

  const plans = [];
  for (const no of TARGET_NOS) {
    const order = await loadOrder(no);
    if (!order) {
      plans.push({ orderNo: no, ok: false, error: "order_not_found" });
      continue;
    }
    if (String(order.status) !== "completed") {
      plans.push({ orderNo: no, ok: false, error: "not_completed", status: order.status });
      continue;
    }
    if (!order.companion_id) {
      plans.push({ orderNo: no, ok: false, error: "no_companion" });
      continue;
    }
    const existing = await existingIncome(order);
    const expected = await expectedFor(order);
    plans.push({
      orderNo: no,
      orderId: order.id,
      status: order.status,
      expected,
      existingCompanionIncome: existing.length > 0,
      existingCount: existing.length,
      existingAmounts: existing.map((t) => money(t.amount)),
      willWrite: WRITE && existing.length === 0,
    });
  }

  const report = {
    mode: WRITE ? "WRITE" : "DRY_RUN",
    productionRef: ref,
    settlementEnabled: isSettlementEnabled(process.env),
    plans,
    totalExpected:
      Math.round(
        plans.reduce((n, p) => n + (p.expected?.companionNet || 0), 0) * 100
      ) / 100,
  };

  if (!WRITE) {
    console.log(JSON.stringify(report, null, 2));
    const out = path.join(ROOT, "docs", `p0-settlement-backfill-dryrun-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.error("Wrote " + out);
    return;
  }

  const results = [];
  for (const plan of plans) {
    if (!plan.willWrite) {
      results.push({
        orderNo: plan.orderNo,
        skipped: true,
        reason: plan.existingCompanionIncome ? "already_has_income" : plan.error || "skip",
        existing: plan.existingAmounts || [],
      });
      continue;
    }
    const order = await loadOrder(plan.orderNo);
    const completedAt = order.completed_at || new Date().toISOString();
    const out = await helpers.settleCompanionIncome(order, completedAt, "admin_backfill_p0");
    const after = await existingIncome(order);
    results.push({
      orderNo: plan.orderNo,
      settle: out,
      afterIncome: after.map((t) => ({ id: t.id, amount: money(t.amount), status: t.status })),
    });
  }

  const final = { ...report, results };
  console.log(JSON.stringify(final, null, 2));
  const out = path.join(ROOT, "docs", `p0-settlement-backfill-write-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(final, null, 2));
  console.error("Wrote " + out);
}

main().catch((e) => {
  console.error("BACKFILL_FAILED", e.message || e);
  process.exit(1);
});
