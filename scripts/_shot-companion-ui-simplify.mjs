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

async function dismissModals(page) {
  for (const sel of [
    'button:has-text("暂时不要")',
    'button:has-text("稍后再说")',
    'button:has-text("关闭")',
    '[data-pw-push-dismiss]',
    ".pw-modal [data-close]",
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.count()) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function waitReady(page, selector) {
  await dismissModals(page);
  await page.waitForSelector(selector, { timeout: 45000 });
  await dismissModals(page);
  await page.waitForTimeout(800);
}

const sess = await apiLoginCompanion();
report.checks.LOGIN = !!(sess.accessToken || sess.access_token || sess.token);

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

await context.addInitScript((session) => {
  const access = String(session.accessToken || session.token || session.access_token || "").trim();
  const refresh = String(session.refreshToken || session.refresh_token || "").trim();
  const user = Object.assign({}, session.user || session.player || {}, { role: "companion" });
  const soft = "companion_session_v4_" + Date.now();
  const blob = {
    token: access,
    accessToken: access,
    refreshToken: refresh,
    expiresAt: session.expiresAt || session.expires_at || "",
    user,
    remember: true,
    portal: "companion",
    portalLoginAt: Date.now(),
  };
  for (const store of [localStorage, sessionStorage]) {
    store.setItem("mcjCompanionSession", JSON.stringify(blob));
    store.setItem("companionAuthToken", soft);
    store.setItem("companionUser", JSON.stringify(user));
  }
}, sess);

const page = await context.newPage();
page.setDefaultTimeout(45000);

try {
  await page.goto(BASE + "/companion/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitReady(page, ".pw-status-panel, .pw-action-grid, .pw-metric");
  let text = await page.locator("body").innerText();
  report.checks.DASH_NO_STATUS_GUIDE = !/绿色表示在线可接单/.test(text);
  report.checks.DASH_HAS_STATUS = /今日状态|在线可接单|忙碌中|暂停接单|离线/.test(text);
  report.checks.DASH_HAS_METRICS = /待确认|进行中|今日完成|当前可提现/.test(text);
  report.checks.DASH_HAS_ACTIONS = /抢单大厅|收益中心/.test(text) && (await page.locator(".pw-action-grid").count()) > 0;
  report.checks.DASH_NO_LONG_HUB = (await page.locator(".pw-acc-stack, .companion-workbench-accordion").count()) === 0;
  report.bodySnippetDash = text.slice(0, 400);
  await page.screenshot({ path: shot("01-dashboard.png"), fullPage: true });
  await page.locator(".pw-status-panel").first().screenshot({ path: shot("05-status-panel.png") }).catch(() => {});
  await page.locator(".pw-action-grid").first().screenshot({ path: shot("06-action-grid.png") }).catch(() => {});
  await page.screenshot({ path: shot("09-dashboard-viewport.png"), fullPage: false });

  await page.goto(BASE + "/companion/earnings", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitReady(page, ".pw-grid--earn, .pw-compose-list, [data-earnings-tab]");
  text = await page.locator("body").innerText();
  report.checks.EARN_HAS_OVERVIEW = /当前可提现|提现中|订单24h锁定|累计收入/.test(text);
  report.checks.EARN_HAS_COMPOSE = /收入构成|订单收入|礼物净收入/.test(text);
  report.checks.EARN_HAS_RULES_ACC = (await page.locator(".pw-rules-accordion").count()) > 0;
  report.bodySnippetEarn = text.slice(0, 400);
  await page.screenshot({ path: shot("02-earnings-overview.png"), fullPage: true });
  await page.locator(".pw-grid--earn").first().screenshot({ path: shot("07-earn-overview-cards.png") }).catch(() => {});
  const rules = page.locator(".pw-rules-accordion").first();
  if (await rules.count()) {
    await rules.locator("summary").click().catch(() => {});
    await page.waitForTimeout(400);
    await rules.screenshot({ path: shot("08-rules-accordion.png") });
  }
  await page.screenshot({ path: shot("03a-earnings-income-tab.png"), fullPage: true });

  await page.locator('[data-earnings-tab="withdraw"]').click();
  await page.waitForTimeout(1200);
  await dismissModals(page);
  await page.screenshot({ path: shot("03b-earnings-withdraw.png"), fullPage: true });

  await page.locator('[data-earnings-tab="records"]').click();
  await page.waitForTimeout(1200);
  await dismissModals(page);
  await page.screenshot({ path: shot("03c-earnings-records.png"), fullPage: true });

  await page.goto(BASE + "/companion/account", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitReady(page, ".pw-hub-list, .pw-hub-hero");
  text = await page.locator("body").innerText();
  report.checks.ACCOUNT_HUB = /我的资料|我的服务|等级与价格|认证信息|消息中心|规则与制度|其他资料/.test(text);
  report.bodySnippetAccount = text.slice(0, 500);
  await page.screenshot({ path: shot("04-account.png"), fullPage: true });
  await page.screenshot({ path: shot("09b-account-viewport.png"), fullPage: false });

  report.cacheBust = await page.evaluate(() => {
    const css = [...document.styleSheets]
      .map((s) => s.href)
      .filter(Boolean)
      .find((h) => /companion-workbench/.test(h));
    const js = [...document.scripts].map((s) => s.src).find((h) => /companion-workbench/.test(h));
    return { css, js };
  });

  fs.writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, shots: report.shots, cacheBust: report.cacheBust }, null, 2));
} finally {
  await browser.close();
}
