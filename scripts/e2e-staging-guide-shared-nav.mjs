#!/usr/bin/env node
/** Staging visual accept: guide page shared header + companion login card. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-guide-shared-nav");
fs.mkdirSync(outDir, { recursive: true });
const STG = process.env.BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const report = { ok: false, staging: STG, shots: [], checks: {} };
const browser = await chromium.launch({ executablePath: EDGE, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${STG}/guide.html?role=companion`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  const hasHeader = await page.locator("header.mcj-boss-header").count();
  const hasBrand = await page.locator(".mcj-header-brand-en").count();
  const hasToggle = await page.locator("[data-mcj-mnav-toggle]").count();
  const hasGo = await page.locator("[data-guide-companion-go]").count();
  report.checks.header = hasHeader > 0;
  report.checks.brand = hasBrand > 0;
  report.checks.hamburger = hasToggle > 0;
  report.checks.companionShortcut = hasGo > 0;

  await page.screenshot({ path: path.join(outDir, "01-guide-header-390.png"), fullPage: false });
  report.shots.push("01-guide-header-390.png");

  await page.click("[data-mcj-mnav-toggle]");
  await page.waitForTimeout(800);
  const card = page.locator("[data-mcj-companion-entry]");
  report.checks.companionCard = (await card.count()) > 0;
  const cardText = report.checks.companionCard ? await card.innerText() : "";
  report.checks.cardHasLogin = /陪玩登录|进入陪玩工作台/.test(cardText);
  report.checks.cardHasFeats = /工作台|抢单|订单|收益/.test(cardText);
  await page.screenshot({ path: path.join(outDir, "02-menu-companion-card-390.png"), fullPage: false });
  report.shots.push("02-menu-companion-card-390.png");

  const href = report.checks.companionCard ? await card.getAttribute("href") : "";
  report.checks.hrefOk = /\/companion\/(login|dashboard)/.test(String(href || ""));

  if (report.checks.companionCard) {
    await Promise.all([
      page.waitForURL(/\/companion\/(login|dashboard)/, { timeout: 20000 }).catch(() => null),
      card.click(),
    ]);
    await page.waitForTimeout(1500);
    report.checks.landedCompanion =
      /\/companion\/(login|dashboard)/.test(page.url());
    await page.screenshot({ path: path.join(outDir, "03-companion-login-landed-390.png"), fullPage: false });
    report.shots.push("03-companion-login-landed-390.png");
  }

  // Companion tab shortcut
  await page.goto(`${STG}/guide.html?role=companion`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, "04-companion-tab-shortcut-390.png"), fullPage: true });
  report.shots.push("04-companion-tab-shortcut-390.png");

  // Widths
  for (const w of [320, 375, 430]) {
    await page.setViewportSize({ width: w, height: 740 });
    await page.goto(`${STG}/guide.html?role=companion`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.click("[data-mcj-mnav-toggle]").catch(() => null);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    report.checks[`noOverflow_${w}`] = !overflow;
    await page.screenshot({ path: path.join(outDir, `05-menu-${w}.png`), fullPage: false });
    report.shots.push(`05-menu-${w}.png`);
  }

  report.ok = Object.values(report.checks).every(Boolean);
  fs.writeFileSync(path.join(outDir, "ACCEPTANCE.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  report.error = String(err?.stack || err);
  fs.writeFileSync(path.join(outDir, "ACCEPTANCE.json"), JSON.stringify(report, null, 2));
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
process.exit(report.ok ? 0 : 1);
