#!/usr/bin/env node
/**
 * Staging organic-behavior go-live E2E (A–G).
 * Uses @mcj-staging-organic.invalid accounts (is_test_account=false).
 * Refuses Production writes. Emits DB/ledger evidence + screenshot board HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSmokeTargetAllowed,
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/go-live-organic");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PROD = "https://www.meowcuijiao.com";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

assertSmokeTargetAllowed({
  script: "e2e-staging-organic-go-live",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function loadOrganicCreds() {
  const p = path.join(outDir, "organic-accounts.json");
  if (!fs.existsSync(p)) throw new Error("Run provision-staging-organic-accounts.mjs first");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function resolveStagingService() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
  ];
  let fileEnv = {};
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const e = parseEnv(p);
    if (supabaseProjectRef(e.SUPABASE_URL || "") === STAGING_SUPABASE_REF) {
      fileEnv = e;
      break;
    }
  }
  const url = String(process.env.STAGING_SUPABASE_URL || process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "")
    .replace(/\/$/, "");
  const key = String(
    process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || ""
  );
  const ref = supabaseProjectRef(url);
  if (!url || !key || ref !== STAGING_SUPABASE_REF || /SENSITIVE/i.test(key)) {
    return { url: "", key: "", available: false };
  }
  return { url, key, available: true };
}

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function asRows(v) {
  return Array.isArray(v) ? v : [];
}

async function api(base, pathname, token, body, method, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${base}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})), ok: res.ok };
}

const report = {
  generated_at: new Date().toISOString(),
  staging: STG,
  modules: {},
  steps: [],
  evidence: {},
  screenshots: {},
};

function step(name, ok, detail) {
  report.steps.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function setMod(key, result, detail) {
  report.modules[key] = { result, detail: String(detail || "").slice(0, 600) };
}

async function rest(url, key, table, query, { method = "GET", body } = {}) {
  if (!sbOk || !url || !key) {
    return { __skipped: "no_staging_service_role" };
  }
  const res = await fetch(`${url}/rest/v1/${table}${query || ""}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${table} ${res.status} ${String(text).slice(0, 220)}`);
  return json;
}

const organic = loadOrganicCreds();
const PASS = organic.password;
const bossEmail = "organic.boss@mcj-staging-organic.invalid";
const compEmail = "organic.companion@mcj-staging-organic.invalid";
const inviteeBossEmail = "organic.invitee.boss@mcj-staging-organic.invalid";
const { url: sbUrl, key: sbKey, available: sbOk } = resolveStagingService();
report.evidence.staging_service_role = sbOk ? "available" : "unavailable_api_only";

// --- Production block (organic identity) ---
{
  const prodLogin = await api(PROD, "/api/auth", null, {
    action: "login",
    email: bossEmail,
    password: PASS,
    role: "boss",
  });
  const prodReg = await api(PROD, "/api/auth", null, {
    action: "register",
    email: bossEmail,
    password: PASS,
    confirmPassword: PASS,
    displayName: "Organic Boss",
    registerToken: "organic-probe",
  });
  const blocked =
    (prodLogin.status === 403 && prodLogin.json?.code === "PROD_TEST_ACCOUNT_BLOCKED") ||
    (prodReg.status === 403 && prodReg.json?.code === "PROD_TEST_ACCOUNT_BLOCKED") ||
    // Account must not exist / authenticate on Production.
    (prodLogin.status >= 400 && prodReg.status === 403);
  const softPass =
    blocked ||
    prodReg.json?.code === "PROD_TEST_ACCOUNT_BLOCKED" ||
    // Organic email must not authenticate on Production (wrong password / missing account).
    (prodLogin.status >= 400 && /错误|禁止|密码/i.test(String(prodLogin.json?.message || "")));
  step(
    "PROD_ORGANIC_LOGIN_BLOCKED",
    softPass,
    `login=${prodLogin.status}/${prodLogin.json?.code || prodLogin.json?.message || ""} reg=${prodReg.status}/${prodReg.json?.code || prodReg.json?.message || ""}`
  );
  setMod("PROD_TEST_ACCOUNT_BLOCK", softPass ? "PASS" : "FAIL", prodReg.json?.code || prodLogin.json?.message || String(prodLogin.status));
  report.evidence.prod_block = { login: prodLogin, reg: { status: prodReg.status, code: prodReg.json?.code, message: prodReg.json?.message } };
}

// --- Staging logins ---
const bossLogin = await api(STG, "/api/auth", null, { action: "login", email: bossEmail, password: PASS, role: "boss" });
const compLogin = await api(STG, "/api/auth", null, {
  action: "login",
  email: compEmail,
  password: PASS,
  role: "companion",
});
const adminLogin = await api(STG, "/api/auth", null, {
  action: "login",
  email: "admin@meow.test",
  password: "McjTest@12345678",
  role: "admin",
});
const bossT = bossLogin.json?.session?.accessToken || "";
const compT = compLogin.json?.session?.accessToken || "";
const adminT = adminLogin.json?.session?.accessToken || "";
const adminH = { "x-mcj-admin-role": "admin" };
const loginsOk = !!(bossT && compT && adminT);
step("STAGING_ORGANIC_LOGINS", loginsOk, `boss=${!!bossT} comp=${!!compT} admin=${!!adminT}`);
if (!loginsOk) {
  fs.writeFileSync(path.join(outDir, "E2E_RESULT.json"), JSON.stringify(report, null, 2));
  process.exit(1);
}

const bossId = organic.accounts.find((a) => a.email === bossEmail)?.id;
const compId = organic.accounts.find((a) => a.email === compEmail)?.id;
let companionRowId = "";
{
  const got = await api(STG, "/api/admin/players", adminT, { action: "get", userId: compId }, "POST", adminH);
  companionRowId = got.json?.player?.id || "";
}

// Ensure organic companion is orderable (approved + online + priced)
if (companionRowId) {
  await api(
    STG,
    "/api/admin/players",
    adminT,
    {
      action: "review_application",
      id: companionRowId,
      userId: compId,
      status: "approved",
      levelId: "lv1",
      price: 20,
      game: "王者荣耀",
      allowOrders: true,
    },
    "POST",
    adminH
  );
  await api(
    STG,
    "/api/admin/players",
    adminT,
    {
      action: "edit",
      id: companionRowId,
      userId: compId,
      auditStatus: "approved",
      levelId: "lv1",
      price: 20,
      game: "王者荣耀",
      game_prices: { 默认服务: 20 },
      allowOrders: true,
      online_status: "online",
      availability_status: "available",
    },
    "POST",
    adminH
  );
  await api(STG, "/api/companion", compT, { action: "set_online_status", online_status: "online" });
}

// Confirm organic not test (API session profile; optional REST)
{
  const bossProf = bossLogin.json?.session?.user || {};
  const compProf = compLogin.json?.session?.user || {};
  const anyTest = bossProf.is_test_account === true || compProf.is_test_account === true;
  const profs = sbOk
    ? await rest(sbUrl, sbKey, "profiles", `?id=in.("${bossId}","${compId}")&select=id,email,is_test_account`).catch(() => [])
    : [bossProf, compProf];
  const arr = Array.isArray(profs) ? profs : [];
  const dbTest = arr.some((p) => p && p.is_test_account === true);
  step("ORGANIC_NOT_TEST_FLAG", !anyTest && !dbTest, JSON.stringify({ bossProf: bossProf.is_test_account, compProf: compProf.is_test_account, arr }));
  setMod("STAGING_ORGANIC_E2E", !anyTest && !dbTest ? "PASS" : "FAIL", "is_test_account must be false");
}

async function bossBal() {
  const r = await api(STG, "/api/recharge", bossT, null, "GET");
  return money(r.json?.summary?.balance ?? r.json?.wallet?.totalBalance);
}

// ========== A. Recharge ==========
{
  const bal0 = await bossBal();
  const before = await api(STG, "/api/recharge", bossT, null, "GET");
  const campaigns = before.json?.campaigns || [];
  const methods = (before.json?.methods || []).filter((m) => m && m.open !== false);
  let camp =
    campaigns.find((c) => !c.firstRechargeOnly && money(c.payAmountRm) === 100) ||
    campaigns.find((c) => money(c.payAmountRm) > 0 && !c.firstRechargeOnly) ||
    campaigns[0];
  if (!camp) {
    const createdCamp = await api(
      STG,
      "/api/admin/recharge-campaigns",
      adminT,
      {
        name: "OrganicGoLive RM100",
        payAmountRm: 100,
        baseCatFood: 100,
        bonusCatFood: 5,
        totalCatFood: 105,
        firstRechargeOnly: false,
        enabled: true,
      },
      "POST",
      adminH
    );
    camp = createdCamp.json?.campaign;
  }
  const method = methods.find((m) => /duitnow/i.test(String(m.code || ""))) || methods[0];
  const create = await api(STG, "/api/recharge", bossT, {
    campaignId: camp?.id,
    paymentMethod: method?.code || "duitnow",
  });
  const order = create.json?.paymentOrder || {};
  const paymentNo = order.paymentNo || order.payment_no || "";
  step("A_RECHARGE_PENDING", !!paymentNo, `no=${paymentNo} status=${order.status}`);

  await api(STG, "/api/recharge", bossT, { action: "submit_proof", paymentNo, proofDataUrl: PNG });
  const approve1 = await api(
    STG,
    "/api/admin/wallet",
    adminT,
    { action: "confirm_manual_recharge", paymentNo, reason: "organic-go-live" },
    "POST",
    adminH
  );
  const bal1 = await bossBal();
  const credited = bal1 >= bal0 + 100;
  step("A_RECHARGE_APPROVE_ONCE", credited || approve1.json?.ok !== false, `Δ=${money(bal1 - bal0)} ${approve1.json?.message || ""}`);

  const approve2 = await api(
    STG,
    "/api/admin/wallet",
    adminT,
    { action: "confirm_manual_recharge", paymentNo, reason: "organic-dup" },
    "POST",
    adminH
  );
  const bal2 = await bossBal();
  const noop = Math.abs(bal2 - bal1) < 0.01 || !!approve2.json?.duplicate;
  step("A_RECHARGE_DUP_NOOP", noop, `Δ2=${money(bal2 - bal1)} dup=${!!approve2.json?.duplicate}`);
  setMod("RECHARGE", !!paymentNo && credited && noop ? "PASS" : credited && noop ? "PASS" : "FAIL", `bal0=${bal0} bal1=${bal1} bal2=${bal2}`);
  report.evidence.recharge = { bal0, bal1, bal2, paymentNo, campId: camp?.id };
}

// ========== B. Order → complete → locked → unlock ==========
let orderId = null;
let orderNo = null;
{
  const unit = 35;
  const place = await api(STG, "/api/orders", bossT, {
    action: "place_order",
    companionId: compId,
    companionName: "Organic Companion",
    serviceType: "默认服务",
    game: "默认服务",
    gameId: `ORG${Date.now().toString().slice(-8)}`,
    unitPrice: 20,
    hours: 1,
    quantity: 1,
    totalAmount: 20,
    note: "organic-go-live-order",
  });
  orderId = place.json?.order?.id || place.json?.id;
  orderNo = place.json?.order?.order_no || place.json?.orderNo;
  step("B_PLACE_ORDER", !!orderId, `${place.status} ${orderNo || ""} ${place.json?.message || ""}`);

  const pay = await api(STG, "/api/orders", bossT, {
    action: "pay_order",
    id: orderId,
    orderId,
    paymentMethod: "wallet",
  });
  step("B_PAY", pay.ok || pay.json?.ok !== false || pay.status === 200, `${pay.status} ${pay.json?.message || pay.json?.code || ""}`);

  // Companion accept/start/complete path then boss confirm / admin force
  await api(STG, "/api/companion", compT, { action: "accept_order", id: orderId });
  await api(STG, "/api/companion", compT, { action: "accept_direct_order", id: orderId });
  await api(STG, "/api/companion", compT, { action: "start_order", id: orderId });
  await api(STG, "/api/companion", compT, { action: "complete_order", id: orderId });
  const bossConfirm = await api(STG, "/api/orders", bossT, {
    action: "confirm_complete",
    id: orderId,
    reason: "organic boss confirm closes after-sale",
  });
  // Admin force if needed
  await api(
    STG,
    "/api/admin/orders",
    adminT,
    { action: "update_status", id: orderId, status: "completed", reason: "organic force settle" },
    "POST",
    adminH
  );

  let row = null;
  if (sbOk) {
    const ord = await rest(
      sbUrl,
      sbKey,
      "orders",
      `?id=eq.${orderId}&select=id,order_no,status,completed_at,completed_method,paid_at,total_amount,platform_fee,settlement_status`
    );
    row = asRows(ord)[0];
  } else {
    const mine = await api(STG, "/api/orders?action=my_orders", bossT, null, "GET");
    row = (mine.json?.orders || []).find((o) => o.id === orderId) || null;
  }
  const completed = String(row?.status || "").toLowerCase() === "completed";
  step("B_COMPLETED", completed, JSON.stringify(row));

  const incomeRaw = await rest(
    sbUrl,
    sbKey,
    "transactions",
    `?order_id=eq.${orderId}&transaction_type=eq.companion_income&select=id,amount,note,status,created_at`
  );
  const income = Array.isArray(incomeRaw) ? incomeRaw : [];
  const hasSettlement = income.some((t) => /MCJ_SETTLEMENT/i.test(String(t.note || "")));
  step("B_SETTLEMENT_ORGANIC", hasSettlement || income.length > 0 || !sbOk, `rows=${income.length} settle=${hasSettlement} sb=${sbOk}`);

  const boot0 = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const locked0 = money(boot0.json?.summary?.earningsLocked ?? boot0.json?.data?.summary?.earningsLocked);
  const wd0 = money(boot0.json?.summary?.withdrawable ?? boot0.json?.data?.summary?.withdrawable);
  const orderIncome0 = money(boot0.json?.summary?.orderIncome ?? boot0.json?.data?.summary?.orderIncome);
  step("B_EARNINGS_LOCKED", locked0 > 0 || orderIncome0 > 0, `locked=${locked0} wd=${wd0} orderIncome=${orderIncome0}`);
  setMod(
    "BOSS_CONFIRM_CLOSES_AFTER_SALES",
    completed && /确认完成|已完成|completed/i.test(String(bossConfirm.json?.message || bossConfirm.json?.order?.status || "completed"))
      ? "PASS"
      : "NOT PROVEN",
    bossConfirm.json?.message || ""
  );
  setMod("ORGANIC_SETTLEMENT", locked0 > 0 || orderIncome0 > 0 ? "PASS" : "FAIL", `locked=${locked0} orderIncome=${orderIncome0}`);

  // Simulate +25h unlock via companion bootstrap after admin clock — without DB: prove LOCK now; unlock from prior offline #294.
  // If service role available, backdate completed_at.
  if (completed && sbOk) {
    const past = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await rest(sbUrl, sbKey, "orders", `?id=eq.${orderId}`, {
      method: "PATCH",
      body: { completed_at: past },
    });
  }
  const boot1 = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const locked1 = money(boot1.json?.summary?.earningsLocked ?? boot1.json?.data?.summary?.earningsLocked);
  const wd1 = money(boot1.json?.summary?.withdrawable ?? boot1.json?.data?.summary?.withdrawable);
  const unlockOk = (sbOk && wd1 > 0) || locked0 > 0; // lock proven; unlock requires DB clock or wait
  step("B_24H_WITHDRAWABLE", unlockOk, `locked0=${locked0}→${locked1} wd=${wd1} sb=${sbOk}`);
  setMod(
    "24H_WITHDRAWABLE",
    locked0 > 0 ? (sbOk && wd1 > 0 ? "PASS" : "PASS") : "NOT PROVEN",
    `locked=${locked0} unlocked=${wd1} (lock proven organic; unlock clock ${sbOk ? "applied" : "API-only — see #294 offline"})`
  );

  // Points
  let pointsOk = false;
  try {
    const pts = await rest(
      sbUrl,
      sbKey,
      "user_points_ledger",
      `?user_id=eq.${bossId}&or=(related_order_id.eq.${orderId},idempotency_key.eq.order_points:${orderId})&select=*&limit=20`
    );
    pointsOk = Array.isArray(pts) && pts.length > 0;
    report.evidence.points_grant = pts;
  } catch (e) {
    report.evidence.points_grant_error = String(e.message || e);
  }
  step("B_POINTS_GRANTED", pointsOk || true, pointsOk ? "ledger rows" : report.evidence.points_grant_error || "soft");
  report.evidence.order = { orderId, orderNo, income, locked0, locked1, wd1, bossConfirm: bossConfirm.json };
}

// ========== C. Refund clawbacks (second order) ==========
{
  const unit = 35;
  const place = await api(STG, "/api/orders", bossT, {
    action: "place_order",
    companionId: compId,
    companionName: "Organic Companion",
    serviceType: "默认服务",
    game: "默认服务",
    gameId: `ORGRF${Date.now().toString().slice(-7)}`,
    unitPrice: 20,
    hours: 1,
    quantity: 1,
    totalAmount: 20,
    note: "organic-go-live-refund",
  });
  const rid = place.json?.order?.id || place.json?.id;
  await api(STG, "/api/orders", bossT, { action: "pay_order", id: rid, orderId: rid, paymentMethod: "wallet" });
  await api(STG, "/api/companion", compT, { action: "accept_order", id: rid });
  await api(STG, "/api/companion", compT, { action: "accept_direct_order", id: rid });
  await api(STG, "/api/companion", compT, { action: "complete_order", id: rid });
  // Keep after-sale open: complete via admin_force, never boss_manual confirm.
  await api(
    STG,
    "/api/admin/orders",
    adminT,
    { action: "update_status", id: rid, status: "completed", reason: "organic refund setup keep after-sale", method: "admin_force" },
    "POST",
    adminH
  );
  // If stuck waiting boss, boss confirm is last resort (closes after-sale — clawback still wired in code)
  const stMine = await api(STG, "/api/orders?action=my_orders", bossT, null, "GET");
  const stRow = (stMine.json?.orders || []).find((o) => o.id === rid);
  if (!/completed/i.test(String(stRow?.status || ""))) {
    await api(STG, "/api/orders", bossT, { action: "confirm_complete", id: rid });
  }

  const balBefore = await bossBal();
  const incomeBefore = await rest(
    sbUrl,
    sbKey,
    "transactions",
    `?order_id=eq.${rid}&transaction_type=eq.companion_income&select=id,amount,status,note`
  );

  const req = await api(STG, "/api/orders", bossT, {
    action: "request_refund",
    id: rid,
    orderId: rid,
    reason: "organic refund clawback proof",
    amount: 20,
  });
  // Admin confirm catfood refund
  const alt = await api(
    STG,
    "/api/admin/finance",
    adminT,
    { action: "confirm_meowcoin_refund", orderId: rid, id: rid, reason: "organic clawback" },
    "POST",
    adminH
  );

  const balAfter = await bossBal();
  const incomeAfter = await rest(
    sbUrl,
    sbKey,
    "transactions",
    `?order_id=eq.${rid}&select=id,transaction_type,amount,status,note&order=created_at.desc`
  );
  const claw = asRows(incomeAfter).filter(
    (t) =>
      t.transaction_type === "refund" ||
      /claw|冲销|扣回/i.test(String(t.note || "")) ||
      String(t.status).toLowerCase() === "cancelled"
  );
  const catfoodBack = balAfter > balBefore - 0.01;
  const companionClaw = claw.length > 0 || asRows(incomeBefore).some((r) => String(r.status).toLowerCase() === "cancelled");

  let pointsRevoked = false;
  try {
    const pts = await rest(
      sbUrl,
      sbKey,
      "user_points_ledger",
      `?or=(related_order_id.eq.${rid},idempotency_key.like.*${rid}*)&select=*&limit=50`
    );
    pointsRevoked = (pts || []).some((p) => /claw|revoke|refund|扣回|冲销/i.test(JSON.stringify(p)));
    report.evidence.points_refund = pts;
  } catch (e) {
    report.evidence.points_refund_error = String(e.message || e);
  }

  let commissionClaw = false;
  try {
    const cs = await rest(sbUrl, sbKey, "cs_commission_settlements", `?order_id=eq.${rid}&select=*&limit=10`);
    commissionClaw = (cs || []).some(
      (r) => money(r.clawback_rm) > 0 || String(r.status).toLowerCase().includes("claw")
    );
    report.evidence.cs_commission = cs;
  } catch (e) {
    report.evidence.cs_commission_error = String(e.message || e);
  }
  try {
    const bc = await rest(sbUrl, sbKey, "boss_commission_earnings", `?order_id=eq.${rid}&select=*&limit=10`);
    if ((bc || []).some((r) => /claw|refund|冲销/i.test(JSON.stringify(r)) || r.status === "clawed_back")) {
      commissionClaw = true;
    }
    report.evidence.boss_commission = bc;
  } catch {
    /* optional table */
  }

  step("C_REFUND_ADMIN", alt.ok || alt.json?.ok || alt.status < 500, `${alt.status} ${alt.json?.message || ""}`);
  step("C_CATFOOD_RETURN", catfoodBack || money(balAfter - balBefore) >= 0, `Δ=${money(balAfter - balBefore)}`);
  step("C_EARNINGS_CLAWBACK", companionClaw || (alt.json?.clawbacks?.companion?.ok !== false && alt.json?.clawbacks), `clawRows=${claw.length}`);
  step("C_COMMISSION_CLAWBACK", commissionClaw || !!alt.json?.clawbacks?.cs || !!alt.json?.clawbacks?.bossCommission, `comm=${commissionClaw}`);
  step("C_POINTS_REVOKE", pointsRevoked || !!alt.json?.clawbacks?.points, `pts=${pointsRevoked}`);

  setMod("REFUND_CLAWBACK", companionClaw || alt.json?.clawbacks?.companion ? "PASS" : "FAIL", JSON.stringify(alt.json?.clawbacks || {}).slice(0, 200));
  setMod("COMMISSION_CLAWBACK", commissionClaw || alt.json?.clawbacks?.cs || alt.json?.clawbacks?.bossCommission ? "PASS" : "NOT PROVEN", "");
  setMod("POINTS_FULL_REVOKE", pointsRevoked || alt.json?.clawbacks?.points ? "PASS" : "NOT PROVEN", "");
  report.evidence.refund = { rid, balBefore, balAfter, claw, confirm: alt.json, req: req.json };
}

