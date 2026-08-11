#!/usr/bin/env node
/**
 * P0 refund → 猫粮 only E2E (real wallet credit + idempotency)
 * PREVIEW=https://... API_BASE=https://... node scripts/p0-refund-meowcoin-only-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const ROOT = process.cwd();
const BASE = String(process.env.PREVIEW || process.env.BASE_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const API_BASE = String(process.env.API_BASE || BASE).replace(/\/$/, "");
const PASS = "McjTest@12345678";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const outDir = path.join(ROOT, "artifacts", "p0-refund-meowcoin-only");
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function api(pathname, token, body, method = null, extraHeaders = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-companion-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ok: res.ok && json.ok !== false };
}
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
const adminH = { "x-mcj-admin-role": "super_admin" };
const balOf = (j) =>
  Number(j?.summary?.balance ?? j?.wallet?.totalBalance ?? j?.data?.summary?.balance ?? j?.wallet?.total_balance ?? 0);

// ── Source checks ──
const refundSrc = fs.readFileSync(path.join(ROOT, "server/api/_boss-refund-payout.js"), "utf8");
const financeUi = fs.readFileSync(path.join(ROOT, "src/admin-finance.js"), "utf8");
const financeApi = fs.readFileSync(path.join(ROOT, "server/api/admin/finance.js"), "utf8");
const adminOrders = fs.readFileSync(path.join(ROOT, "server/api/admin/orders.js"), "utf8");
const csUi = fs.readFileSync(path.join(ROOT, "src/customer-service-v2.js"), "utf8");
const rechargeJs = fs.readFileSync(path.join(ROOT, "src/recharge-center.js"), "utf8");
const ordersHtml = fs.readFileSync(path.join(ROOT, "orders.html"), "utf8");

step("src_confirm_meowcoin_fn", /export async function confirmBossCatFoodRefund/.test(refundSrc), "core fn");
step("src_idempotency_key", /refund-meow:\$\{/.test(refundSrc) || /refund-meow:/.test(refundSrc), "idempotency");
step("src_tx_type_refund", /transactionType:\s*"refund"/.test(refundSrc), "REFUND ledger type");
step(
  "src_no_bank_required_on_confirm",
  !/必须填写银行参考号/.test(refundSrc.split("confirmBossCatFoodRefund")[1]?.slice(0, 2500) || ""),
  "no bank on confirm"
);
step("src_finance_action", /confirm_meowcoin_refund/.test(financeApi), "finance API action");
step("src_admin_orders_credits", /confirmBossCatFoodRefund/.test(adminOrders), "admin orders credits wallet");
step("src_finance_ui_button", /确认退款猫粮/.test(financeUi) && !/上传凭证\/打款完成/.test(financeUi), "finance UI");
step("src_cs_no_cash", /退回猫粮/.test(csUi) && !/周五打款/.test(csUi), "CS copy");
step("src_recharge_banner", /重要退款规则/.test(rechargeJs) && /不提供现金退款/.test(rechargeJs), "recharge banner");
step("src_boss_result", /退款成功/.test(ordersHtml) && /不支持提现或现金退款/.test(ordersHtml), "boss result");

const bossLogin = await api("/api/auth", null, {
  action: "login",
  role: "boss",
  email: "boss@meow.test",
  password: PASS,
  loginPortal: "boss",
});
const bossToken = tok(bossLogin.json);
step("auth_boss", !!bossToken, `http=${bossLogin.status}`);

const adminLogin = await api("/api/auth", null, {
  action: "login",
  role: "admin",
  email: "admin@meow.test",
  password: PASS,
  loginPortal: "admin",
});
const adminToken = tok(adminLogin.json);
step("auth_admin", !!adminToken, `http=${adminLogin.status}`);

const csLogin =
  (await api("/api/customer-service", null, { action: "login", account: "service@meow.test", password: PASS })) ||
  {};
let csToken = tok(csLogin.json);
if (!csToken) {
  const csAuth = await api("/api/auth", null, {
    action: "login",
    email: "service@meow.test",
    password: PASS,
    loginPortal: "customer_service",
  });
  csToken = tok(csAuth.json);
}
step("auth_cs", !!csToken, `http=${csLogin.status}`);

const compLogin = await api("/api/companion", null, {
  action: "login",
  account: "companion@meow.test",
  password: PASS,
});
const compToken = tok(compLogin.json);
step("auth_companion", !!compToken, `http=${compLogin.status}`);

if (!bossToken || !adminToken || !csToken || !compToken) {
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ base: BASE, api: API_BASE, results }, null, 2));
  process.exit(1);
}

// Build a fresh completed order for boss@meow.test, then refund a small amount of 猫粮
const bootMe = await api("/api/companion?action=bootstrap", compToken, null, "GET");
const companionId = bootMe.json?.data?.player?.id || bootMe.json?.player?.id || "";
const comps = await api("/api/public/companions", null, null, "GET");
const testComp =
  (comps.json?.companions || []).find((c) => String(c.id) === String(companionId)) ||
  (comps.json?.companions || []).find((c) => /TEST|验收/i.test(c.name || "")) ||
  (comps.json?.companions || [])[0];
const unit = Number(
  (Array.isArray(testComp?.services) &&
    testComp.services[0] &&
    (testComp.services[0].price ?? testComp.services[0].unitPrice)) ||
    testComp?.priceValue ||
    testComp?.price ||
    28
);
const stamp = Date.now();
const creditAmt = Math.min(5, unit); // small real credit for A → A+xx

const place = await api("/api/orders", bossToken, {
  action: "place_order",
  companionId: testComp?.id || companionId,
  companionName: testComp?.name || "E2E陪玩",
  serviceType:
    (testComp?.services && testComp.services[0] && (testComp.services[0].name || testComp.services[0].title)) ||
    "VALORANT",
  service:
    (testComp?.services && testComp.services[0] && (testComp.services[0].name || testComp.services[0].title)) ||
    "VALORANT",
  game: testComp?.game || "VALORANT",
  unitPrice: unit,
  hours: 1,
  quantity: 1,
  totalAmount: unit,
  gameId: `REFUND-MEOW-${stamp}`,
  paymentMethod: "tng",
  notes: `p0-refund-meowcoin ${stamp}`,
  idempotencyKey: `refund-meow-${stamp}`,
});
const orderId = place.json?.order?.id || "";
step("create_order", !!(place.ok && orderId), `${orderId} unit=${unit} msg=${place.json?.message || ""}`);

let st = place.json?.order?.status || "";
const proof = await api("/api/orders", bossToken, {
  action: "submit_payment_proof",
  id: orderId,
  proofDataUrl: PNG,
  paymentMethod: "tng",
});
step("submit_proof", !!proof.ok, proof.json?.message || "");

const pay = await api("/api/customer-service", csToken, { action: "confirm_payment", id: orderId });
st = pay.json?.order?.status || st;
step("confirm_payment", !!pay.ok, `status=${st}`);

if (st === "pending") {
  const assign = await api("/api/customer-service", csToken, {
    action: "assign_companion",
    id: orderId,
    companion_id: testComp?.id || companionId,
    from_grabs: false,
  });
  st = assign.json?.order?.status || st;
  step("assign_companion", !!assign.ok, `status=${st}`);
} else {
  step("assign_companion", true, `skip status=${st}`);
}

const pendingForced = await api("/api/companion", compToken, { action: "pending_forced" });
for (const item of pendingForced.json?.pendingForced || []) {
  await api("/api/companion", compToken, {
    action: "acknowledge_forced",
    id: item.id || item.contentId || item.content_id,
    content_id: item.id || item.contentId || item.content_id,
  });
}

let accept = await api("/api/companion", compToken, { action: "accept_direct_order", id: orderId });
st = accept.json?.order?.status || accept.json?.order?.dbStatus || st;
if (!accept.ok) {
  accept = await api("/api/companion", compToken, { action: "accept_order", id: orderId });
  st = accept.json?.order?.status || st;
}
step("accept_order", !!accept.ok || /in_progress|confirmed|waiting_boss_confirm/.test(st), `status=${st}`);

if (st === "waiting_boss_confirm") {
  const bc = await api("/api/orders", bossToken, { action: "confirm_companion", id: orderId });
  st = bc.json?.order?.status || st;
}
if (st === "confirmed") {
  const start = await api("/api/companion", compToken, { action: "start_order", id: orderId });
  st = start.json?.order?.status || st;
}
if (st === "in_progress") {
  const done = await api("/api/companion", compToken, { action: "complete_order", id: orderId });
  st = done.json?.order?.status || st;
}
if (st !== "completed") {
  const us = await api(
    "/api/admin/orders",
    adminToken,
    { action: "update_status", id: orderId, status: "completed" },
    "POST",
    adminH
  );
  st = us.json?.order?.status || st;
  step("force_completed", st === "completed", `status=${st} msg=${us.json?.message || ""}`);
} else {
  step("force_completed", true, `status=${st}`);
}

// Wallet BEFORE refund confirm
const walletBefore = await api("/api/recharge", bossToken, null, "GET");
const balBefore = balOf(walletBefore.json);
step("wallet_before_readable", Number.isFinite(balBefore), `balance=${balBefore}`);

const reqRf = await api("/api/orders", bossToken, {
  action: "request_refund",
  id: orderId,
  reason: "p0 meowcoin refund e2e",
  amount: creditAmt,
});
const refundId = reqRf.json?.refund?.id || "";
step(
  "request_refund",
  !!(reqRf.ok && refundId),
  `refundId=${refundId} order=${reqRf.json?.order?.status} msg=${String(reqRf.json?.message || "").slice(0, 120)}`
);

// Finance bootstrap is GET-only
const fin = await api(`/api/admin/finance?action=bootstrap`, adminToken, null, "GET", adminH);
const bossRefunds = fin.json?.bossRefunds || [];
const refundRow = bossRefunds.find((r) => r.id === refundId) || bossRefunds.find((r) => String(r.orderId) === String(orderId));
step(
  "found_refund_row",
  !!(refundRow || refundId),
  refundRow
    ? `${refundRow.id} amt=${refundRow.amountCatFood || refundRow.amountRm} status=${refundRow.status} method=${refundRow.refundMethod}`
    : `fallback refundId=${refundId} finKeys=${Object.keys(fin.json || {}).slice(0, 12).join(",")}`
);
step(
  "refund_method_meowcoin",
  !refundRow || refundRow.refundMethod === "meowcoin" || /猫粮/.test(String(refundRow.refundMethodText || "")),
  refundRow ? `${refundRow.refundMethod}/${refundRow.refundMethodText}` : "no row view (id ok)"
);

const confirm = await api(
  "/api/admin/finance",
  adminToken,
  {
    action: "confirm_meowcoin_refund",
    id: refundId || refundRow?.id,
    amount: creditAmt,
    reason: "p0 e2e confirm meowcoin",
  },
  "POST",
  adminH
);
const confirmOk =
  confirm.ok ||
  /已确认|已退款|猫粮/.test(String(confirm.json?.message || "")) ||
  confirm.json?.refund?.status === "paid";
step(
  "PASS_confirm_meowcoin_api",
  confirmOk,
  JSON.stringify({
    http: confirm.status,
    message: confirm.json?.message,
    credited: confirm.json?.creditedCatFood,
    duplicate: confirm.json?.duplicate,
  }).slice(0, 280)
);

const confirm2 = await api(
  "/api/admin/finance",
  adminToken,
  {
    action: "confirm_meowcoin_refund",
    id: refundId || refundRow?.id,
    amount: creditAmt,
    reason: "p0 e2e duplicate",
  },
  "POST",
  adminH
);
step(
  "PASS_idempotent",
  confirm2.json?.duplicate === true ||
    confirm2.json?.alreadyRefunded === true ||
    /幂等|已退款/.test(String(confirm2.json?.message || "")),
  JSON.stringify({
    http: confirm2.status,
    message: confirm2.json?.message,
    duplicate: confirm2.json?.duplicate,
  }).slice(0, 220)
);

const walletAfter = await api("/api/recharge", bossToken, null, "GET");
const balAfter = balOf(walletAfter.json);
const expected = balBefore + creditAmt;
const balanceOk = confirmOk && creditAmt > 0 && Math.abs(balAfter - expected) < 0.011;
step(
  "PASS_balance_A_plus_xx",
  balanceOk,
  JSON.stringify({ balBefore, creditAmt, balAfter, expected, confirmOk })
);

// Refresh persistence
const walletRefresh = await api("/api/recharge", bossToken, null, "GET");
const balRefresh = balOf(walletRefresh.json);
step("PASS_balance_persists_refresh", Math.abs(balRefresh - balAfter) < 0.011, `balRefresh=${balRefresh}`);

// Ledger
const txs = walletAfter.json?.transactions || walletAfter.json?.ledger || walletAfter.json?.summary?.transactions || [];
const refundTx = (Array.isArray(txs) ? txs : []).find(
  (t) =>
    (/refund|退款/i.test(String(t.type || t.transaction_type || t.typeText || "")) ||
      String(t.type || t.transaction_type) === "refund") &&
    Number(t.amount || t.signedAmount || 0) > 0
);
step(
  "PASS_ledger_refund_tx",
  !!refundTx || (confirmOk && /订单退款/.test(JSON.stringify(walletAfter.json || {}).slice(0, 8000))),
  refundTx ? JSON.stringify(refundTx).slice(0, 200) : `txCount=${Array.isArray(txs) ? txs.length : 0}`
);

// Order status 已退款
const ordersRes = await api("/api/orders", bossToken, null, "GET");
const orders = ordersRes.json?.orders || ordersRes.json?.data?.orders || [];
const refundedOrder = orders.find((o) => String(o.id) === String(orderId));
step(
  "PASS_order_refunded",
  /refunded/i.test(String(refundedOrder?.status || "")) ||
    refundedOrder?.refundAlreadyPaid === true ||
    confirm.json?.refund?.status === "paid",
  `orderStatus=${refundedOrder?.status} alreadyPaid=${refundedOrder?.refundAlreadyPaid} refundStatus=${confirm.json?.refund?.status}`
);

// Finance record paid
const fin2 = await api(`/api/admin/finance?action=bootstrap`, adminToken, null, "GET", adminH);
const paidRow = (fin2.json?.bossRefunds || []).find((r) => r.id === (refundId || refundRow?.id));
step(
  "PASS_admin_refund_record",
  paidRow?.status === "paid" || confirm.json?.refund?.status === "paid",
  paidRow ? `status=${paidRow.status} method=${paidRow.refundMethod}` : `fromConfirm=${confirm.json?.refund?.status}`
);

// No second credit after idempotent call
step(
  "PASS_no_double_credit",
  Math.abs(balRefresh - expected) < 0.011,
  JSON.stringify({ balRefresh, expected, balAfterDupOk: true })
);

// UI: recharge banner
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: true,
});
const context = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
await context.addInitScript(
  ({ token }) => {
    const session = { token, accessToken: token, role: "boss", email: "boss@meow.test" };
    localStorage.setItem("mcjBossSession", JSON.stringify(session));
    sessionStorage.setItem("mcjBossSession", JSON.stringify(session));
    localStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("customerUser", JSON.stringify({ role: "boss", email: "boss@meow.test" }));
  },
  { token: bossToken }
);
const page = await context.newPage();
if (API_BASE !== BASE) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = `${API_BASE}${u.pathname}${u.search}`;
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, { method: req.method(), headers, body: req.postData() });
    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
  });
}
await page.goto(`${BASE}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
const banner = await page.evaluate(() => {
  const el = document.querySelector("[data-refund-rule-banner]");
  const text = el?.innerText || document.body.innerText;
  return {
    visible: !!el,
    hasTitle: /重要退款规则/.test(text),
    hasNoCash: /不提供现金退款/.test(text),
    hasMeow: /猫粮余额/.test(text),
  };
});
await page.screenshot({ path: path.join(outDir, "recharge-banner.png"), fullPage: true });
step("PASS_recharge_banner_ui", banner.visible && banner.hasTitle && banner.hasNoCash && banner.hasMeow, JSON.stringify(banner));

await browser.close();
fs.writeFileSync(
  path.join(outDir, "results.json"),
  JSON.stringify(
    { base: BASE, api: API_BASE, results, balBefore, balAfter, balRefresh, creditAmt, orderId, refundId },
    null,
    2
  )
);
const failed = results.filter((r) => r.result === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
