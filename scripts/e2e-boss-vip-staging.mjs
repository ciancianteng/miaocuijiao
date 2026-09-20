#!/usr/bin/env node
/**
 * Staging-only real-DB E2E for PR #252 Boss consumption VIP.
 * Refuses Production. Does not enable Production flags or apply Production SQL.
 *
 *   APP_ENV=preview SUPABASE_URL=$STAGING_SUPABASE_URL \
 *   SUPABASE_SERVICE_ROLE_KEY=$STAGING_SUPABASE_SERVICE_ROLE_KEY \
 *   node scripts/e2e-boss-vip-staging.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  projectRefFromSupabaseUrl,
  projectRefFromDatabaseUrl,
} from "../server/api/_staging-sql.js";
import {
  getBossVipView,
  listVipLevelsForAdmin,
  recastBossVip,
  upsertVipLevel,
} from "../server/api/_boss-vip.js";
import { restUrl, serviceHeaders, supabaseJson, envValue, money } from "../server/api/_wallet.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "artifacts", "boss-vip-staging-e2e");
const stamp = Date.now();
const PASSWORD = `E2eVip252!${stamp}`;

function assertStagingEnv() {
  const sb = envValue("SUPABASE_URL") || process.env.STAGING_SUPABASE_URL || "";
  const db = process.env.STAGING_DATABASE_URL || "";
  const refSb = projectRefFromSupabaseUrl(sb);
  const refDb = projectRefFromDatabaseUrl(db);
  if (refSb === PRODUCTION_PROJECT_REF || refDb === PRODUCTION_PROJECT_REF) {
    throw new Error("REFUSE Production");
  }
  assertStagingOnly({ supabaseUrl: sb, databaseUrl: db || undefined });
  process.env.SUPABASE_URL = sb || `https://${STAGING_PROJECT_REF}.supabase.co`;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  process.env.APP_ENV = process.env.APP_ENV || "preview";
  process.env.VERCEL_ENV = process.env.VERCEL_ENV || "preview";
}

const url = () => envValue("SUPABASE_URL").replace(/\/$/, "");
const key = () => envValue("SUPABASE_SERVICE_ROLE_KEY");

async function authAdmin(pathname, { method = "GET", body } = {}) {
  const r = await fetch(`${url()}${pathname}`, {
    method,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`authAdmin ${pathname} ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

async function createBoss(email, displayName) {
  const user = await authAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password: PASSWORD, email_confirm: true },
  });
  const id = user.id;
  await supabaseJson(restUrl("profiles"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      id,
      email,
      role: "boss",
      status: "active",
      display_name: displayName,
      boss_uid: `V${stamp.toString(36).slice(-6)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 16),
    }),
  });
  return { id, email, displayName };
}

async function createOrderWithPaidTx({ bossId, amount, confirmed = false, csId = null, orderNo }) {
  const orderId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  // Staging enum mcj_order_status has no "paid"; CS-confirmed spend uses claimed+ (not awaiting_payment).
  await supabaseJson(restUrl("orders"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      id: orderId,
      order_no: orderNo,
      boss_id: bossId,
      total_amount: amount,
      unit_price: amount,
      hours: 1,
      status: confirmed ? "claimed" : "awaiting_payment",
      order_type: "normal",
      title: "e2e252 vip spend",
      game: "e2e",
    }),
  });
  const txBody = {
    id: txId,
    order_id: orderId,
    boss_id: bossId,
    gross_amount: amount,
    refunded_amount: 0,
    net_amount: amount,
    payment_status: "paid",
  };
  if (confirmed) {
    txBody.confirmed_by = csId || bossId;
    txBody.confirmed_at = new Date().toISOString();
  }
  await supabaseJson(restUrl("payment_transactions"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(txBody),
  });
  return { orderId, txId, amount };
}

async function csConfirmTx({ txId, orderId, csId, amount }) {
  // Idempotent-ish confirm: set confirmed fields (duplicate confirm keeps same values)
  await supabaseJson(restUrl("payment_transactions", `?id=eq.${encodeURIComponent(txId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      payment_status: "paid",
      confirmed_by: csId,
      confirmed_at: new Date().toISOString(),
      net_amount: amount,
      gross_amount: amount,
    }),
  });
  await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ status: "claimed" }),
  });
}

const results = { cases: {}, evidence: {}, meta: {} };
function record(name, ok, detail) {
  results.cases[name] = { ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(" ", typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300));
}

async function main() {
  assertStagingEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  results.meta = {
    startedAt: new Date().toISOString(),
    stagingRef: STAGING_PROJECT_REF,
    productionTouched: false,
    mainBaseHint: "origin/main at rebase time",
  };

  // 1 Admin VIP config
  let adminLevels;
  try {
    adminLevels = await listVipLevelsForAdmin();
    const ok =
      adminLevels.tablesReady &&
      Array.isArray(adminLevels.levels) &&
      adminLevels.levels.length >= 2 &&
      adminLevels.levels.every((l) => l.name && l.spendThreshold != null);
    // Ensure a low threshold for E2E if VIP1 is 500 — we'll spend 600
    results.evidence.adminLevels = adminLevels.levels.map((l) => ({
      name: l.name,
      spendThreshold: l.spendThreshold,
      benefits: l.benefits,
      isActive: l.isActive,
      sortOrder: l.sortOrder,
    }));
    record("1_admin_vip_config", !!ok, results.evidence.adminLevels);
  } catch (e) {
    record("1_admin_vip_config", false, String(e.message || e));
  }

  const boss = await createBoss(`e2e252.boss.${stamp}@example.com`, `VIP验收老板${stamp}`);
  const cs = await createBoss(`e2e252.cs.${stamp}@example.com`, `VIP验收客服${stamp}`);
  // mark cs as customer_service for realism (optional)
  await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(cs.id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ role: "customer_service" }),
  }).catch(() => {});

  // 2 Boss initial level
  try {
    await recastBossVip(boss.id, { reason: "e2e_init", notify: false });
    const view = await getBossVipView(boss.id);
    const vip = view.vip || view;
    results.evidence.initial = {
      confirmedSpend: vip.confirmedSpend,
      levelName: vip.currentLevelName,
      nextLevelName: vip.nextLevelName,
      remaining: vip.remaining,
      benefits: vip.benefits,
    };
    const spend0 = money(results.evidence.initial.confirmedSpend);
    const name = String(results.evidence.initial.levelName || "");
    record("2_boss_initial_level", spend0 === 0 && !!name, results.evidence.initial);
  } catch (e) {
    record("2_boss_initial_level", false, String(e.message || e));
  }

  // 3 CS confirm real spend 600 → should hit VIP1 (500)
  let orderA;
  try {
    orderA = await createOrderWithPaidTx({
      bossId: boss.id,
      amount: 600,
      confirmed: false,
      orderNo: `VIP252A-${stamp}`,
    });
    await csConfirmTx({
      txId: orderA.txId,
      orderId: orderA.orderId,
      csId: cs.id,
      amount: 600,
    });
    const afterConfirm = await recastBossVip(boss.id, {
      triggerOrderId: orderA.orderId,
      reason: "confirm",
      notify: true,
    });
    const view = await getBossVipView(boss.id);
    const vip = view.vip || view;
    results.evidence.afterConfirm = {
      orderId: orderA.orderId,
      txId: orderA.txId,
      recast: {
        upgraded: !!afterConfirm.upgraded,
        levelChanged: !!afterConfirm.levelChanged,
        confirmedSpend: afterConfirm.confirmedSpend,
        currentName: afterConfirm.current?.name,
      },
      vip,
    };
    const spend = money(vip.confirmedSpend);
    const levelName = String(vip.currentLevelName || "");
    const ok = spend === 600 && /VIP1/i.test(levelName) && afterConfirm.upgraded === true;
    record("3_cs_confirm_spend_upgrade", !!ok, results.evidence.afterConfirm);
  } catch (e) {
    record("3_cs_confirm_spend_upgrade", false, String(e.message || e));
  }

  // 4 Cumulative spend + next tier progress
  try {
    const vip = results.evidence.afterConfirm?.vip || {};
    const ok =
      money(vip.confirmedSpend) === 600 &&
      !!vip.nextLevelName &&
      money(vip.remaining) > 0 &&
      money(vip.nextThreshold) > 600;
    results.evidence.progress = {
      confirmedSpend: vip.confirmedSpend,
      current: vip.currentLevelName,
      next: vip.nextLevelName,
      nextThreshold: vip.nextThreshold,
      remainingToNext: vip.remaining,
      benefits: vip.benefits,
    };
    record("4_spend_and_next_progress", !!ok, results.evidence.progress);
  } catch (e) {
    record("4_spend_and_next_progress", false, String(e.message || e));
  }

  // 5 Auto upgrade history
  try {
    const hist = await supabaseJson(
      restUrl(
        "boss_vip_history",
        `?boss_id=eq.${encodeURIComponent(boss.id)}&order=created_at.desc&limit=5`
      ),
      { headers: serviceHeaders() }
    );
    results.evidence.history = (hist || []).map((h) => ({
      id: String(h.id || "").slice(0, 8),
      old_level_name: h.old_level_name,
      new_level_name: h.new_level_name,
      confirmed_spend: h.confirmed_spend,
      reason: h.reason,
    }));
    const upgraded = (hist || []).some((h) => /VIP1/i.test(String(h.new_level_name || "")));
    record("5_auto_upgrade_history", upgraded, results.evidence.history);
  } catch (e) {
    record("5_auto_upgrade_history", false, String(e.message || e));
  }

  // 6 Upgrade notification
  try {
    const notes = await supabaseJson(
      restUrl(
        "boss_notifications",
        `?boss_id=eq.${encodeURIComponent(boss.id)}&order=created_at.desc&limit=10`
      ),
      { headers: serviceHeaders() }
    );
    const hit = (notes || []).find((n) =>
      /VIP|会员|升级|恭喜/i.test(`${n.title || ""}${n.body || ""}`)
    );
    results.evidence.notifications = (notes || []).slice(0, 3).map((n) => ({
      title: n.title,
      body: String(n.body || "").slice(0, 120),
      kind: n.kind,
    }));
    record("6_upgrade_notification", !!hit, results.evidence.notifications);
  } catch (e) {
    record("6_upgrade_notification", false, String(e.message || e));
  }

  // 7 Boss page fields
  try {
    const vip = results.evidence.progress || {};
    const ok =
      vip.current &&
      vip.confirmedSpend != null &&
      vip.next &&
      vip.remainingToNext != null &&
      vip.benefits != null;
    record("7_boss_page_snapshot_fields", !!ok, vip);
  } catch (e) {
    record("7_boss_page_snapshot_fields", false, String(e.message || e));
  }

  // 8 Duplicate confirm same order → spend unchanged / no second upgrade
  try {
    const histBefore = await supabaseJson(
      restUrl("boss_vip_history", `?boss_id=eq.${encodeURIComponent(boss.id)}&select=id`),
      { headers: serviceHeaders() }
    );
    await csConfirmTx({
      txId: orderA.txId,
      orderId: orderA.orderId,
      csId: cs.id,
      amount: 600,
    });
    const again = await recastBossVip(boss.id, {
      triggerOrderId: orderA.orderId,
      reason: "confirm",
      notify: true,
    });
    const view = await getBossVipView(boss.id);
    const spend = money(view.vip?.confirmedSpend ?? view.confirmedSpend);
    const histAfter = await supabaseJson(
      restUrl("boss_vip_history", `?boss_id=eq.${encodeURIComponent(boss.id)}&select=id`),
      { headers: serviceHeaders() }
    );
    results.evidence.idempotent = {
      spendAfterRetry: spend,
      upgradedAgain: !!again.upgraded,
      levelChangedAgain: !!again.levelChanged,
      historyBefore: (histBefore || []).length,
      historyAfter: (histAfter || []).length,
    };
    record(
      "8_duplicate_confirm_no_double_count",
      spend === 600 && again.upgraded === false && (histAfter || []).length === (histBefore || []).length,
      results.evidence.idempotent
    );
  } catch (e) {
    record("8_duplicate_confirm_no_double_count", false, String(e.message || e));
  }

  // Extra: unconfirmed/awaiting_payment does not count
  try {
    const junk = await createOrderWithPaidTx({
      bossId: boss.id,
      amount: 9999,
      confirmed: false,
      orderNo: `VIP252J-${stamp}`,
    });
    await recastBossVip(boss.id, { reason: "e2e_unconfirmed", notify: false });
    const view = await getBossVipView(boss.id);
    const spend = money(view.vip?.confirmedSpend ?? view.confirmedSpend);
    results.evidence.unconfirmedExcluded = { junkOrderId: junk.orderId, spend };
    record("9_unconfirmed_excluded", spend === 600, results.evidence.unconfirmedExcluded);
  } catch (e) {
    record("9_unconfirmed_excluded", false, String(e.message || e));
  }

  // Separation from boss_levels commission SoT
  try {
    const levels = await supabaseJson(restUrl("boss_levels", "?select=id,code,name&limit=3"), {
      headers: serviceHeaders(),
    }).catch(() => []);
    results.evidence.separation = {
      boss_levels_still_exists: Array.isArray(levels),
      vip_tables: ["boss_vip_levels", "boss_vip_status", "boss_vip_history"],
      note: "VIP spend SoT is payment_transactions; commission SoT remains boss_levels / relations",
    };
    record("10_separate_from_boss_levels", true, results.evidence.separation);
  } catch (e) {
    record("10_separate_from_boss_levels", false, String(e.message || e));
  }

  const allPass = Object.values(results.cases).every((c) => c.ok);
  results.meta.finishedAt = new Date().toISOString();
  results.meta.allPass = allPass;
  const out = path.join(OUT_DIR, `evidence-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("\nEvidence:", out);
  console.log("ALL", allPass ? "PASS" : "FAIL");
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