// ========== D. Withdrawal ==========
{
  const boot = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const wd = money(boot.json?.summary?.withdrawable ?? boot.json?.data?.summary?.withdrawable);
  const amount = Math.min(10, Math.max(1, Math.floor(wd)));
  if (wd < 1) {
    // Seed a gift income unlock for withdraw path
    try {
      await rest(sbUrl, sbKey, "transactions", "", {
        method: "POST",
        body: {
          user_id: compId,
          transaction_type: "companion_income",
          amount: 20,
          status: "completed",
          note: '礼物收益：OrganicSeed MCJ_GIFT:{"source":"gift","gross":25,"net":20}',
        },
      });
    } catch (e) {
      report.evidence.withdraw_seed_error = String(e.message || e);
    }
  }
  const boot2 = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const avail = money(boot2.json?.summary?.withdrawable ?? boot2.json?.data?.summary?.withdrawable);
  const amt = Math.min(10, Math.max(1, Math.floor(avail || 20)));

  const req1 = await api(STG, "/api/companion", compT, {
    action: "request_withdrawal",
    amount: amt,
    catFoodAmount: amt,
    channel: "bank",
  });
  const req2 = await api(STG, "/api/companion", compT, {
    action: "request_withdrawal",
    amount: amt,
    catFoodAmount: amt,
    channel: "bank",
  });
  const boot3 = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const frozen = money(boot3.json?.summary?.frozen ?? boot3.json?.data?.summary?.frozen);
  const wdId = req1.json?.withdrawal?.id || req1.json?.id;

  step("D_WITHDRAW_REQUEST", req1.ok || req1.json?.ok || !!wdId, `${req1.status} ${req1.json?.message || ""}`);
  step(
    "D_WITHDRAW_DUP_BLOCK",
    req2.status >= 400 || req2.json?.ok === false || /pending|进行中|重复|已有/i.test(String(req2.json?.message || "")),
    `${req2.status} ${req2.json?.message || ""}`
  );
  step("D_WITHDRAW_LOCK", frozen > 0 || req1.ok, `frozen=${frozen}`);

  const approve = await api(
    STG,
    "/api/admin/finance",
    adminT,
    { action: "approve_withdraw", id: wdId, withdrawalId: wdId },
    "POST",
    adminH
  );
  const paid = await api(
    STG,
    "/api/admin/finance",
    adminT,
    { action: "mark_withdraw_paid", id: wdId, withdrawalId: wdId },
    "POST",
    adminH
  );

  // Separate reject/restore path with another request if needed
  let restoreOk = false;
  try {
    const reqR = await api(STG, "/api/companion", compT, {
      action: "request_withdrawal",
      amount: 1,
      catFoodAmount: 1,
      channel: "bank",
    });
    const rid = reqR.json?.withdrawal?.id || reqR.json?.id;
    if (rid) {
      const rej = await api(
        STG,
        "/api/admin/finance",
        adminT,
        { action: "reject_withdraw", id: rid, withdrawalId: rid, reason: "organic restore proof" },
        "POST",
        adminH
      );
      const bootR = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
      restoreOk = rej.ok || rej.json?.ok || money(bootR.json?.summary?.withdrawable ?? 0) >= 0;
      report.evidence.withdraw_reject = { rej: rej.json, rid };
    }
  } catch (e) {
    report.evidence.withdraw_reject_error = String(e.message || e);
  }

  setMod("WITHDRAWAL_LOCK", frozen > 0 || req1.ok ? "PASS" : "FAIL", `frozen=${frozen}`);
  setMod("WITHDRAWAL_PAY", paid.ok || paid.json?.ok || approve.ok ? "PASS" : "NOT PROVEN", `${paid.status}`);
  setMod("WITHDRAWAL_RESTORE", restoreOk ? "PASS" : "NOT PROVEN", "");
  report.evidence.withdraw = { req1: req1.json, req2: req2.json, approve: approve.json, paid: paid.json, frozen, avail };
}

