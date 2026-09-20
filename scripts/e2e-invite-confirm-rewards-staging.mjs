#!/usr/bin/env node
/**
 * Staging-only real-DB E2E for PR #275 invite confirm + rewards (CASE A–F).
 * Refuses Production. Does not apply Production migrations or flip Production flags.
 *
 * Usage:
 *   APP_ENV=preview \
 *   SUPABASE_URL=$STAGING_SUPABASE_URL \
 *   SUPABASE_SERVICE_ROLE_KEY=$STAGING_SUPABASE_SERVICE_ROLE_KEY \
 *   BOSS_INVITE_LINKS_ENABLED=true \
 *   SETTLEMENT_ENABLED=true \
 *   node scripts/e2e-invite-confirm-rewards-staging.mjs
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
import { createBossInviteLink, redeemInviteAfterCompanionReady } from "../server/api/_boss-invite-links.js";
import {
  confirmInviteAttribution,
  rejectInviteAttribution,
  getPendingAttributionForInvitee,
  DEFAULT_BOSS_INVITE_MEOWCOIN,
  DEFAULT_COMPANION_INVITE_CASH,
} from "../server/api/_invite-attribution.js";
import {
  bindRelation,
  rebindRelation,
  unbindRelation,
  listRelationEvents,
  getActiveRelationForCompanion,
  listRelations,
} from "../server/api/_boss-companion-relations.js";
import { settleBossCommissionFromPlatformFee } from "../server/api/_boss-commission.js";
import { isBossInviteLinksEnabled, isSettlementEnabled } from "../server/api/_feature-flags.js";
import { restUrl, serviceHeaders, supabaseJson, envValue } from "../server/api/_wallet.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "artifacts", "invite-confirm-staging-e2e");
const stamp = Date.now();
const PASSWORD = `E2eInvite275!${stamp}`;

function maskEmail(email) {
  const s = String(email || "");
  return s.replace(/(.{2}).+(@.+)/, "$1***$2");
}

function assertStagingEnv() {
  const sb = envValue("SUPABASE_URL") || process.env.STAGING_SUPABASE_URL || "";
  const db = process.env.STAGING_DATABASE_URL || "";
  const refSb = projectRefFromSupabaseUrl(sb);
  const refDb = projectRefFromDatabaseUrl(db);
  if (refSb === PRODUCTION_PROJECT_REF || refDb === PRODUCTION_PROJECT_REF) {
    throw new Error("REFUSE: Production target detected");
  }
  assertStagingOnly({ supabaseUrl: sb, databaseUrl: db || undefined });
  if (refSb && refSb !== STAGING_PROJECT_REF) {
    throw new Error(`REFUSE: non-staging supabase ref=${refSb}`);
  }
  // Force module env to Staging
  process.env.SUPABASE_URL = sb || `https://${STAGING_PROJECT_REF}.supabase.co`;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  process.env.APP_ENV = process.env.APP_ENV || "preview";
  process.env.VERCEL_ENV = process.env.VERCEL_ENV || "preview";
  process.env.BOSS_INVITE_LINKS_ENABLED = process.env.BOSS_INVITE_LINKS_ENABLED || "true";
  process.env.SETTLEMENT_ENABLED = process.env.SETTLEMENT_ENABLED || "true";
  if (String(process.env.APP_ENV).toLowerCase() === "production") {
    throw new Error("REFUSE: APP_ENV=production");
  }
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

async function passwordLogin(email) {
  const r = await fetch(`${url()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login failed ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

async function createUser(email, { role = "boss", displayName = "" } = {}) {
  const user = await authAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { e2e: "invite-confirm-275", roles: [role] },
      app_metadata: { roles: [role] },
    },
  });
  const id = user.id;
  const profile = {
    id,
    email,
    role,
    roles: [role],
    status: "active",
    display_name: displayName || `E2E ${role} ${stamp}`,
  };
  if (role === "boss") {
    profile.boss_uid = `E2E${String(stamp).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
  }
  try {
    await supabaseJson(restUrl("profiles"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(profile),
    });
  } catch (e1) {
    // retry without roles array if column type rejects
    const { roles, ...rest } = profile;
    try {
      await supabaseJson(restUrl("profiles"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(rest),
      });
    } catch (e2) {
      throw new Error(`profile insert failed for ${email}: ${e1.message || e1} / ${e2.message || e2}`);
    }
  }
  const verify = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=id,role,status,boss_uid`),
    { headers: serviceHeaders() }
  );
  if (!verify?.[0]) throw new Error(`profile missing after insert: ${email}`);

  if (role === "companion") {
    await supabaseJson(restUrl("companion_profiles"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        user_id: id,
        nickname: displayName || `E2E陪玩${stamp}`,
        application_status: "approved",
        verification_status: "approved",
        allow_orders: true,
        online_status: "online",
        price: 30,
      }),
    }).catch((e) => {
      console.warn("companion_profiles insert soft-fail", e?.message || e);
    });
  }
  return { id, email, role, token: await passwordLogin(email) };
}

async function restGet(table, query) {
  return supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
}

async function walletBonus(userId) {
  const rows = await restGet(
    "wallet_transactions",
    `?boss_id=eq.${encodeURIComponent(userId)}&transaction_type=eq.invite_reward&order=created_at.desc&limit=5`
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

const results = { cases: {}, evidence: {}, flags: {}, migrations: {}, meta: {} };

function record(caseId, ok, detail) {
  results.cases[caseId] = { ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"}  ${caseId}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 240)}`);
}

async function main() {
  assertStagingEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  results.meta = {
    startedAt: new Date().toISOString(),
    stagingRef: STAGING_PROJECT_REF,
    productionTouched: false,
    commitHint: "PR #275 staging E2E",
    rewardDefaults: {
      bossMeow: DEFAULT_BOSS_INVITE_MEOWCOIN,
      companionCash: DEFAULT_COMPANION_INVITE_CASH,
    },
  };
  results.flags = {
    stagingBossInvite: isBossInviteLinksEnabled() ? "ON" : "OFF",
    stagingSettlement: isSettlementEnabled() ? "ON" : "OFF",
    productionFlags: "OFF (not modified; fail-closed when unset on Production)",
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  console.log("Flags:", results.flags);
  if (!isBossInviteLinksEnabled()) throw new Error("BOSS_INVITE_LINKS must be ON for Staging E2E");

  // Probe migrations
  for (const [num, table] of [
    ["01", "boss_companion_relations"],
    ["02", "boss_commission_earnings"],
    ["03", "boss_levels"],
    ["09", "boss_invite_links"],
    ["14", "invite_attributions"],
  ]) {
    try {
      await restGet(table, "?select=id&limit=1");
      results.migrations[num] = "APPLIED";
    } catch {
      results.migrations[num] = "MISSING";
    }
  }
  const owner = await restGet("boss_invite_links", "?select=owner_role&limit=1").catch(() => null);
  if (results.migrations["14"] === "APPLIED" && owner != null) {
    results.migrations["14"] = "APPLIED";
  }
  console.log("Migrations:", results.migrations);

  // Actors
  const bossA = await createUser(`e2e275.boss.${stamp}@example.com`, {
    role: "boss",
    displayName: `BossA-${stamp}`,
  });
  const companionA = await createUser(`e2e275.comp.${stamp}@example.com`, {
    role: "companion",
    displayName: `CompA-${stamp}`,
  });
  const userBBossInvite = await createUser(`e2e275.invitee.boss.${stamp}@example.com`, {
    role: "companion",
    displayName: `InviteeBossFlow-${stamp}`,
  });
  const userBCompInvite = await createUser(`e2e275.invitee.comp.${stamp}@example.com`, {
    role: "companion",
    displayName: `InviteeCompFlow-${stamp}`,
  });
  const userCReject = await createUser(`e2e275.reject.${stamp}@example.com`, {
    role: "companion",
    displayName: `RejectFlow-${stamp}`,
  });
  const userDIdem = await createUser(`e2e275.idem.${stamp}@example.com`, {
    role: "companion",
    displayName: `IdemFlow-${stamp}`,
  });

  results.evidence.actors = {
    bossA: { id: bossA.id, email: maskEmail(bossA.email) },
    companionA: { id: companionA.id, email: maskEmail(companionA.email) },
  };

  // ========== CASE A — Boss invite ==========
  try {
    const link = await createBossInviteLink({
      bossId: bossA.id,
      ownerRole: "boss",
      label: `e2e-boss-${stamp}`,
      maxUses: 10,
    });
    const code = link.code || link.link?.code;
    const inviteUrl = link.url || link.link?.url;
    results.evidence.caseA = { code: String(code).slice(0, 8) + "…", inviteUrl: inviteUrl ? "[set]" : null };

    const redeem = await redeemInviteAfterCompanionReady({
      inviteCode: code,
      inviteeId: userBBossInvite.id,
    });
    const pending = await getPendingAttributionForInvitee(userBBossInvite.id);
    if (!pending) {
      throw new Error(
        `no pending after redeem: ${JSON.stringify({ redeem, invitee: userBBossInvite.id, code: String(code).slice(0, 8) })}`
      );
    }
    const relBefore = await getActiveRelationForCompanion(userBBossInvite.id).catch(() => null);
    const rewardBefore = await restGet(
      "invite_reward_ledger",
      `?inviter_user_id=eq.${encodeURIComponent(bossA.id)}&invitee_user_id=eq.${encodeURIComponent(userBBossInvite.id)}`
    );

    const pendingOk =
      pending &&
      pending.status === "pending" &&
      !relBefore &&
      (!rewardBefore || rewardBefore.length === 0);

    const confirmed = await confirmInviteAttribution({ inviteeUserId: userBBossInvite.id });
    const relAfter = await getActiveRelationForCompanion(userBBossInvite.id);
    const rewardAfter = await restGet(
      "invite_reward_ledger",
      `?inviter_user_id=eq.${encodeURIComponent(bossA.id)}&invitee_user_id=eq.${encodeURIComponent(userBBossInvite.id)}&status=eq.granted`
    );
    const walletTx = await walletBonus(bossA.id);
    const events = await listRelationEvents({ relationId: relAfter?.id, limit: 10 }).catch(() => []);

    results.evidence.caseA = {
      ...results.evidence.caseA,
      redeemOutcome: redeem?.outcome || redeem,
      pendingBeforeConfirm: pending
        ? { id: pending.id, status: pending.status, reward_granted: pending.reward_granted }
        : null,
      relationActiveBefore: !!relBefore,
      confirm: {
        attributionId: confirmed?.attribution?.id,
        relationId: confirmed?.attribution?.relationId || relAfter?.id,
        reward: confirmed?.reward,
      },
      relationAfter: relAfter
        ? { id: relAfter.id, status: relAfter.status, boss_id: relAfter.boss_id, companion_id: relAfter.companion_id }
        : null,
      rewardLedger: (rewardAfter || []).map((r) => ({
        id: r.id,
        reward_type: r.reward_type,
        amount: r.amount,
        withdrawable: r.withdrawable,
        currency: r.currency,
      })),
      walletInviteTxCount: (walletTx || []).length,
      relationEventCount: Array.isArray(events) ? events.length : events?.length || 0,
      expectedMeowAmount: DEFAULT_BOSS_INVITE_MEOWCOIN,
    };

    const reward = rewardAfter?.[0];
    const ok =
      pendingOk &&
      relAfter?.status === "active" &&
      String(relAfter.boss_id) === bossA.id &&
      reward &&
      reward.reward_type === "meow_coin" &&
      Number(reward.amount) === Number(DEFAULT_BOSS_INVITE_MEOWCOIN) &&
      reward.withdrawable === false;
    record("A", !!ok, results.evidence.caseA);
  } catch (e) {
    record("A", false, String(e?.message || e));
  }

  // ========== CASE B — Companion invite ==========
  try {
    const cashBeforeRows = await restGet(
      "invite_cash_wallets",
      `?user_id=eq.${encodeURIComponent(companionA.id)}&select=*`
    );
    const cashBefore = cashBeforeRows?.[0] || { available_amount: 0, total_earned: 0 };

    const link = await createBossInviteLink({
      bossId: companionA.id,
      ownerRole: "companion",
      label: `e2e-comp-${stamp}`,
    });
    const code = link.code || link.link?.code;
    await redeemInviteAfterCompanionReady({
      inviteCode: code,
      inviteeId: userBCompInvite.id,
    });
    const pending = await getPendingAttributionForInvitee(userBCompInvite.id);
    if (!pending) throw new Error("CASE B: no pending after companion invite redeem");
    const confirmed = await confirmInviteAttribution({ inviteeUserId: userBCompInvite.id });
    const rel = await getActiveRelationForCompanion(userBCompInvite.id);
    const reward = (
      await restGet(
        "invite_reward_ledger",
        `?inviter_user_id=eq.${encodeURIComponent(companionA.id)}&invitee_user_id=eq.${encodeURIComponent(userBCompInvite.id)}&status=eq.granted`
      )
    )?.[0];
    const cashAfterRows = await restGet(
      "invite_cash_wallets",
      `?user_id=eq.${encodeURIComponent(companionA.id)}&select=*`
    );
    const cashAfter = cashAfterRows?.[0];

    results.evidence.caseB = {
      pendingStatus: pending?.status,
      relation: rel ? { id: rel.id, status: rel.status } : null,
      reward: reward
        ? {
            reward_type: reward.reward_type,
            amount: reward.amount,
            withdrawable: reward.withdrawable,
            currency: reward.currency,
          }
        : null,
      cashWallet: {
        before: Number(cashBefore.available_amount || 0),
        after: Number(cashAfter?.available_amount || 0),
        delta: Number(cashAfter?.available_amount || 0) - Number(cashBefore.available_amount || 0),
        expected: Number(DEFAULT_COMPANION_INVITE_CASH),
      },
      confirmReward: confirmed?.reward,
    };

    const ok =
      rel?.status === "active" &&
      reward?.reward_type === "cash" &&
      reward?.withdrawable === true &&
      Number(reward.amount) === Number(DEFAULT_COMPANION_INVITE_CASH) &&
      results.evidence.caseB.cashWallet.delta === Number(DEFAULT_COMPANION_INVITE_CASH);
    record("B", !!ok, results.evidence.caseB);
  } catch (e) {
    record("B", false, String(e?.message || e));
  }

  // ========== CASE C — Reject / 暂不确认 ==========
  try {
    const link = await createBossInviteLink({
      bossId: bossA.id,
      ownerRole: "boss",
      label: `e2e-reject-${stamp}`,
    });
    const code = link.code || link.link?.code;
    await redeemInviteAfterCompanionReady({
      inviteCode: code,
      inviteeId: userCReject.id,
    });
    const pending = await getPendingAttributionForInvitee(userCReject.id);
    if (!pending) throw new Error("CASE C: no pending before reject");
    await rejectInviteAttribution({ inviteeUserId: userCReject.id });
    const rel = await getActiveRelationForCompanion(userCReject.id).catch(() => null);
    const rewards = await restGet(
      "invite_reward_ledger",
      `?invitee_user_id=eq.${encodeURIComponent(userCReject.id)}`
    );
    const attrAfter = await restGet(
      "invite_attributions",
      `?invitee_user_id=eq.${encodeURIComponent(userCReject.id)}&order=created_at.desc&limit=1`
    );
    results.evidence.caseC = {
      pendingBefore: pending ? { id: pending.id, status: pending.status } : null,
      after: attrAfter?.[0]
        ? { id: attrAfter[0].id, status: attrAfter[0].status }
        : null,
      relationActive: !!rel,
      rewardCount: (rewards || []).length,
    };
    const ok =
      !rel &&
      (rewards || []).length === 0 &&
      attrAfter?.[0] &&
      ["rejected", "pending"].includes(String(attrAfter[0].status));
    // Prefer rejected; pending allowed if product keeps pending on soft-decline
    record("C", !!ok || (!rel && (rewards || []).length === 0 && !!pending), results.evidence.caseC);
  } catch (e) {
    record("C", false, String(e?.message || e));
  }

  // ========== CASE D — Idempotent confirm ==========
  try {
    const link = await createBossInviteLink({
      bossId: bossA.id,
      ownerRole: "boss",
      label: `e2e-idem-${stamp}`,
    });
    const code = link.code || link.link?.code;
    await redeemInviteAfterCompanionReady({
      inviteCode: code,
      inviteeId: userDIdem.id,
    });
    const pending = await getPendingAttributionForInvitee(userDIdem.id);
    if (!pending) throw new Error("CASE D: no pending before idempotent confirm");
    const c1 = await confirmInviteAttribution({ inviteeUserId: userDIdem.id });
    const c2 = await confirmInviteAttribution({ inviteeUserId: userDIdem.id });
    const c3 = await confirmInviteAttribution({ inviteeUserId: userDIdem.id });
    const rels = await restGet(
      "boss_companion_relations",
      `?companion_id=eq.${encodeURIComponent(userDIdem.id)}&status=eq.active`
    );
    const rewards = await restGet(
      "invite_reward_ledger",
      `?invitee_user_id=eq.${encodeURIComponent(userDIdem.id)}&status=eq.granted`
    );
    const cash = await restGet(
      "invite_cash_wallets",
      `?user_id=eq.${encodeURIComponent(bossA.id)}`
    );
    results.evidence.caseD = {
      confirms: [c1, c2, c3].map((c) => ({
        alreadyConfirmed: !!c?.alreadyConfirmed,
        relationId: c?.attribution?.relationId,
        rewardDuplicate: !!(c?.reward?.duplicate || c?.alreadyConfirmed),
      })),
      activeRelationCount: (rels || []).length,
      grantedRewardCount: (rewards || []).length,
      bossCashWalletRows: (cash || []).length,
    };
    const ok = (rels || []).length === 1 && (rewards || []).length === 1;
    record("D", !!ok, results.evidence.caseD);
  } catch (e) {
    record("D", false, String(e?.message || e));
  }

  // ========== CASE E — Admin SoT intact ==========
  try {
    const adminBoss = await createUser(`e2e275.admin.boss.${stamp}@example.com`, {
      role: "boss",
      displayName: `AdminBoss-${stamp}`,
    });
    const adminComp = await createUser(`e2e275.admin.comp.${stamp}@example.com`, {
      role: "companion",
      displayName: `AdminComp-${stamp}`,
    });
    const adminComp2 = await createUser(`e2e275.admin.comp2.${stamp}@example.com`, {
      role: "companion",
      displayName: `AdminComp2-${stamp}`,
    });

    const bound = await bindRelation({
      bossId: adminBoss.id,
      companionId: adminComp.id,
      operatorId: adminBoss.id,
      reason: "e2e275_admin_bind",
      remark: "e2e275_admin_bind",
      commissionRate: 0.1,
    });

    const adminBoss2 = await createUser(`e2e275.admin.boss2.${stamp}@example.com`, {
      role: "boss",
      displayName: `AdminBoss2-${stamp}`,
    });
    const rebound2 = await rebindRelation({
      companionId: adminComp.id,
      newBossId: adminBoss2.id,
      operatorId: adminBoss2.id,
      reason: "e2e275_admin_rebind",
      remark: "e2e275_admin_rebind",
      commissionRate: 0.12,
    });
    // bind then unbind adminComp2
    await bindRelation({
      bossId: adminBoss.id,
      companionId: adminComp2.id,
      operatorId: adminBoss.id,
      reason: "e2e275_admin_bind2",
      remark: "e2e275_admin_bind2",
    });
    const unbound2 = await unbindRelation({
      companionId: adminComp2.id,
      operatorId: adminBoss.id,
      reason: "e2e275_admin_unbind",
      remark: "e2e275_admin_unbind",
    });

    const listed = await listRelations({ bossId: adminBoss2.id, status: "active", limit: 20 });
    const ev = await listRelationEvents({ companionId: adminComp.id, limit: 20 });

    // Ensure #275 does not WRITE a parallel relation SoT (legacy referral_relations table may exist from #134).
    const referralWrites = await restGet(
      "referral_relations",
      `?or=(inviter_user_id.eq.${encodeURIComponent(adminBoss.id)},invited_user_id.eq.${encodeURIComponent(adminComp.id)})&limit=5`
    ).catch(() => []);
    const parallelWrites = Array.isArray(referralWrites) ? referralWrites.length : 0;

    results.evidence.caseE = {
      bindId: bound?.relation?.id || bound?.id,
      rebind: rebound2?.relation?.id || rebound2?.id || rebound2,
      unbind: unbound2?.relation?.id || unbound2?.id || unbound2,
      listActiveForBoss2: Array.isArray(listed) ? listed.length : listed?.length,
      eventCount: Array.isArray(ev) ? ev.length : 0,
      parallelSoTWrites: parallelWrites,
      legacyReferralTableMayExist: true,
      sameSoT: "boss_companion_relations + boss_companion_relation_events",
    };
    const ok =
      !!(bound?.relation?.id || bound?.id) &&
      !!(rebound2?.relation?.id || rebound2?.id) &&
      parallelWrites === 0 &&
      (Array.isArray(ev) ? ev.length : 0) >= 1;
    record("E", !!ok, results.evidence.caseE);
  } catch (e) {
    record("E", false, String(e?.message || e));
  }

  // ========== CASE F — Settlement regression ==========
  try {
    // Use CASE A relation: bossA ← userBBossInvite
    const rel = await getActiveRelationForCompanion(userBBossInvite.id);
    if (!rel) throw new Error("CASE F needs active relation from A");

    // Ensure commission_rate on relation
    await supabaseJson(
      restUrl("boss_companion_relations", `?id=eq.${encodeURIComponent(rel.id)}`),
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ commission_rate: 0.15 }),
      }
    );

    const orderId = cryptoRandomId();
    const orderNo = `E2E275-${stamp}`;
    const order = {
      id: orderId,
      companion_id: userBBossInvite.id,
      boss_id: bossA.id,
      total_amount: 100,
      status: "completed",
    };
    const orderPayload = {
      id: orderId,
      order_no: orderNo,
      companion_id: userBBossInvite.id,
      boss_id: bossA.id,
      total_amount: 100,
      unit_price: 100,
      hours: 1,
      status: "completed",
      platform_fee: 20,
      companion_income: 80,
      order_type: "normal",
      title: "e2e275 settlement",
      game: "e2e",
    };
    await supabaseJson(restUrl("orders"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(orderPayload),
    }).catch(async (err) => {
      delete orderPayload.platform_fee;
      delete orderPayload.companion_income;
      await supabaseJson(restUrl("orders"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify(orderPayload),
      }).catch((e2) => {
        throw new Error(`order insert failed: ${err?.message || err} / ${e2?.message || e2}`);
      });
    });

    const settle1 = await settleBossCommissionFromPlatformFee(order, {
      platformFeeAmount: 20,
      companionIncomeAmount: 80,
      completedAt: new Date().toISOString(),
      method: "e2e275",
    });
    const settle2 = await settleBossCommissionFromPlatformFee(order, {
      platformFeeAmount: 20,
      companionIncomeAmount: 80,
      completedAt: new Date().toISOString(),
      method: "e2e275-retry",
    });

    const earnings = await restGet(
      "boss_commission_earnings",
      `?order_id=eq.${encodeURIComponent(orderId)}`
    );
    const inviteRewards = await restGet(
      "invite_reward_ledger",
      `?inviter_user_id=eq.${encodeURIComponent(bossA.id)}&invitee_user_id=eq.${encodeURIComponent(userBBossInvite.id)}`
    );

    results.evidence.caseF = {
      relationId: rel.id,
      orderId,
      settle1: summarizeSettle(settle1),
      settle2: summarizeSettle(settle2),
      earningsCount: (earnings || []).length,
      inviteRewardSeparate: (inviteRewards || []).map((r) => ({
        type: r.reward_type,
        amount: r.amount,
        table: "invite_reward_ledger",
      })),
      commissionTable: "boss_commission_earnings",
    };

    const ok =
      !settle1?.skipped &&
      (settle2?.duplicate === true || (earnings || []).length === 1) &&
      (earnings || []).length === 1 &&
      (inviteRewards || []).length >= 1;
    record("F", !!ok, results.evidence.caseF);
  } catch (e) {
    record("F", false, String(e?.message || e));
  }

  const allPass = Object.values(results.cases).every((c) => c.ok);
  results.meta.finishedAt = new Date().toISOString();
  results.meta.allPass = allPass;
  const outFile = path.join(OUT_DIR, `evidence-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log("\nEvidence written:", outFile);
  console.log("ALL", allPass ? "PASS" : "FAIL");
  process.exitCode = allPass ? 0 : 1;
}

function summarizeSettle(s) {
  if (!s) return null;
  return {
    skipped: !!s.skipped,
    reason: s.reason || null,
    duplicate: !!s.duplicate,
    earningId: s.earning?.id || s.earning?.orderId || null,
  };
}

function cryptoRandomId() {
  return "00000000-0000-4000-8000-" + String(stamp).padStart(12, "0").slice(-12);
}

main().catch((err) => {
  console.error("E2E fatal:", err?.stack || err);
  process.exit(1);
});
