#!/usr/bin/env node
/**
 * Mobile evidence for guide accordion UX on fixed Staging.
 */
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

async function waitReady() {
  await page.waitForSelector('[data-guide-accordion="1"]', { timeout: 30000 });
  await page.waitForTimeout(500);
}

await page.goto(`${BASE}/guide.html?role=boss&v=acc1`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await waitReady();

await page.screenshot({
  path: path.join(out, "01-mobile-home-390.png"),
  fullPage: false,
});
await page.screenshot({
  path: path.join(out, "02-boss-closed-390.png"),
  fullPage: false,
});

await page.click('[data-acc-toggle="b04"]');
await page.waitForTimeout(450);
await page.locator("#guide-b04").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "03-boss-open-390.png"),
  fullPage: false,
});

await page.click('[data-guide-tab="companion"]');
await waitReady();
await page.screenshot({
  path: path.join(out, "04-companion-closed-390.png"),
  fullPage: false,
});

await page.click('[data-acc-toggle="c05"]');
await page.waitForTimeout(450);
await page.locator("#guide-c05").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "05-companion-open-390.png"),
  fullPage: false,
});

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.locator("#guide-companion-login").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(out, "06-companion-login-cta-390.png"),
  fullPage: false,
});

// Short GIF-like frame sequence for expand/collapse
const framesDir = path.join(out, "gif-frames");
mkdirSync(framesDir, { recursive: true });
await page.goto(`${BASE}/guide.html?role=boss&v=acc1`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await waitReady();
await page.locator("#guide-b01").scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(framesDir, "f01-closed.png") });
await page.click('[data-acc-toggle="b01"]');
await page.waitForTimeout(120);
await page.screenshot({ path: path.join(framesDir, "f02-opening.png") });
await page.waitForTimeout(280);
await page.screenshot({ path: path.join(framesDir, "f03-open.png") });
await page.click('[data-acc-toggle="b01"]');
await page.waitForTimeout(120);
await page.screenshot({ path: path.join(framesDir, "f04-closing.png") });
await page.waitForTimeout(280);
await page.screenshot({ path: path.join(framesDir, "f05-closed.png") });

const accordionCount = await page.locator(".mcj-guide-acc-item").count();
const openDefault = await page.locator(".mcj-guide-acc-item.is-open").count();
const hasTabs = (await page.locator(".mcj-guide-tabs").count()) > 0;

await page.click('[data-guide-tab="companion"]');
await waitReady();
const ctaHref = await page.getAttribute(
  "[data-guide-companion-login-link]",
  "href"
);
const ctaVisible = await page.locator("#guide-companion-login").isVisible();

const result = {
  base: BASE,
  url: `${BASE}/guide.html`,
  accordionCount,
  openDefault,
  hasTabs,
  ctaHref,
  ctaVisible,
  shots: [
    "01-mobile-home-390.png",
    "02-boss-closed-390.png",
    "03-boss-open-390.png",
    "04-companion-closed-390.png",
    "05-companion-open-390.png",
    "06-companion-login-cta-390.png",
  ],
  gifFrames: [
    "gif-frames/f01-closed.png",
    "gif-frames/f02-opening.png",
    "gif-frames/f03-open.png",
    "gif-frames/f04-closing.png",
    "gif-frames/f05-closed.png",
  ],
};
writeFileSync(path.join(out, "EVIDENCE.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