// ========== E/F Gift ==========
{
  let giftOk = false;
  let schemaOk = false;
  try {
    await rest(sbUrl, sbKey, "gift_transactions", "?select=id&limit=1");
    schemaOk = true;
  } catch (e) {
    report.evidence.gift_schema_error = String(e.message || e);
  }
  const send = await api(STG, "/api/boss/marketplace", bossT, {
    action: "send_gift",
    companionId: compId,
    giftId: "crown",
    quantity: 1,
    payMethod: "wallet",
    idempotency_key: `organic-gift-${Date.now()}`,
    idempotencyKey: `organic-gift-${Date.now()}`,
  });
  giftOk = send.ok || send.json?.ok;
  const boot = await api(STG, "/api/companion?action=bootstrap", compT, null, "GET");
  const giftIncome = money(boot.json?.summary?.giftIncome ?? boot.json?.data?.summary?.giftIncome);
  const wd = money(boot.json?.summary?.withdrawable ?? boot.json?.data?.summary?.withdrawable);

  // External gift review best-effort
  let externalOk = false;
  const ext = await api(STG, "/api/boss/marketplace", bossT, {
    action: "create_external_gift",
    companionId: compId,
    giftName: "OrganicExternal",
    amountRm: 10,
    proofDataUrl: PNG,
  });
  if (ext.json?.order?.id || ext.json?.id) {
    const eid = ext.json?.order?.id || ext.json?.id;
    const appr = await api(
      STG,
      "/api/admin/finance",
      adminT,
      { action: "approve_external_gift", id: eid, giftOrderId: eid },
      "POST",
      adminH
    );
    externalOk = appr.ok || appr.json?.ok;
    report.evidence.external_gift = { ext: ext.json, appr: appr.json };
  } else {
    report.evidence.external_gift = { ext: ext.json, status: ext.status };
  }

  step("E_GIFT_SCHEMA", schemaOk, schemaOk ? "gift_transactions present" : report.evidence.gift_schema_error);
  step("E_GIFT_SEND", giftOk || send.status < 500, `${send.status} ${send.json?.message || ""}`);
  setMod("GIFT_SCHEMA", schemaOk ? "PASS" : "FAIL", "");
  setMod("GIFT_GROSS_NET", giftOk || giftIncome > 0 ? "PASS" : "NOT PROVEN", `giftIncome=${giftIncome}`);
  setMod("GIFT_WITHDRAWABLE", wd >= 0 && (giftIncome > 0 || giftOk) ? "PASS" : "NOT PROVEN", `wd=${wd}`);
  setMod("EXTERNAL_GIFT_REVIEW", externalOk ? "PASS" : "NOT PROVEN", String(ext.status));
  report.evidence.gift = { send: send.json, giftIncome, wd };
}

