#!/usr/bin/env node
/**
 * P0 refund → 猫粮 only E2E
 * PREVIEW=http://127.0.0.1:4173 API_BASE=https://... node scripts/p0-refund-meowcoin-only-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const ROOT = process.cwd();
const BASE = String(process.env.PREVIEW || process.env.BASE_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const API_BASE = String(process.env.API_BASE || BASE).replace(/\/$/, "");
const PASS = "McjTest@12345678";
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
step("src_no_bank_required_on_confirm", !/必须填写银行参考号/.test(refundSrc.split("confirmBossCatFoodRefund")[1]?.slice(0, 2500) || ""), "no bank on confirm");
step("src_finance_action", /confirm_meowcoin_refund/.test(financeApi), "finance API action");
step("src_admin_orders_credits", /confirmBossCatFoodRefund/.test(adminOrders), "admin orders credits wallet");
step("src_finance_ui_button", /确认退款猫粮/.test(financeUi) && !/上传凭证\/打款完成/.test(financeUi), "finance UI");
step("src_cs_no_cash", /退回猫粮/.test(csUi) && !/周五打款/.test(csUi), "CS copy");
step("src_recharge_banner", /重要退款规则/.test(rechargeJs) && /不提供现金退款/.test(rechargeJs), "recharge banner");
step("src_boss_result", /退款成功/.test(ordersHtml) && /不支持提现或现金退款/.test(ordersHtml), "boss result");

const bossLogin = await api("/api/auth", null, { action: "login", role: "boss", email: "boss@meow.test", password: PASS });
const bossToken = tok(bossLogin.json);
step("auth_boss", !!bossToken, `http=${bossLogin.status}`);

const adminLogin = await api("/api/auth", null, { action: "login", role: "admin", email: "admin@meow.test", password: PASS });
const adminToken = tok(adminLogin.json);
step("auth_admin", !!adminToken, `http=${adminLogin.status}`);

// Wallet before
const walletBefore = await api("/api/recharge", bossToken, null, "GET");
const balBefore = Number(
  walletBefore.json?.summary?.balance ??
    walletBefore.json?.wallet?.totalBalance ??
    walletBefore.json?.data?.summary?.balance ??
    0
);
step("wallet_before_readable", Number.isFinite(balBefore), `balance=${balBefore}`);

// Find a refundable request or create via order request_refund on a completed order
const ordersRes = await api("/api/orders", bossToken, null, "GET");
const orders = ordersRes.json?.orders || ordersRes.json?.data?.orders || [];
let targetOrder =
  orders.find((o) => /refund_requested/i.test(String(o.status || ""))) ||
  orders.find((o) => /confirmed|in_progress|completed/i.test(String(o.status || "")) && !/refunded/i.test(String(o.status || "")));

let refundId = "";
let creditAmt = 0;

if (targetOrder && /refund_requested/i.test(String(targetOrder.status || ""))) {
  step("have_aftersale_order", true, targetOrder.id || targetOrder.orderNo);
} else if (targetOrder) {
  const reqRf = await api("/api/orders", bossToken, {
    action: "request_refund",
    id: targetOrder.id,
    reason: "p0 meowcoin refund e2e",
  });
  step("request_refund", reqRf.ok || /已提交|待审核/.test(String(reqRf.json?.message || "")), JSON.stringify(reqRf.json).slice(0, 180));
  targetOrder = reqRf.json?.order || targetOrder;
} else {
  step("have_aftersale_order", false, "no eligible boss order");
}

// List finance refunds
const fin = await api(
  "/api/admin/finance",
  adminToken,
  { action: "bootstrap" },
  "POST",
  { "x-mcj-admin-role": "super_admin" }
);
const bossRefunds = fin.json?.bossRefunds || fin.json?.data?.bossRefunds || fin.json?.refunds || [];
let refundRow =
  (bossRefunds || []).find((r) => String(r.orderId) === String(targetOrder?.id) && r.status !== "paid") ||
  (bossRefunds || []).find((r) => r.status === "pending_review" || r.status === "approved_for_payout");

if (!refundRow && targetOrder?.id) {
  // bootstrap may use different action
  const fin2 = await api("/api/admin/finance", adminToken, { action: "list" }, "POST", { "x-mcj-admin-role": "super_admin" });
  const list2 = fin2.json?.bossRefunds || [];
  refundRow = list2.find((r) => String(r.orderId) === String(targetOrder.id));
}

if (refundRow) {
  refundId = refundRow.id;
  creditAmt = Number(refundRow.amountCatFood != null ? refundRow.amountCatFood : refundRow.amountRm || 0) || 1;
  step("found_refund_row", true, `${refundId} amt=${creditAmt} status=${refundRow.status}`);
} else {
  step("found_refund_row", false, `finKeys=${Object.keys(fin.json || {}).slice(0, 12).join(",")}`);
}

// Confirm meowcoin refund (requires deployed API)
let confirm = { ok: false, json: {}, status: 0 };
if (refundId) {
  confirm = await api(
    "/api/admin/finance",
    adminToken,
    { action: "confirm_meowcoin_refund", id: refundId, amount: creditAmt, reason: "p0 e2e confirm meowcoin" },
    "POST",
    { "x-mcj-admin-role": "super_admin" }
  );
  const deployed =
    confirm.ok ||
    /已确认|已退款|猫粮/.test(String(confirm.json?.message || "")) ||
    confirm.json?.refund?.status === "paid";
  const unknown =
    /未知|unknown|not found|不支持|无效操作/i.test(String(confirm.json?.message || "")) ||
    (confirm.status === 400 && /银行参考号|打款凭证/.test(String(confirm.json?.message || "")));
  step(
    "PASS_confirm_meowcoin_api",
    deployed,
    JSON.stringify({ http: confirm.status, message: confirm.json?.message, duplicate: confirm.json?.duplicate, unknown }).slice(0, 280)
  );

  // Idempotent second call
  const confirm2 = await api(
    "/api/admin/finance",
    adminToken,
    { action: "confirm_meowcoin_refund", id: refundId, amount: creditAmt, reason: "p0 e2e duplicate" },
    "POST",
    { "x-mcj-admin-role": "super_admin" }
  );
  step(
    "PASS_idempotent",
    confirm2.json?.duplicate === true ||
      confirm2.json?.alreadyRefunded === true ||
      /幂等|已退款/.test(String(confirm2.json?.message || "")),
    JSON.stringify({ http: confirm2.status, message: confirm2.json?.message, duplicate: confirm2.json?.duplicate }).slice(0, 220)
  );
} else {
  step("PASS_confirm_meowcoin_api", false, "no refund row");
  step("PASS_idempotent", false, "skipped");
}

const walletAfter = await api("/api/recharge", bossToken, null, "GET");
const balAfter = Number(
  walletAfter.json?.summary?.balance ??
    walletAfter.json?.wallet?.totalBalance ??
    walletAfter.json?.data?.summary?.balance ??
    0
);
const expected = balBefore + creditAmt;
const balanceOk = confirm.ok && creditAmt > 0 && Math.abs(balAfter - expected) < 0.011;
step(
  "PASS_balance_A_plus_xx",
  balanceOk,
  JSON.stringify({ balBefore, creditAmt, balAfter, expected, confirmOk: confirm.ok })
);

// Ledger check
const txs = walletAfter.json?.transactions || walletAfter.json?.ledger || walletAfter.json?.summary?.transactions || [];
const refundTx = (Array.isArray(txs) ? txs : []).find(
  (t) => /refund|退款/i.test(String(t.type || t.transaction_type || t.typeText || "")) && Number(t.amount || t.signedAmount || 0) > 0
);
step(
  "PASS_ledger_refund_tx",
  !!refundTx || (confirm.ok && /订单退款/.test(JSON.stringify(walletAfter.json || {}).slice(0, 4000))),
  refundTx ? JSON.stringify(refundTx).slice(0, 180) : `txCount=${Array.isArray(txs) ? txs.length : 0}`
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
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ base: BASE, api: API_BASE, results, balBefore, balAfter, creditAmt }, null, 2));
const failed = results.filter((r) => r.result === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
