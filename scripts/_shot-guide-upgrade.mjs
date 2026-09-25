#!/usr/bin/env node
import { chromium } from "playwright-core";
import path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const out = "artifacts/guide-upgrade";
mkdirSync(out, { recursive: true });
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : undefined;
if (!exe) throw new Error("No Chrome/Edge found");

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

await page.goto(`${BASE}/guide.html?role=boss`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector('[data-guide-doc="1"]', { timeout: 30000 });
await page.waitForTimeout(600);

await page.screenshot({
  path: path.join(out, "01-boss-hero-390.png"),
  fullPage: false,
});

await page.locator("#guide-b04").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "02-boss-single-order-390.png"),
  fullPage: false,
});

await page.locator("#guide-b05").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "03-boss-multi-order-390.png"),
  fullPage: false,
});

await page.locator("#guide-section-companion").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "04-companion-guide-390.png"),
  fullPage: false,
});

await page.locator("#guide-companion-login").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "05-companion-login-cta-390.png"),
  fullPage: false,
});

const href = await page.getAttribute(
  "[data-guide-companion-login-link]",
  "href"
);
await Promise.all([
  page.waitForURL(/\/companion\/login/, { timeout: 20000 }),
  page.click("[data-guide-companion-login-link]"),
]);
await page.waitForTimeout(1000);
await page.screenshot({
  path: path.join(out, "06-companion-login-page-390.png"),
  fullPage: false,
});

const result = {
  base: BASE,
  href,
  title: await page.title(),
  url: page.url(),
  loginOk: /\/companion\/login/.test(page.url()),
};
writeFileSync(path.join(out, "EVIDENCE.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
