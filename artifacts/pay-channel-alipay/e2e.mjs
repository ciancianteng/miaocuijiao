#!/usr/bin/env node
/**
 * Staging E2E: admin「新增收款渠道」支付宝 → admin channel list → boss recharge → boss order pay (支付宝) → payment info.
 *   node artifacts/pay-channel-alipay/e2e.mjs
 * Test data is marked STAGING-TEST; boss is boss@meow.test (test party, never settles).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "pay-channel-alipay-e2e", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
const build = await fetch(`${STG}/api/build-info`).then((r) => r.json());
if (!build.supabaseIsStaging || build.supabaseIsProduction) throw new Error(`not staging DB: ${JSON.stringify(build)}`);

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = "admin@meow.test";
const BOSS = "boss@meow.test";
const ACCOUNT_NAME = "STAGING-TEST 妙脆角";
const ACCOUNT_NO = "alipay-test-13800138000";
const shot = (n) => path.join(here, `${n}.png`);
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
};
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
async function api(p, token, body, method = "POST") {
  const res = await fetch(`${STG}${p}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" })).json);
const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS })).json);
if (!adminT || !bossT) throw new Error("login failed");

// Clean previous STAGING-TEST rows so the run is repeatable.
const before = await api("/api/admin/payment-settings", adminT, null, "GET");
for (const b of before.json.banks || []) {
  if (String(b.account_name || "").startsWith("STAGING-TEST")) await api("/api/admin/payment-settings", adminT, { action: "delete_bank", id: b.id });
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const report = { at: new Date().toISOString(), staging: STG, deployment: build.url, results };
try {
  // ---------- Admin: add 支付宝 via「新增收款渠道」 ----------
  const actx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const ap = await actx.newPage();
  ap.on("dialog", (d) => d.accept().catch(() => {}));
  await ap.goto(`${STG}/admin/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ap.locator('[data-admin-login] input[name="account"]').fill(ADMIN);
  await ap.locator('[data-admin-login] input[name="password"]').fill(PASS);
  await ap.locator('[data-admin-login] button[type="submit"]').click();
  await ap.waitForURL(/\/admin\/?(#.*)?$|admin\.html/, { timeout: 60000 });
  await ap.goto(`${STG}/admin/#payment`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ap.waitForSelector("#paymentSettings [data-pay-tab]", { timeout: 60000 });
  await ap.locator('[data-pay-tab="banks"]').click();
  await ap.locator("[data-bank-new]").click();
  const form = ap.locator("[data-bank-form]");
  await form.locator('select[name="provider"]').selectOption("支付宝");
  await form.locator('input[name="accountName"]').fill(ACCOUNT_NAME);
  await form.locator('input[name="accountNumber"]').fill(ACCOUNT_NO);
  await form.locator('textarea[name="instructions"]').fill("STAGING-TEST：请用支付宝扫码付款，付款后上传截图。");

  const qrPage = await browser.newPage({ viewport: { width: 360, height: 360 } });
  await qrPage.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:360px;background:#1677ff;font-family:sans-serif">
    <div style="background:#fff;border-radius:18px;padding:22px;text-align:center;width:250px">
      <div style="font-size:24px;font-weight:800;color:#1677ff">支付宝 收款码</div>
      <div style="margin:14px auto;width:150px;height:150px;background:repeating-conic-gradient(#000 0 25%,#fff 0 50%) 0 0/30px 30px"></div>
      <div style="font-size:13px;color:#333">STAGING-TEST 妙脆角</div></div></body>`);
  const qrBuf = await qrPage.screenshot({ type: "png" });
  await qrPage.close();
  await form.locator("input[data-bank-qr-upload]").setInputFiles({ name: "alipay-qr.png", mimeType: "image/png", buffer: qrBuf });
  await ap.waitForFunction(() => {
    const el = document.querySelector('[data-bank-form] input[name="qrImagePath"]');
    return el && el.value;
  }, null, { timeout: 60000 });
  await ap.screenshot({ path: shot("01-admin-new-alipay-form"), fullPage: true });
  await form.locator('button[type="submit"]').click();
  await ap.waitForFunction(() => !document.querySelector("[data-bank-form]") && document.querySelector(".payment-channel-card"), null, { timeout: 60000 });
  await ap.waitForTimeout(800);
  await ap.screenshot({ path: shot("02-admin-banks-tab-alipay"), fullPage: true });

  const st = await api("/api/admin/payment-settings", adminT, null, "GET");
  const bank = (st.json.banks || []).find((b) => b.account_name === ACCOUNT_NAME);
  const code = bank ? `acct-${String(bank.id).toLowerCase()}` : "";
  step("admin_bank_saved", !!bank, bank ? `${bank.id} ${bank.bank_name} qr=${!!bank.qrImageUrl}` : "missing");
  step("admin_boss_order_visible", (st.json.bossOrderMethods || []).includes(code), JSON.stringify(st.json.bossOrderMethods));
  step("admin_boss_recharge_visible", (st.json.bossRechargeMethods || []).includes(code), JSON.stringify(st.json.bossRechargeMethods));

  await ap.locator('[data-pay-tab="channels"]').click();
  await ap.waitForTimeout(800);
  const card = ap.locator(".payment-channel-card", { hasText: "支付宝" });
  const cardText = (await card.first().innerText().catch(() => "")).replace(/\s+/g, " ");
  step("admin_channel_list_shows_alipay", /支付宝/.test(cardText) && /订单可见/.test(cardText) && /充值可见/.test(cardText), cardText);
  await card.first().scrollIntoViewIfNeeded().catch(() => {});
  await ap.screenshot({ path: shot("03-admin-channel-list-alipay"), fullPage: true });
  await actx.close();

  // ---------- Boss API: recharge + order methods ----------
  const rc = await api("/api/recharge", bossT, null, "GET");
  const orderPay = (rc.json.orderPayMethods || []).find((m) => m.code === code);
  const rechargePay = (rc.json.methods || []).find((m) => m.code === code && m.open);
  step("boss_recharge_method", !!rechargePay, rechargePay ? rechargePay.name : JSON.stringify((rc.json.methods || []).map((m) => m.code)));
  step("boss_order_method", !!orderPay, orderPay ? `${orderPay.label} qr=${!!orderPay.payInfo?.qrUrl}` : JSON.stringify((rc.json.orderPayMethods || []).map((m) => m.code)));

  // ---------- Boss UI ----------
  const bctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-CN" });
  await bctx.addInitScript((t) => {
    localStorage.setItem("mcjAuthAccessToken", t);
    localStorage.setItem("mcj_webpush_dismiss_until", String(Date.now() + 72 * 3600 * 1000));
    localStorage.setItem("mcj_webpush_first_prompted", "1");
    localStorage.setItem("mcjPwaInstallDismissed", "1");
  }, bossT);
  const bp = await bctx.newPage();
  bp.setDefaultTimeout(45000);

  await bp.goto(`${STG}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await bp.waitForTimeout(3500);
  const rechargeText = await bp.locator("body").innerText();
  step("boss_recharge_ui_alipay", /支付宝/.test(rechargeText), "");
  await bp.getByText(/支付宝 · STAGING-TEST/).first().scrollIntoViewIfNeeded().catch(() => {});
  await bp.waitForTimeout(500);
  await bp.screenshot({ path: shot("04-boss-recharge-alipay") });

  const net = [];
  bp.on("response", async (r) => {
    if (!/\/api\/orders/.test(r.url()) || r.request().method() !== "POST") return;
    let req = {};
    try { req = JSON.parse(r.request().postData() || "{}"); } catch {}
    const body = await r.json().catch(() => ({}));
    net.push({ action: req.action, status: r.status(), ok: body.ok, message: body.message, id: body.order?.id, orderNo: body.order?.orderNo, paymentMethod: body.order?.paymentMethod });
  });
  await bp.goto(`${STG}/custom-order.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await bp.waitForSelector(`[data-custom-pay="${code}"]`, { timeout: 45000 });
  const f = bp.locator("#customOrderForm");
  await f.locator('[name="title"]').fill("[STAGING-TEST] 支付宝下单验收");
  await f.locator('[name="game"]').fill("VALORANT");
  await f.locator('[name="game_id"]').fill(`ALIPAY-${Date.now()}`);
  await f.locator('[name="scheduled_at"]').evaluate((el) => {
    el.value = "2026-10-07T20:00";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await f.locator('[name="requirements"]').fill("STAGING-TEST 支付宝付款验收（测试数据，请勿接单）");
  await bp.locator(`[data-custom-pay="${code}"]`).click();
  await bp.waitForTimeout(400);
  const payBtns = await bp.locator("[data-custom-pay]").allInnerTexts();
  step("boss_order_ui_alipay_selectable", payBtns.some((t) => /支付宝/.test(t)), payBtns.join(" | "));
  await bp.locator(`[data-custom-pay="${code}"]`).scrollIntoViewIfNeeded();
  await bp.screenshot({ path: shot("05-boss-order-select-alipay"), fullPage: true });

  await bp.locator("#customSubmit").click();
  await bp.waitForURL(/payment-confirm\.html/, { timeout: 45000 });
  const created = net.find((n) => n.action === "create" || n.action === "place_order") || {};
  step("boss_order_created_with_alipay", created.ok !== false && String(created.paymentMethod || "") === code, JSON.stringify(created));
  await bp.waitForSelector("[data-pay-qr]", { timeout: 45000 });
  await bp.waitForTimeout(2500);
  const qr = bp.locator("[data-pay-qr]");
  const qrText = (await qr.innerText()).replace(/\s+/g, " ");
  const hasQr = (await qr.getAttribute("data-pay-has-qr")) === "1";
  const imgOk = await bp.locator("[data-pay-qr] img").first().evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  step("payment_page_alipay_info", hasQr && imgOk && /支付宝/.test(qrText) && qrText.includes(ACCOUNT_NO), qrText.slice(0, 300));
  const proofPanel = await bp.locator("[data-proof-panel]").count();
  step("payment_page_proof_upload_available", proofPanel > 0, `proofPanel=${proofPanel}`);
  const summaryText = (await bp.locator("body").innerText()).replace(/\s+/g, " ");
  step("payment_page_method_label_no_raw_code", !/支付方式 acct-/.test(summaryText), (summaryText.match(/支付方式 \S+/) || [""])[0]);
  await bp.screenshot({ path: shot("06-boss-payment-alipay-info"), fullPage: true });

  // Payment info must stay bound to the order's own channel (no DuitNow fallback).
  const detail = await api(`/api/orders?id=${encodeURIComponent(created.id || "")}`, bossT, null, "GET");
  const ppi = detail.json.platformPayInfo || {};
  step("server_pay_info_bound_to_alipay", ppi.channelId === code && ppi.bankName === "支付宝", `${ppi.channelId} ${ppi.bankName} ${ppi.title}`);

  if (created.id) {
    const c = await api("/api/orders", bossT, { action: "cancel_order", id: created.id, reason: "STAGING-TEST cleanup" });
    step("cleanup_cancel_test_order", c.json.ok !== false, `${created.orderNo} ${c.status} ${c.json.message || ""}`);
    report.testOrder = { id: created.id, orderNo: created.orderNo, cancelled: c.json.ok !== false };
  }
  report.bank = bank ? { id: bank.id, code, bank_name: bank.bank_name, account_name: bank.account_name, kept: true } : null;
  await bctx.close();
} catch (err) {
  step("fatal", false, err.stack || err.message);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(here, "report.json"), JSON.stringify(report, null, 2));
  const fail = results.filter((r) => r.result !== "PASS").length;
  console.log(`\nTOTAL ${results.length} PASS ${results.length - fail} FAIL ${fail}`);
  process.exitCode = fail ? 1 : 0;
}
