#!/usr/bin/env node
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = "artifacts/guide-upgrade";
mkdirSync(out, { recursive: true });
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : undefined;
if (!exe) throw new Error("No browser");

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  recordVideo: { dir: out, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
await page.goto(`${BASE}/guide.html?role=boss&v=acc2`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector('[data-guide-accordion="1"]', { timeout: 30000 });
await page.waitForTimeout(400);
await page.locator("#guide-b01").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.click('[data-acc-toggle="b01"]');
await page.waitForTimeout(700);
await page.click('[data-acc-toggle="b02"]');
await page.waitForTimeout(700);
await page.click('[data-acc-toggle="b02"]');
await page.waitForTimeout(500);
const vpath = await page.video().path();
await context.close();
await browser.close();
const dest = path.join(out, "07-accordion-toggle.webm");
renameSync(vpath, dest);
const meta = { video: dest, bytes: statSync(dest).size };
writeFileSync(path.join(out, "VIDEO.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