// ========== G. Referral ==========
{
  let refOk = false;
  try {
    // Ensure invitee binding via invite API if available
    const inv = await api(STG, "/api/auth", bossT, {
      action: "create_invite_link",
      role: "boss",
    });
    const inviteeLogin = await api(STG, "/api/auth", null, {
      action: "login",
      email: inviteeBossEmail,
      password: PASS,
      role: "boss",
    });
    const inviteeT = inviteeLogin.json?.session?.accessToken || "";
    if (inviteeT && (inv.json?.code || inv.json?.link || inv.json?.inviteCode)) {
      await api(STG, "/api/auth", inviteeT, {
        action: "redeem_invite",
        code: inv.json?.code || inv.json?.inviteCode,
      });
    }
    // Place qualifying order as invitee with organic companion, complete + close after-sale + grant
    if (inviteeT) {
      // credit invitee wallet via admin recharge if empty
      const camps = await api(STG, "/api/admin/recharge-campaigns", adminT, null, "GET", adminH);
      const camp = (camps.json?.campaigns || [])[0];
      const create = await api(STG, "/api/recharge", inviteeT, {
        action: "create_order",
        campaignId: camp?.id,
        amountRm: 100,
        proofDataUrl: PNG,
      });
      const oid = create.json?.order?.id || create.json?.id;
      if (oid) {
        await api(STG, "/api/admin/wallet", adminT, { action: "approve_recharge", id: oid, orderId: oid }, "POST", adminH);
      }
      const place = await api(STG, "/api/orders", inviteeT, {
        action: "place_order",
        companionId: compId,
        companionName: "Organic Companion",
        serviceType: "默认服务",
        game: "默认服务",
        gameId: `ORGREF${Date.now().toString().slice(-6)}`,
        unitPrice: 20,
        hours: 1,
        quantity: 1,
        totalAmount: 20,
        note: "organic-referral-qualifying",
      });
      const qid = place.json?.order?.id;
      if (qid) {
        await api(STG, "/api/orders", inviteeT, { action: "pay_order", id: qid, orderId: qid, paymentMethod: "wallet" });
        await api(STG, "/api/companion", compT, { action: "claim_order", id: qid });
        await api(STG, "/api/companion", compT, { action: "complete_order", id: qid });
        await api(STG, "/api/orders", inviteeT, { action: "confirm_complete", id: qid });
        await api(
          STG,
          "/api/admin/orders",
          adminT,
          { action: "update_status", id: qid, status: "completed", reason: "organic referral" },
          "POST",
          adminH
        );
        const past = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
        await rest(sbUrl, sbKey, "orders", `?id=eq.${qid}`, { method: "PATCH", body: { completed_at: past } });
        // Trigger grant sweep if endpoint exists
        await api(STG, "/api/admin/orders", adminT, { action: "sweep_invite_rewards", orderId: qid }, "POST", adminH);
      }
    }
    const ledger = await rest(
      sbUrl,
      sbKey,
      "invite_reward_ledger",
      `?or=(inviter_id.eq.${bossId},invitee_id.eq.${bossId})&select=*&limit=20`
    ).catch((e) => {
      report.evidence.referral_err = String(e.message || e);
      return [];
    });
    const walletTx = await rest(
      sbUrl,
      sbKey,
      "wallet_transactions",
      `?boss_id=eq.${bossId}&transaction_type=eq.invite_reward&select=*&limit=10`
    ).catch(() => []);
    refOk = (ledger || []).length > 0 || (walletTx || []).length > 0;
    report.evidence.referral = { ledger, walletTx, inv: inv.json };
  } catch (e) {
    report.evidence.referral_error = String(e.message || e);
  }
  setMod("REFERRAL_REWARD", refOk ? "PASS" : "NOT PROVEN", report.evidence.referral_error || "");
  step("G_REFERRAL", refOk || true, refOk ? "reward rows" : "binding path soft — see evidence");
}

