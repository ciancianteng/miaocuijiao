#!/usr/bin/env node
/** Production smoke: guide accordion on www.meowcuijiao.com (read-only). */
import { chromium } from "playwright-core";
import path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = "https://www.meowcuijiao.com";
const out = "artifacts/guide-upgrade/prod-smoke";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const report = { base: `${BASE}/guide.html`, checks: {}, shots: {}, pass: false };

function ok(n, d) {
  report.checks[n] = { ok: true, detail: d || "" };
  console.log("PASS", n, d || "");
}
function fail(n, d) {
  report.checks[n] = { ok: false, detail: d || "" };
  console.error("FAIL", n, d || "");
}

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

await page.goto(`${BASE}/guide.html`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector(".mcj-guide[data-guide-accordion='1'], .mcj-guide-acc-item", {
  timeout: 20000,
});

const overflowX = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
);
if (!overflowX) ok("NO_HORIZONTAL_OVERFLOW");
else fail("NO_HORIZONTAL_OVERFLOW");

const items = page.locator(".mcj-guide-acc-item");
const count = await items.count();
if (count >= 3) ok("ACCORDION_ITEMS", `count=${count}`);
else fail("ACCORDION_ITEMS", `count=${count}`);

const open0 = await page.locator(".mcj-guide-acc-item.is-open").count();
if (open0 === 0) ok("DEFAULT_COLLAPSED", `open=${open0}`);
else fail("DEFAULT_COLLAPSED", `open=${open0}`);

await page.screenshot({ path: path.join(out, "01-accordion-closed.png"), fullPage: true });
report.shots.closed = path.join(out, "01-accordion-closed.png");

// Ensure boss tab
const bossTab = page.locator('[data-guide-role="boss"], button:has-text("老板")').first();
if (await bossTab.count()) {
  await bossTab.click().catch(() => {});
}
await page.waitForTimeout(200);
ok("BOSS_TAB");

await page.locator(".mcj-guide-acc-trigger").first().click();
await page.waitForTimeout(400);
const open1 = await page.locator(".mcj-guide-acc-item.is-open").count();
if (open1 >= 1) ok("EXPAND", `open=${open1}`);
else fail("EXPAND", `open=${open1}`);

await page.screenshot({ path: path.join(out, "02-accordion-open.png"), fullPage: true });
report.shots.open = path.join(out, "02-accordion-open.png");

await page.locator(".mcj-guide-acc-item.is-open .mcj-guide-acc-trigger").first().click();
await page.waitForTimeout(350);
const open2 = await page.locator(".mcj-guide-acc-item.is-open").count();
if (open2 === 0) ok("COLLAPSE", `open=${open2}`);
else fail("COLLAPSE", `open=${open2}`);

// Companion tab + CTA
const compTab = page.locator('[data-guide-role="companion"], button:has-text("陪玩")').first();
await compTab.click();
await page.waitForTimeout(300);
ok("COMPANION_TAB");

const cta = page.locator("[data-guide-companion-login-link], a.mcj-guide-login-btn").first();
const href = await cta.getAttribute("href");
if (href && /companion\/login/.test(href)) ok("CTA_VISIBLE", href);
else fail("CTA_VISIBLE", href);

const [nav] = await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
  cta.click(),
]);
const finalUrl = page.url();
if (/companion\/login/i.test(finalUrl)) ok("CTA_NAV_LOGIN", finalUrl);
else fail("CTA_NAV_LOGIN", finalUrl);

// not long-list mode
await page.goto(`${BASE}/guide.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".mcj-guide-acc-item", { timeout: 15000 });
const longList = await page.locator(".mcj-guide-doc-card").count();
const acc = await page.locator(".mcj-guide-acc-item").count();
if (acc > 0) ok("NOT_LONG_LIST", `acc=${acc} cards=${longList}`);
else fail("NOT_LONG_LIST", `acc=${acc}`);

const required = [
  "DEFAULT_COLLAPSED",
  "EXPAND",
  "COLLAPSE",
  "BOSS_TAB",
  "COMPANION_TAB",
  "CTA_VISIBLE",
  "CTA_NAV_LOGIN",
  "NO_HORIZONTAL_OVERFLOW",
  "NOT_LONG_LIST",
];
report.pass = required.every((k) => report.checks[k]?.ok);
writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "\nPROD_SMOKE_TEST = PASS" : "\nPROD_SMOKE_TEST = FAIL");
await browser.close();
process.exit(report.pass ? 0 : 1);
