#!/usr/bin/env node
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = process.env.BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "shot-companion-ui-simplify", base: BASE });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = fs.existsSync(EDGE) ? EDGE : CHROME;
const PASS = "OrganicGoLive!Mcj2026";
const compEmail = "organic.companion@mcj-staging-organic.invalid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../artifacts/companion-ui-simplify");
fs.mkdirSync(out, { recursive: true });

const report = { base: BASE, ts: new Date().toISOString(), checks: {}, shots: [] };

async function apiLoginCompanion() {
  const r = await fetch(BASE + "/api/companion", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      action: "login",
      email: compEmail,
      account: compEmail,
      password: PASS,
      remember: true,
    }),
  });
  return (await r.json())?.session || {};
}

function shot(name) {
  report.shots.push(name);
  return path.join(out, name);
}

async function injectSession(page, sess) {
  await page.evaluate((session) => {
    const token = session.accessToken || session.access_token || "";
    const payload = {
      accessToken: token,
      access_token: token,
      token,
      refreshToken: session.refreshToken || session.refresh_token || "",
      user: session.user || session.player || {},
    };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(payload));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(payload));
    localStorage.setItem("companionAuthToken", "companion_session_v1_soft");
    sessionStorage.setItem("companionAuthToken", "companion_session_v1_soft");
  }, sess);
}

async function gotoCompanion(page, route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45000 });
  await injectSession(page, report.session);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".pw-shell, .pw-page-head, .pw-status-panel", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

try {
  const sess = await apiLoginCompanion();
  report.session = sess;
  report.checks.LOGIN = !!(sess.accessToken || sess.access_token);

  await gotoCompanion(page, "/companion/dashboard");
  let text = await page.locator("body").innerText();
  report.checks.DASH_NO_STATUS_GUIDE = !/绿色表示在线可接单|四个状态说明/.test(text);
  report.checks.DASH_HAS_STATUS = /今日状态|在线可接单|忙碌中|暂停接单|离线/.test(text);
  report.checks.DASH_HAS_METRICS = /待确认|进行中|今日完成|当前可提现/.test(text);
  report.checks.DASH_HAS_ACTIONS = /我的订单|抢单大厅|收益中心|我的资料/.test(text);
  report.checks.DASH_NO_LONG_HUB =
    !/我的服务[\s\S]{0,40}我的等级与价格[\s\S]{0,40}认证信息/.test(text);
  await page.screenshot({ path: shot("01-dashboard.png"), fullPage: true });

  const status = page.locator(".pw-status-panel").first();
  if (await status.count()) await status.screenshot({ path: shot("05-status-panel.png") });
  const actions = page.locator(".pw-action-grid").first();
  if (await actions.count()) await actions.screenshot({ path: shot("06-action-grid.png") });

  await gotoCompanion(page, "/companion/earnings");
  text = await page.locator("body").innerText();
  report.checks.EARN_HAS_OVERVIEW = /当前可提现|提现中|订单24h锁定|累计收入/.test(text);
  report.checks.EARN_HAS_COMPOSE = /收入构成|订单收入|礼物净收入|邀请佣金/.test(text);
  report.checks.EARN_HAS_RULES_ACC = /说明/.test(text);
  await page.screenshot({ path: shot("02-earnings-overview.png"), fullPage: true });

  const overview = page.locator(".pw-grid--earn").first();
  if (await overview.count()) await overview.screenshot({ path: shot("07-earn-overview-cards.png") });

  const rules = page.locator(".pw-rules-accordion").first();
  if (await rules.count()) {
    await rules.locator("summary").click().catch(() => {});
    await page.waitForTimeout(400);
    await rules.screenshot({ path: shot("08-rules-accordion.png") });
  }

  for (const [tab, file] of [
    ["withdraw", "03b-earnings-withdraw.png"],
    ["records", "03c-earnings-records.png"],
  ]) {
    await page.locator(`[data-earnings-tab="${tab}"]`).click().catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot(file), fullPage: true });
  }
  await page.locator('[data-earnings-tab="overview"]').click().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("03a-earnings-income-tab.png"), fullPage: true });

  await gotoCompanion(page, "/companion/account");
  text = await page.locator("body").innerText();
  report.checks.ACCOUNT_HUB =
    /我的资料|我的服务|等级与价格|认证信息|消息中心|规则与制度|其他资料/.test(text);
  await page.screenshot({ path: shot("04-account.png"), fullPage: true });

  await page.screenshot({ path: shot("09-dashboard-viewport.png"), fullPage: false });
  await gotoCompanion(page, "/companion/dashboard");
  await page.screenshot({ path: shot("09b-dashboard-fullpage.png"), fullPage: true });

  report.cacheBust = await page.evaluate(() => {
    const css = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((el) => el.href)
      .find((h) => /companion-workbench\.css/.test(h));
    const js = [...document.querySelectorAll("script")]
      .map((el) => el.src)
      .find((h) => /companion-workbench/.test(h));
    return { css, js };
  });

  fs.writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