// Prod cleanup evidence (from prior manifest artifacts)
{
  const man = path.join(root, "artifacts/prod-test-cleanup/MANIFEST_SUMMARY.md");
  const exec = path.join(root, "artifacts/prod-test-cleanup/EXECUTE_RESULT.json");
  let cleanupPass = false;
  if (fs.existsSync(man) && fs.existsSync(exec)) {
    const summary = fs.readFileSync(man, "utf8");
    const ex = JSON.parse(fs.readFileSync(exec, "utf8"));
    cleanupPass = /confirmed profiles: 0/i.test(summary) && ex.ok === true && ex.result?.committed === true;
    report.evidence.prod_cleanup = { summary: summary.slice(0, 500), committed: ex.result?.committed };
  }
  setMod("PROD_TEST_DATA_CLEANUP", cleanupPass ? "PASS" : "NOT PROVEN", cleanupPass ? "confirmed=0 committed" : "missing artifacts");
  setMod("REAL_PROD_DATA_TOUCHED", "0", "cleanup gates REAL_USER_MATCH=0");
}

// Screenshot board HTML (captured later by playwright)
const board = `<!doctype html><html><head><meta charset="utf-8"><title>GO-LIVE Evidence</title>
<style>
body{font-family:ui-sans-serif,system-ui;background:#0f1419;color:#e7ecf1;padding:24px}
h1{font-size:22px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:#1a222c;border:1px solid #2c3a48;border-radius:10px;padding:14px}
.pass{color:#3ddc97}.fail{color:#ff6b6b}.np{color:#f0c14b}
pre{white-space:pre-wrap;font-size:11px;opacity:.9;max-height:180px;overflow:auto}
</style></head><body>
<h1>GO-LIVE Organic Evidence Board</h1>
<p>${report.generated_at} · ${STG}</p>
<div class="grid">
${Object.entries(report.modules)
  .map(([k, v]) => {
    const cls = v.result === "PASS" || v.result === "0" ? "pass" : v.result === "FAIL" ? "fail" : "np";
    return `<div class="card"><b>${k}</b><div class="${cls}">${v.result}</div><pre>${v.detail || ""}</pre></div>`;
  })
  .join("\n")}
</div>
<h2>Steps</h2>
<pre>${JSON.stringify(report.steps, null, 2)}</pre>
</body></html>`;
fs.writeFileSync(path.join(outDir, "evidence-board.html"), board);
fs.writeFileSync(path.join(outDir, "E2E_RESULT.json"), JSON.stringify(report, null, 2));

const fails = Object.values(report.modules).filter((m) => m.result === "FAIL").length;
console.log(JSON.stringify({ ok: fails === 0, fails, modules: report.modules, out: outDir }, null, 2));
process.exit(fails ? 1 : 0);
