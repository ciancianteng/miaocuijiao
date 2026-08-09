/**
 * Staging E2E: admin enable/disable payment channels → boss order modal shows/hides → select → pay next step.
 * Usage: PREVIEW=https://... node scripts/p0-order-pay-methods-enable-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ART = path.join(ROOT, "artifacts", "order-pay-methods-enable-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tokenOf(login) {
  return login.json?.session?.accessToken || login.json?.session?.token || login.json?.accessToken || login.json?.token || "";
}

async function toggleChannel(adminToken, id, enabled) {
  return api(
    "/api/admin/payment-settings",
    adminToken,
    { action: "toggle_channel", channelId: id, enabled },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}

async function saveChannelScopes(adminToken, channel, forOrder, forRecharge) {
  const data = { ...(channel.data || {}), forOrder, forRecharge };
  return api(
    "/api/admin/payment-settings",
    adminToken,
    {
      action: "save_channel",
      channel: {
        ...channel,
        data,
        enabled: channel.enabled,
        visible: channel.visible ?? channel.enabled,
      },
    },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}

async function injectBoss(context, token) {
  await context.addInitScript(
    ({ token }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerAuthToken", token);
      const user = { role: "boss", email: "boss@meow.test", name: "Boss", nickname: "Boss" };
      localStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("bossUser", JSON.stringify(user));
      localStorage.setItem("mcjRole", "boss");
    },
    { token }
  );
}

async function readOrderPayLabels(page) {
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const empty = document.querySelector("[data-po-pay-grid]")?.textContent || "";
    const nodes = [...document.querySelectorAll("[data-po-pay]")];
    return {
      emptyText: empty.replace(/\s+/g, " ").trim(),
      labels: nodes.map((n) => ({
        id: n.getAttribute("data-po-pay") || "",
        text: (n.textContent || "").replace(/\s+/g, " ").trim(),
      })),
      sotVersion: window.MCJ_PAY_SOT_VERSION || "",
    };
  });
}

async function openOrderModal(page) {
  await page.goto(`${BASE}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  // Prefer hall order buttons; fallback to profile path.
  const hallBtn = page.locator("[data-hall-order]").first();
  if ((await hallBtn.count()) > 0) {
    await hallBtn.click({ timeout: 20000 });
  } else {
    const card = page.locator("a[href*='profile.html'], .companion-card a").first();
    await card.click({ timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.locator("button:has-text('立即下单'), [data-open-order]").first().click({ timeout: 20000 });
  }
  await page.waitForSelector("[data-mcj-po-mask] .mcj-po-dialog, .mcj-po-mask .mcj-po-dialog", { timeout: 25000 });
  await page.waitForTimeout(2000);
}

async function fillAndSubmitOrder(page, methodId) {
  const payBtn = page.locator(`[data-po-pay="${methodId}"]`).first();
  if ((await payBtn.count()) === 0) throw new Error(`missing pay method ${methodId}`);
  await payBtn.click();
  await page.fill("[data-po-game-id]", `E2E-PAY-${Date.now()}`);
  const schedule = page.locator("[data-po-schedule]");
  if ((await schedule.count()) > 0) await schedule.fill("今晚 21:00");
  const contact = page.locator("[data-po-contact]");
  if ((await contact.count()) > 0) await contact.fill("e2e@meow.test");
  // Ensure a service chip is selected if present.
  const svc = page.locator("[data-po-service]").first();
  if ((await svc.count()) > 0) await svc.click();
  await page.click("[data-po-submit]");
  await page.waitForTimeout(3500);
  const url = page.url();
  const onPay =
    /payment-confirm\.html|order-confirm\.html|orders\.html/i.test(url) ||
    (await page.locator("text=我已付款").count()) > 0 ||
    (await page.locator("[data-pay-upload], .pay-hint, input[type='file']").count()) > 0;
  return { url, onPay };
}

async function main() {
  let failed = 0;
  const adminLogin = await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: PASS });
  const bossLogin = await api("/api/auth", null, { action: "login", email: "boss@meow.test", password: PASS });
  const adminToken = tokenOf(adminLogin);
  const bossToken = tokenOf(bossLogin);
  if (!step("admin login", !!adminToken, adminLogin.status)) failed++;
  if (!step("boss login", !!bossToken, bossLogin.status)) failed++;

  const chRes = await api("/api/admin/payment-settings", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
  const channels = chRes.json?.channels || [];
  const duit = channels.find((c) => (c.channel_id || c.id) === "duitnow");
  const tng = channels.find((c) => (c.channel_id || c.id) === "tng");
  if (!step("channels loaded", !!(duit && tng), `duit=${!!duit} tng=${!!tng}`)) failed++;

  // Ensure scopes both true, then enable both.
  if (duit) await saveChannelScopes(adminToken, duit, true, true);
  if (tng) await saveChannelScopes(adminToken, tng, true, true);
  await toggleChannel(adminToken, "duitnow", true);
  await toggleChannel(adminToken, "tng", true);

  let recharge = await api("/api/recharge", bossToken);
  const orderCodes = (recharge.json?.orderPayMethods || []).map((m) => m.code || m.id);
  const rechargeCodes = (recharge.json?.methods || []).map((m) => m.code);
  step(
    "API orderPayMethods after enable",
    orderCodes.includes("duitnow") && orderCodes.includes("tng"),
    JSON.stringify(orderCodes)
  ) || failed++;
  step(
    "API recharge methods after enable",
    rechargeCodes.includes("duitnow") && rechargeCodes.includes("tng"),
    JSON.stringify(rechargeCodes)
  ) || failed++;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await injectBoss(context, bossToken);
  const page = await context.newPage();

  try {
    await openOrderModal(page);
    await page.screenshot({ path: path.join(ART, "01-enabled-order-modal.png"), fullPage: true });
    let pay = await readOrderPayLabels(page);
    const ids = pay.labels.map((x) => x.id);
    step("UI shows DuitNow+TNG when enabled", ids.includes("duitnow") && ids.includes("tng"), JSON.stringify(pay)) ||
      failed++;
    step("UI not empty message", !/暂无可用支付方式/.test(pay.emptyText) || ids.length > 0, pay.emptyText) || failed++;

    // Select TNG and submit to payment next step.
    const payNext = await fillAndSubmitOrder(page, "tng");
    await page.screenshot({ path: path.join(ART, "02-after-confirm-pay.png"), fullPage: true });
    step("confirm pay enters next step", payNext.onPay, payNext.url) || failed++;

    // Disable both external channels — order should hide them (catfood may remain).
    await toggleChannel(adminToken, "duitnow", false);
    await toggleChannel(adminToken, "tng", false);
    // Fresh page for disable check (avoid stale modal / mid-pay redirect).
    const page2 = await context.newPage();
    await openOrderModal(page2);
    await page2.screenshot({ path: path.join(ART, "03-disabled-order-modal.png"), fullPage: true });
    pay = await readOrderPayLabels(page2);
    const ids2 = pay.labels.map((x) => x.id);
    step("UI hides DuitNow+TNG when disabled", !ids2.includes("duitnow") && !ids2.includes("tng"), JSON.stringify(pay)) ||
      failed++;
    await page2.close();

    // Scope: enable but forOrder=false → should not appear on order.
    await toggleChannel(adminToken, "duitnow", true);
    const ch2 = await api("/api/admin/payment-settings", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
    const duit2 = (ch2.json?.channels || []).find((c) => (c.channel_id || c.id) === "duitnow");
    if (duit2) await saveChannelScopes(adminToken, { ...duit2, enabled: true }, false, true);
    recharge = await api("/api/recharge", bossToken);
    const orderOnly = (recharge.json?.orderPayMethods || []).map((m) => m.code || m.id);
    const rechargeOnly = (recharge.json?.methods || []).map((m) => m.code);
    step("forOrder=false hides from orderPayMethods", !orderOnly.includes("duitnow"), JSON.stringify(orderOnly)) ||
      failed++;
    step("forOrder=false still on recharge when forRecharge", rechargeOnly.includes("duitnow"), JSON.stringify(rechargeOnly)) ||
      failed++;

    // Restore healthy staging defaults.
    if (duit2) await saveChannelScopes(adminToken, { ...duit2, enabled: true }, true, true);
    await toggleChannel(adminToken, "duitnow", true);
    await toggleChannel(adminToken, "tng", true);
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ base: BASE, results }, null, 2));
  console.log(failed ? `ORDER_PAY_METHODS_ENABLE_FAIL ${failed}` : "ORDER_PAY_METHODS_ENABLE_PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
