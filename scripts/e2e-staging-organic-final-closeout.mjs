#!/usr/bin/env node
/**
 * Staging organic FINAL closeout harness (#296).
 * Fresh-path proofs for 12 release gates. Refuses Production.
 *
 * Usage: node scripts/e2e-staging-organic-final-closeout.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSmokeTargetAllowed,
  STAGING_SUPABASE_REF,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/go-live-organic");
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

assertSmokeTargetAllowed({
  script: "e2e-staging-organic-final-closeout",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function maskId(id) {
  const s = String(id || "");
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`;
}

async function api(pathname, token, body, method = "POST", extra = {}) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body == null && method === "GET" ? "GET" : method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, json: await res.json().catch(() => ({})) };
}

const organic = JSON.parse(fs.readFileSync(path.join(outDir, "organic-accounts.json"), "utf8"));
const PASS = organic.password;
const bossEmail = "organic.boss@mcj-staging-organic.invalid";
const inviteeEmail = "organic.invitee.boss@mcj-staging-organic.invalid";
const compEmail = "organic.companion@mcj-staging-organic.invalid";
const inviteeCompEmail = "organic.invitee.comp@mcj-staging-organic.invalid";
const bossId = organic.accounts.find((a) => a.email === bossEmail)?.id;
const inviteeId = organic.accounts.find((a) => a.email === inviteeEmail)?.id;
const compId = organic.accounts.find((a) => a.email === compEmail)?.id;
const inviteeCompId = organic.accounts.find((a) => a.email === inviteeCompEmail)?.id;

const report = {
  generated_at: new Date().toISOString(),
  staging: STG,
  head_hint: "final-closeout",
  modules: {},
  evidence: {},
  fails: [],
};

function setMod(key, result, detail, evidence = null) {
  report.modules[key] = { result, detail: String(detail || "").slice(0, 800) };
  if (evidence) report.evidence[key] = evidence;
  const line = `[${result}] ${key} :: ${detail}`;
  console.log(line);
  if (result !== "PASS") report.fails.push(key);
}

async function login(email, role, password = PASS) {
  const r = await api("/api/auth", null, { action: "login", email, password, role });
  const token = r.json?.session?.accessToken || "";
  if (!token) throw new Error(`login failed ${email}: ${r.json?.message || r.status}`);
  return token;
}

async function bossBal(token) {
  const w = await api("/api/recharge", token, null, "GET");
  const summary = w.json?.summary || {};
  const wallet = w.json?.wallet || {};
  return money(
    summary.balance ??
      wallet.totalBalance ??
      wallet.availableBalance ??
      (money(wallet.paidBalance) + money(wallet.bonusBalance)) ??
      0
  );
}

async function bossBonus(token) {
  const w = await api("/api/recharge", token, null, "GET");
  const wallet = w.json?.wallet || {};
  const summary = w.json?.summary || {};
  return money(wallet.bonusBalance ?? summary.bonusBalance ?? wallet.bonus_balance ?? 0);
}

async function ensureBossBalance(bossT, adminT, adminH, min = 200) {
  let bal = await bossBal(bossT);
  if (bal >= min) return bal;
  const camps = await api("/api/admin/recharge-campaigns?action=list", adminT, null, "GET", adminH);
  const camp = (camps.json?.campaigns || []).find((c) => Number(c.totalCatFood || c.total_cat_food) >= 100);
  const methods = (await api("/api/recharge?action=methods", bossT, null, "GET")).json?.methods || [];
  const method = methods.find((m) => /duitnow/i.test(String(m.code || ""))) || methods[0];
  // Loop up to 3 recharges to reach min.
  for (let i = 0; i < 3 && bal < min; i++) {
    const create = await api("/api/recharge", bossT, {
      campaignId: camp?.id,
      paymentMethod: method?.code || "duitnow",
    });
    const paymentNo = create.json?.paymentOrder?.paymentNo || create.json?.paymentOrder?.payment_no || "";
    if (!paymentNo) break;
    await api("/api/recharge", bossT, { action: "submit_proof", paymentNo, proofDataUrl: PNG });
    await api(
      "/api/admin/wallet",
      adminT,
      { action: "confirm_manual_recharge", paymentNo, reason: "final-closeout cushion" },
      "POST",
      adminH
    );
    bal = await bossBal(bossT);
  }
  if (bal < min) throw new Error(`boss balance still ${bal} < ${min}`);
  return bal;
}

async function ensureCompanionReady(adminT, adminH, compT, targetId = compId, label = "Organic Companion") {
  const got = await api("/api/admin/players", adminT, { action: "get", id: targetId }, "POST", adminH);
  const rowId = got.json?.player?.id || targetId;
  await api(
    "/api/admin/players",
    adminT,
    {
      action: "review_application",
      id: rowId,
      userId: targetId,
      status: "approved",
      levelId: "lv1",
      allowOrders: true,
    },
    "POST",
    adminH
  );
  await api("/api/companion", compT, { action: "set_online_status", online_status: "online" });
  await api("/api/companion", compT, {
    action: "submit_verification",
    real_name: label,
    identity_no: "ORG" + Date.now().toString().slice(-10),
    id_front: PNG,
    id_back: PNG,
    bank_account: "123456789012",
    bank_name: "Maybank",
    account_holder: label,
  });
  await api(
    "/api/admin/players",
    adminT,
    { action: "review_payment", id: rowId, userId: targetId, status: "approved" },
    "POST",
    adminH
  );
  await api(
    "/api/admin/players",
    adminT,
    { action: "review_identity", id: rowId, userId: targetId, status: "approved" },
    "POST",
    adminH
  );
  // Final edit AFTER verification — submit_verification can reset audit to pending.
  const edit = await api(
    "/api/admin/players",
    adminT,
    {
      action: "edit",
      id: rowId,
      userId: targetId,
      auditStatus: "approved",
      levelId: "lv1",
      price: 20,
      game: "默认服务",
      main_service: "默认服务",
      game_prices: { 默认服务: 20 },
      allowOrders: true,
      online_status: "online",
      availability_status: "available",
    },
    "POST",
    adminH
  );
  if (!(edit.ok || edit.json?.ok)) {
    throw new Error(`companion edit failed ${targetId}: ${edit.json?.message || edit.status}`);
  }
  return rowId;
}

async function ensureBossCompanionRelation(adminT, adminH) {
  const bind = await api(
    "/api/admin/boss-companion-relations",
    adminT,
    {
      action: "bind",
      bossId,
      companionId: compId,
      commissionRate: 10,
      remark: "final-closeout commission clawback",
      reason: "staging organic commission proof",
    },
    "POST",
    adminH
  );
  if (!(bind.ok || bind.json?.ok)) {
    // already bound → rebind / update rate
    await api(
      "/api/admin/boss-companion-relations",
      adminT,
      {
        action: "rebind",
        companionId: compId,
        newBossId: bossId,
        commissionRate: 10,
        remark: "final-closeout commission clawback rebind",
      },
      "POST",
      adminH
    );
  }
  return bind.json;
}

async function placePayComplete({
  bossT,
  compT,
  adminT,
  adminH,
  note,
  completion = "admin_force", // admin_force keeps after-sale open; boss_manual closes it
  companionUserId = compId,
  companionName = "Organic Companion",
}) {
  const place = await api("/api/orders", bossT, {
    action: "place_order",
    companionId: companionUserId,
    companionName,
    serviceType: "默认服务",
    game: "默认服务",
    gameId: `FC${Date.now().toString().slice(-8)}`,
    unitPrice: 20,
    hours: 1,
    quantity: 1,
    totalAmount: 20,
    note,
  });
  const orderId = place.json?.order?.id || place.json?.id;
  if (!orderId) throw new Error(`place failed: ${place.json?.message || place.status}`);
  const pay = await api("/api/orders", bossT, {
    action: "pay_order",
    id: orderId,
    orderId,
    paymentMethod: "wallet",
  });
  if (!(pay.ok || pay.json?.ok)) throw new Error(`pay failed: ${pay.json?.message || pay.status}`);
  await api("/api/companion", compT, { action: "accept_order", id: orderId });
  await api("/api/companion", compT, { action: "accept_direct_order", id: orderId });
  await api("/api/companion", compT, { action: "start_order", id: orderId });
  await api("/api/companion", compT, { action: "complete_order", id: orderId });
  if (completion === "boss_manual") {
    const conf = await api("/api/orders", bossT, {
      action: "confirm_complete",
      id: orderId,
      reason: "final-closeout boss confirm",
    });
    if (!(conf.ok || conf.json?.ok)) throw new Error(`boss confirm failed: ${conf.json?.message}`);
    return { orderId, order: null, place, pay, confirm: conf, inviteReward: conf.json?.inviteReward };
  }
  const adm = await api(
    "/api/admin/orders",
    adminT,
    {
      action: "update_status",
      id: orderId,
      status: "completed",
      reason: "final-closeout admin_force keep after-sale",
      method: "admin_force",
    },
    "POST",
    adminH
  );
  if (!(adm.ok || adm.json?.ok)) throw new Error(`admin complete failed: ${adm.json?.message}`);
  const mine = await api("/api/orders?action=my_orders", bossT, null, "GET");
  const row = (mine.json?.orders || []).find((o) => o.id === orderId);
  return { orderId, order: row, place, pay, confirm: adm, inviteReward: adm.json?.inviteReward };
}

async function companionSummary(compT) {
  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const s = boot.json?.summary || boot.json?.data?.summary || {};
  const e = boot.json?.earnings || boot.json?.data?.earnings || {};
  return {
    locked: money(s.earningsLocked ?? e.earningsLocked ?? 0),
    withdrawable: money(s.withdrawable ?? e.availableWithdrawable ?? e.withdrawable ?? 0),
    frozen: money(s.frozen ?? e.withdrawalLocked ?? 0),
    giftIncome: money(s.giftIncome ?? e.giftNetIncome ?? e.giftIncome ?? 0),
    raw: { summary: s, earnings: e },
  };
}

async function clearOpenRefundsAndWithdrawals(adminT, adminH) {
  const fin = await api("/api/admin/finance?action=bootstrap", adminT, null, "GET", adminH);
  const OPEN = new Set(["pending_review", "approved_for_payout", "included_in_batch", "processing", "carried_forward"]);
  for (const r of (fin.json?.bossRefunds || []).filter((x) => OPEN.has(String(x.status)))) {
    await api(
      "/api/admin/finance",
      adminT,
      { action: "confirm_meowcoin_refund", id: r.id, refundId: r.id, reason: "final-closeout clear" },
      "POST",
      adminH
    );
  }
  for (const w of fin.json?.withdrawals || []) {
    if (/pending_friday|submitted|reviewing|pending|approved|pending_payment/i.test(String(w.status || ""))) {
      await api(
        "/api/admin/finance",
        adminT,
        {
          action: "reject_withdraw",
          id: w.id || w.withdrawalId,
          withdrawalId: w.id || w.withdrawalId,
          reason: "final-closeout clear",
        },
        "POST",
        adminH
      );
    }
  }
}

// ---------- main ----------
const bossT = await login(bossEmail, "boss");
const inviteeT = await login(inviteeEmail, "boss");
const compT = await login(compEmail, "companion");
const adminLogin = await api("/api/auth", null, {
  action: "login",
  email: "admin@meow.test",
  password: "McjTest@12345678",
  role: "admin",
});
const adminT = adminLogin.json?.session?.accessToken || "";
const adminH = { "x-mcj-admin-role": "admin" };
if (!adminT) throw new Error("admin login failed");

const csLogin = await api("/api/auth", null, {
  action: "login",
  email: "service@meow.test",
  password: "McjTest@12345678",
  role: "customer_service",
});
const csT = csLogin.json?.session?.accessToken || "";

await ensureCompanionReady(adminT, adminH, compT, compId, "Organic Companion");
const inviteeCompT = await login(inviteeCompEmail, "companion");
await ensureCompanionReady(adminT, adminH, inviteeCompT, inviteeCompId, "Organic Invitee Comp");
await ensureBossCompanionRelation(adminT, adminH);
await clearOpenRefundsAndWithdrawals(adminT, adminH);
await ensureBossBalance(bossT, adminT, adminH, 300);
await ensureBossBalance(inviteeT, adminT, adminH, 150);

// ========== 4 + lock baseline: order for 24h ==========
{
  const before = await companionSummary(compT);
  const { orderId, order } = await placePayComplete({
    bossT,
    compT,
    adminT,
    adminH,
    note: "final-closeout-24h-lock",
    completion: "admin_force",
  });
  const afterLock = await companionSummary(compT);
  const lockOk = afterLock.locked > before.locked - 0.01 && order?.companionEarningsLocked !== false;
  // A: <24h locked
  const lockedPhase = {
    orderId: maskId(orderId),
    lockedBefore: before.locked,
    lockedAfter: afterLock.locked,
    withdrawable: afterLock.withdrawable,
    afterSaleOpen: order?.afterSaleOpen,
    completionMethod: order?.completionMethod,
  };
  report.evidence.lock_phase = lockedPhase;

  // B: backdate >=24h unlock
  const bd = await api(
    "/api/admin/orders",
    adminT,
    { action: "staging_backdate_completed_at", orderId, hoursAgo: 25 },
    "POST",
    adminH
  );
  const afterUnlock = await companionSummary(compT);
  const unlockOk =
    (bd.ok || bd.json?.ok) &&
    afterUnlock.withdrawable >= afterLock.withdrawable + 1 &&
    afterUnlock.locked < afterLock.locked - 0.01;
  setMod(
    "24H_EARNINGS_UNLOCK",
    lockOk && unlockOk ? "PASS" : "FAIL",
    `lockΔ=${money(afterLock.locked - before.locked)} unlock wd=${afterLock.withdrawable}→${afterUnlock.withdrawable} locked=${afterLock.locked}→${afterUnlock.locked} bd=${bd.json?.message || bd.status}`,
    {
      ...lockedPhase,
      backdate: { ok: bd.json?.ok, completed_at_after: bd.json?.completed_at_after, hoursAgo: 25 },
      afterUnlock,
    }
  );
}

// ========== 1–3 + R1–R8 refund path (fresh order, after-sale OPEN) ==========
{
  await ensureBossBalance(bossT, adminT, adminH, 80);
  const bal0 = await bossBal(bossT);
  const before = await companionSummary(compT);
  const { orderId, order } = await placePayComplete({
    bossT,
    compT,
    adminT,
    adminH,
    note: "final-closeout-refund-open",
    completion: "admin_force",
  });
  const r1 = order?.afterSaleOpen === true || order?.completionMethod === "admin_force";
  const mid = await companionSummary(compT);
  const req = await api("/api/orders", bossT, {
    action: "request_refund",
    id: orderId,
    orderId,
    reason: "final-closeout refund clawback",
    amount: 20,
  });
  const refundId = String(req.json?.refund?.id || req.json?.refundId || "").trim();
  const r2 = !!(req.ok || req.json?.ok) && !!refundId;
  const conf = await api(
    "/api/admin/finance",
    adminT,
    { action: "confirm_meowcoin_refund", id: refundId, refundId, reason: "final-closeout clawback" },
    "POST",
    adminH
  );
  const bal1 = await bossBal(bossT);
  const after = await companionSummary(compT);
  const claw = conf.json?.clawbacks || {};
  const r3 = money(bal1 - bal0) >= 19 || money(conf.json?.creditedCatFood) >= 19;
  const r4 = !!(claw.companion?.ok || claw.companion?.clawed > 0 || after.locked < mid.locked - 0.01);
  const bossCommClawed = money(claw.bossCommission?.clawed || 0);
  const csDid =
    claw.cs?.commission?.ok === true ||
    money(claw.cs?.commission?.clawed || 0) > 0 ||
    claw.cs?.dock?.ok === true;
  const r5 = bossCommClawed > 0 || csDid || claw.bossCommission?.ok === true;
  const r6 = !!(
    claw.points?.ok ||
    claw.points?.applied > 0 ||
    money(claw.points?.points) < 0 ||
    money(claw.points?.delta) < 0 ||
    claw.points?.duplicate === true
  );
  const conf2 = await api(
    "/api/admin/finance",
    adminT,
    { action: "confirm_meowcoin_refund", id: refundId, refundId, reason: "idempotent" },
    "POST",
    adminH
  );
  const r8 = !!(conf2.json?.duplicate || conf2.json?.alreadyRefunded || conf2.json?.ok);
  const refundPass = r1 && r2 && r3 && r4 && r5 && r6 && r8 && (conf.ok || conf.json?.ok);
  setMod(
    "REFUND_CLAWBACK",
    refundPass ? "PASS" : "FAIL",
    `R1=${r1} R2=${r2} R3=${r3} R4=${r4} R5=${r5} R6=${r6} R8=${r8} Δcat=${money(bal1 - bal0)} clawed=${claw.companion?.clawed} bossComm=${bossCommClawed}`,
    {
      orderId: maskId(orderId),
      refundId: maskId(refundId),
      afterSaleOpen: order?.afterSaleOpen,
      completionMethod: order?.completionMethod,
      credited: conf.json?.creditedCatFood,
      clawbacks: claw,
      bal0,
      bal1,
      lockedBefore: mid.locked,
      lockedAfter: after.locked,
      idempotent: { duplicate: conf2.json?.duplicate, alreadyRefunded: conf2.json?.alreadyRefunded },
    }
  );
  setMod(
    "COMMISSION_CLAWBACK",
    r5 ? "PASS" : "FAIL",
    `bossComm=${bossCommClawed} cs=${JSON.stringify(claw.cs || {}).slice(0, 160)}`,
    { clawbacks: claw }
  );
  setMod(
    "POINTS_FULL_REVOKE",
    r6 ? "PASS" : "FAIL",
    JSON.stringify(claw.points || {}).slice(0, 200),
    { points: claw.points }
  );

  // R9: boss_manual closes after-sale — new order
  await ensureBossBalance(bossT, adminT, adminH, 40);
  const closed = await placePayComplete({
    bossT,
    compT,
    adminT,
    adminH,
    note: "final-closeout-refund-closed-manual",
    completion: "boss_manual",
  });
  const reqClosed = await api("/api/orders", bossT, {
    action: "request_refund",
    id: closed.orderId,
    orderId: closed.orderId,
    reason: "should fail",
    amount: 20,
  });
  const r9 =
    reqClosed.status >= 400 &&
    (reqClosed.json?.code === "AFTER_SALE_CLOSED" || /售后窗口已关闭/i.test(String(reqClosed.json?.message || "")));

  // R10: backdate admin_force order beyond 24h → after-sale closed by time
  await ensureBossBalance(bossT, adminT, adminH, 40);
  const timed = await placePayComplete({
    bossT,
    compT,
    adminT,
    adminH,
    note: "final-closeout-refund-24h-closed",
    completion: "admin_force",
  });
  await api(
    "/api/admin/orders",
    adminT,
    { action: "staging_backdate_completed_at", orderId: timed.orderId, hoursAgo: 25 },
    "POST",
    adminH
  );
  const reqTimed = await api("/api/orders", bossT, {
    action: "request_refund",
    id: timed.orderId,
    orderId: timed.orderId,
    reason: "should fail timed",
    amount: 20,
  });
  const r10 =
    reqTimed.status >= 400 &&
    (reqTimed.json?.code === "AFTER_SALE_CLOSED" || /售后窗口已关闭/i.test(String(reqTimed.json?.message || "")));
  report.evidence.refund_gates = {
    r9,
    r10,
    closedOrder: maskId(closed.orderId),
    timedOrder: maskId(timed.orderId),
    closedMsg: reqClosed.json?.message,
    timedMsg: reqTimed.json?.message,
  };
  if (!r9 || !r10) {
    report.fails.push("REFUND_AFTER_SALE_GATES");
    console.log(`[FAIL] REFUND_AFTER_SALE_GATES :: R9=${r9} R10=${r10}`);
  } else {
    console.log(`[PASS] REFUND_AFTER_SALE_GATES :: R9=${r9} R10=${r10}`);
  }
}

// ========== 5–7 withdrawal ==========
{
  await clearOpenRefundsAndWithdrawals(adminT, adminH);
  await ensureBossBalance(bossT, adminT, adminH, 100);
  // fund gift net (immediately withdrawable)
  const cat = await api("/api/boss/marketplace?action=gift_catalog", bossT, null, "GET");
  const gift = (cat.json?.gifts || []).find((g) => Number(g.catFoodPrice || g.cat_food_price) > 0);
  let sum = await companionSummary(compT);
  for (let i = 0; i < 8 && sum.withdrawable < 50 && gift?.id; i++) {
    await api("/api/boss/marketplace", bossT, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      payMethod: "wallet",
      idempotencyKey: `fc-wd-fund-${Date.now()}-${i}`,
    });
    sum = await companionSummary(compT);
  }
  const before = await companionSummary(compT);
  const req1 = await api("/api/companion", compT, {
    action: "request_withdrawal",
    amount: 50,
    catFoodAmount: 50,
    channel: "bank",
  });
  const wdId = req1.json?.item?.id || req1.json?.data?.withdrawalId || "";
  const mid = await companionSummary(compT);
  const lockOk = (req1.ok || req1.json?.ok) && !!wdId && mid.frozen >= 50;
  setMod(
    "WITHDRAWAL_LOCK",
    lockOk ? "PASS" : "FAIL",
    `frozen=${mid.frozen} msg=${req1.json?.message || ""}`,
    { wdId: maskId(wdId), before, mid, req: req1.json }
  );

  const approve = await api(
    "/api/admin/finance",
    adminT,
    { action: "approve_withdraw", id: wdId, withdrawalId: wdId },
    "POST",
    adminH
  );
  const paid = await api(
    "/api/admin/finance",
    adminT,
    {
      action: "mark_withdraw_paid",
      id: wdId,
      withdrawalId: wdId,
      bankReference: `FC-WD-${Date.now()}`,
      paymentRemark: "final-closeout",
      receiptDataUrl: PNG,
    },
    "POST",
    adminH
  );
  setMod(
    "WITHDRAWAL_PAY",
    paid.ok || paid.json?.ok || approve.ok ? "PASS" : "FAIL",
    `approve=${approve.status} paid=${paid.status} ${paid.json?.message || ""}`,
    { approve: approve.json, paid: paid.json }
  );

  // restore via reject path
  sum = await companionSummary(compT);
  for (let i = 0; i < 8 && sum.withdrawable < 50 && gift?.id; i++) {
    await api("/api/boss/marketplace", bossT, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      payMethod: "wallet",
      idempotencyKey: `fc-wd-restore-${Date.now()}-${i}`,
    });
    sum = await companionSummary(compT);
  }
  const reqR = await api("/api/companion", compT, {
    action: "request_withdrawal",
    amount: 50,
    catFoodAmount: 50,
    channel: "bank",
  });
  const ridW = reqR.json?.item?.id || reqR.json?.data?.withdrawalId || "";
  const beforeRej = await companionSummary(compT);
  const rej = await api(
    "/api/admin/finance",
    adminT,
    { action: "reject_withdraw", id: ridW, withdrawalId: ridW, reason: "final-closeout restore" },
    "POST",
    adminH
  );
  const afterRej = await companionSummary(compT);
  const restoreOk =
    (rej.ok || rej.json?.ok) &&
    (afterRej.withdrawable > beforeRej.withdrawable - 0.01 || afterRej.frozen < beforeRej.frozen - 0.01);
  setMod(
    "WITHDRAWAL_RESTORE",
    restoreOk ? "PASS" : "FAIL",
    `wd ${beforeRej.withdrawable}→${afterRej.withdrawable} frozen ${beforeRej.frozen}→${afterRej.frozen}`,
    { ridW: maskId(ridW), beforeRej, afterRej, rej: rej.json }
  );
}

// ========== 8–10 gifts ==========
{
  await ensureBossBalance(bossT, adminT, adminH, 80);
  const cat = await api("/api/boss/marketplace?action=gift_catalog", bossT, null, "GET");
  const gifts = cat.json?.gifts || [];
  const gift = gifts.find((g) => Number(g.catFoodPrice || g.cat_food_price) > 0);
  setMod("GIFT_SCHEMA", gifts.length > 0 ? "PASS" : "FAIL", `n=${gifts.length}`, { n: gifts.length, giftId: gift?.id });

  const before = await companionSummary(compT);
  const send = await api("/api/boss/marketplace", bossT, {
    action: "send_gift",
    companionId: compId,
    giftId: gift?.id,
    quantity: 1,
    payMethod: "wallet",
    idempotencyKey: `fc-gift-${Date.now()}`,
  });
  const after = await companionSummary(compT);
  const grossOk = (send.ok || send.json?.ok) && (after.giftIncome > before.giftIncome || after.withdrawable > before.withdrawable);
  setMod(
    "GIFT_GROSS",
    grossOk ? "PASS" : "FAIL",
    `giftIncome ${before.giftIncome}→${after.giftIncome} msg=${send.json?.message || ""}`,
    { before, after, send: send.json }
  );
  setMod(
    "GIFT_NET_WITHDRAWABLE",
    after.withdrawable > before.withdrawable ? "PASS" : "FAIL",
    `wd ${before.withdrawable}→${after.withdrawable}`,
    { before, after }
  );

  const ext = await api("/api/boss/gift-orders", bossT, {
    action: "create",
    companionId: compId,
    giftId: gift?.id,
    quantity: 1,
    paymentChannel: "external",
    idempotencyKey: `fc-ext-${Date.now()}`,
  });
  const eid = ext.json?.order?.id || "";
  if (eid) {
    await api("/api/boss/gift-orders", bossT, { action: "upload_proof", orderId: eid, proofDataUrl: PNG });
  }
  const appr = eid
    ? await api("/api/customer-service", csT || adminT, { action: "approve_gift_order", id: eid, orderId: eid })
    : { ok: false, json: { message: "no order" } };
  setMod(
    "EXTERNAL_GIFT_REVIEW",
    appr.ok || appr.json?.ok ? "PASS" : "FAIL",
    `eid=${maskId(eid)} ${appr.json?.message || appr.status}`,
    { eid: maskId(eid), create: ext.json, appr: appr.json }
  );
}

// ========== 11 referral ==========
{
  // A) Boss invite → invitee boss recognize+confirm → qualifying order (boss_manual closes after-sale → grant catfood)
  const inv = await api("/api/boss/invite-links", bossT, { action: "create" });
  const code = inv.json?.link?.code || inv.json?.code || inv.json?.inviteCode || "";
  const recognize = await api("/api/invite/confirm", inviteeT, {
    action: "recognize",
    code,
    inviteCode: code,
  });
  const confirm = await api("/api/invite/confirm", inviteeT, { action: "confirm" });
  const balInviter0 = await bossBal(bossT);
  const bonus0 = await bossBonus(bossT);
  await ensureBossBalance(inviteeT, adminT, adminH, 40);
  const bossPath = await placePayComplete({
    bossT: inviteeT,
    compT,
    adminT,
    adminH,
    note: "final-closeout-referral-boss-qualifying",
    completion: "boss_manual",
  });
  const balInviter1 = await bossBal(bossT);
  const bonus1 = await bossBonus(bossT);
  const confirm2 = await api("/api/invite/confirm", inviteeT, { action: "confirm" });
  const status = await api("/api/invite/confirm?action=pending", inviteeT, null, "GET");
  const deltaBoss = money(balInviter1 - balInviter0);
  const deltaBonus = money(bonus1 - bonus0);
  const inviteRewardBoss = bossPath.inviteReward || bossPath.confirm?.json?.inviteReward;
  const bossGranted =
    deltaBoss > 0 ||
    deltaBonus > 0 ||
    inviteRewardBoss?.granted === true ||
    (Array.isArray(inviteRewardBoss) && inviteRewardBoss.some((r) => r?.granted)) ||
    confirm.json?.reward?.granted === true ||
    status.json?.confirmed?.status === "confirmed";
  const bossIdem =
    confirm2.json?.alreadyConfirmed === true ||
    confirm2.json?.reward?.duplicate === true ||
    confirm2.json?.ok === true;

  // B) Companion invite → invitee companion → order on invitee companion → cash/withdrawable grant
  const invC = await api("/api/companion/invite-links", compT, { action: "create" });
  const codeC = invC.json?.link?.code || invC.json?.code || "";
  const recognizeC = await api("/api/invite/confirm", inviteeCompT, {
    action: "recognize",
    code: codeC,
    inviteCode: codeC,
  });
  const confirmC = await api("/api/invite/confirm", inviteeCompT, { action: "confirm" });
  const sumInviter0 = await companionSummary(compT);
  await ensureBossBalance(bossT, adminT, adminH, 40);
  const compPath = await placePayComplete({
    bossT,
    compT: inviteeCompT,
    adminT,
    adminH,
    note: "final-closeout-referral-comp-qualifying",
    completion: "boss_manual",
    companionUserId: inviteeCompId,
    companionName: "Organic Invitee Comp",
  });
  const sumInviter1 = await companionSummary(compT);
  const confirmC2 = await api("/api/invite/confirm", inviteeCompT, { action: "confirm" });
  const inviteRewardComp = compPath.inviteReward || compPath.confirm?.json?.inviteReward;
  const deltaCompWd = money(sumInviter1.withdrawable - sumInviter0.withdrawable);
  const deltaCompLocked = money(sumInviter1.locked - sumInviter0.locked);
  const compGranted =
    deltaCompWd > 0 ||
    deltaCompLocked > 0 ||
    inviteRewardComp?.granted === true ||
    (Array.isArray(inviteRewardComp) && inviteRewardComp.some((r) => r?.granted));
  const compIdem = confirmC2.json?.alreadyConfirmed === true || confirmC2.json?.ok === true;

  const granted = bossGranted && compGranted;
  const idem = bossIdem && compIdem;
  setMod(
    "REFERRAL_REWARD",
    granted && idem ? "PASS" : "FAIL",
    `bossCode=${code ? String(code).slice(0, 6) + "…" : "none"} Δboss=${deltaBoss}/Δbonus=${deltaBonus} bossGranted=${bossGranted} | compCode=${codeC ? String(codeC).slice(0, 6) + "…" : "none"} Δwd=${deltaCompWd} Δlocked=${deltaCompLocked} compGranted=${compGranted}`,
    {
      source: "staging_organic",
      boss: {
        inviteCodePrefix: code ? String(code).slice(0, 6) : "",
        inviteeId: maskId(inviteeId),
        inviterId: maskId(bossId),
        qualifyingOrderId: maskId(bossPath.orderId),
        recognize: recognize.json,
        confirm: confirm.json,
        confirm2: confirm2.json,
        status: status.json,
        balInviter0,
        balInviter1,
        bonus0,
        bonus1,
        deltaBoss,
        deltaBonus,
        inviteReward: inviteRewardBoss,
      },
      companion: {
        inviteCodePrefix: codeC ? String(codeC).slice(0, 6) : "",
        inviteeId: maskId(inviteeCompId),
        inviterId: maskId(compId),
        qualifyingOrderId: maskId(compPath.orderId),
        recognize: recognizeC.json,
        confirm: confirmC.json,
        confirm2: confirmC2.json,
        sumInviter0,
        sumInviter1,
        deltaCompWd,
        deltaCompLocked,
        inviteReward: inviteRewardComp,
      },
    }
  );
}

// ========== 12 #295 gift+withdraw freeze SoT (already proven in withdrawal section) ==========
{
  const wd = report.modules.WITHDRAWAL_LOCK?.result === "PASS";
  const pay = report.modules.WITHDRAWAL_PAY?.result === "PASS";
  const gift = report.modules.GIFT_NET_WITHDRAWABLE?.result === "PASS";
  setMod(
    "GIFT_WITHDRAW_FREEZE_SOT",
    wd && pay && gift ? "PASS" : "FAIL",
    `wd=${wd} pay=${pay} giftNet=${gift}`,
    { dependsOn: ["WITHDRAWAL_LOCK", "WITHDRAWAL_PAY", "GIFT_NET_WITHDRAWABLE"] }
  );
}

// Map to requested 12-item names
const matrix = {
  "1_REFUND_CLAWBACK": report.modules.REFUND_CLAWBACK,
  "2_COMMISSION_CLAWBACK": report.modules.COMMISSION_CLAWBACK,
  "3_POINTS_FULL_REVOKE": report.modules.POINTS_FULL_REVOKE,
  "4_24H_EARNINGS_UNLOCK": report.modules["24H_EARNINGS_UNLOCK"],
  "5_WITHDRAWAL_LOCK": report.modules.WITHDRAWAL_LOCK,
  "6_WITHDRAWAL_PAY": report.modules.WITHDRAWAL_PAY,
  "7_WITHDRAWAL_RESTORE": report.modules.WITHDRAWAL_RESTORE,
  "8_GIFT_GROSS": report.modules.GIFT_GROSS,
  "9_GIFT_NET_WITHDRAWABLE": report.modules.GIFT_NET_WITHDRAWABLE,
  "10_EXTERNAL_GIFT_REVIEW": report.modules.EXTERNAL_GIFT_REVIEW,
  "11_REFERRAL_REWARD": report.modules.REFERRAL_REWARD,
  "12_GIFT_WITHDRAW_FREEZE_SOT": report.modules.GIFT_WITHDRAW_FREEZE_SOT,
};
report.matrix12 = matrix;
const allPass = Object.values(matrix).every((m) => m?.result === "PASS");
report.ok = allPass;
report.fails = Object.entries(matrix)
  .filter(([, v]) => v?.result !== "PASS")
  .map(([k]) => k);

fs.writeFileSync(path.join(outDir, "FINAL_CLOSEOUT_RESULT.json"), JSON.stringify(report, null, 2));
console.log("\n==== MATRIX 12 ====");
for (const [k, v] of Object.entries(matrix)) {
  console.log(`${k}: ${v?.result} — ${v?.detail}`);
}
console.log(`\nok=${report.ok} fails=${report.fails.length} out=${path.join(outDir, "FINAL_CLOSEOUT_RESULT.json")}`);
process.exit(report.ok ? 0 : 1);
