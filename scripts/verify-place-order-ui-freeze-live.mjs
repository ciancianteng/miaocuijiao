#!/usr/bin/env node
/**
 * Live layout regression for MCJ-PLACE-ORDER-UI-APPROVED-V1.
 * Requires BASE_URL (Production or Staging) and a Chromium via playwright-core.
 *
 * Usage:
 *   BASE_URL=https://www.meowcuijiao.com node scripts/verify-place-order-ui-freeze-live.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const TAG = "MCJ-PLACE-ORDER-UI-APPROVED-V1";
const BASE = String(process.env.BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("BASE_URL required");
  process.exit(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs/ui-baselines", TAG, "live-runs");
fs.mkdirSync(outDir, { recursive: true });

function findChrome() {
  const env = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const p = execSync("npx playwright-core install --dry-run chromium", {
      encoding: "utf8",
    });
    const m = p.match(/chrome-win[^\s]+\\chrome\.exe|chromium[^\s]+/i);
    if (m) return m[0];
  } catch {
    /* ignore */
  }
  return null;
}

async function measure(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".mcj-po-game-option")];
    if (cards.length < 2) return { err: "need ≥2 service cards", n: cards.length };
    const list = document.querySelector(".mcj-po-game-list");
    const rows = cards.slice(0, 2).map((c) => {
      const name = c.querySelector(".mcj-po-game-option-name");
      const price = c.querySelector(".mcj-po-game-option-price");
      const cs = getComputedStyle(c);
      const nr = name.getBoundingClientRect();
      const pr = price.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      return {
        flexDir: cs.flexDirection,
        justify: cs.justifyContent,
        align: cs.alignItems,
        sameRow: Math.abs((nr.top + nr.bottom) / 2 - (pr.top + pr.bottom) / 2) < 8,
        nameBeforePrice: nr.right <= pr.left + 1,
        priceColor: getComputedStyle(price).color,
        h: Math.round(cr.height),
        left: Math.round(cr.left),
        w: Math.round(cr.width),
      };
    });
    return {
      grid: getComputedStyle(list).gridTemplateColumns,
      twoCol: / /.test(getComputedStyle(list).gridTemplateColumns),
      sameHeight: Math.abs(rows[0].h - rows[1].h) <= 2,
      sideBySide: Math.abs(rows[0].left + rows[0].w + 20 - rows[1].left) < 40,
      rows,
      vw: window.innerWidth,
    };
  });
}

function assertLayout(label, m) {
  const fails = [];
  if (m.err) fails.push(m.err);
  if (!m.twoCol) fails.push("not 2-col grid");
  if (!m.sideBySide) fails.push("cards not side-by-side");
  if (!m.sameHeight) fails.push("card heights differ");
  for (const r of m.rows || []) {
    if (r.flexDir !== "row") fails.push("flexDir≠row");
    if (r.justify !== "space-between") fails.push("justify≠space-between");
    if (r.align !== "center") fails.push("align≠center");
    if (!r.sameRow) fails.push("name/price not same row");
    if (!r.nameBeforePrice) fails.push("name not left of price");
    if (r.priceColor !== "rgb(255, 159, 205)") fails.push(`price color ${r.priceColor}`);
  }
  if (fails.length) {
    console.error(`  FAIL  ${label}: ${fails.join("; ")}`);
    console.error(JSON.stringify(m, null, 2));
    return false;
  }
  console.log(`  OK  ${label} vw=${m.vw} grid=${m.grid}`);
  return true;
}

async function openModal(page) {
  await page.goto(`${BASE}/companion-center.html?poFreeze=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3500);
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === "立即下单"
    );
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clicked) throw new Error("立即下单 button not found");
  await page.waitForSelector(".mcj-po-game-option", { timeout: 15000 });
  await page.waitForTimeout(800);
}

async function main() {
  console.log(`[${TAG}] live check → ${BASE}`);
  const exe = findChrome();
  if (!exe) {
    console.error("Chrome/Chromium not found; set CHROME_PATH");
    process.exit(2);
  }
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
  });
  let pass = true;
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openModal(desktop);
    const md = await measure(desktop);
    pass = assertLayout("desktop", md) && pass;
    await desktop.screenshot({
      path: path.join(outDir, `desktop-${Date.now()}.png`),
      fullPage: false,
    });
    await desktop.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await openModal(mobile);
    const mm = await measure(mobile);
    pass = assertLayout("mobile-390", mm) && pass;
    await mobile.screenshot({
      path: path.join(outDir, `mobile-390-${Date.now()}.png`),
      fullPage: false,
    });
    await mobile.close();
  } finally {
    await browser.close();
  }
  if (!pass) {
    console.error(`[${TAG}] LIVE FAILED`);
    process.exit(1);
  }
  console.log(`[${TAG}] LIVE PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
