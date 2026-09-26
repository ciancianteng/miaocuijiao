#!/usr/bin/env node
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "https://www.meowcuijiao.com";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = fs.existsSync(EDGE) ? EDGE : CHROME;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/menu-instagram");
fs.mkdirSync(out, { recursive: true });

const report = { base: BASE, ts: new Date().toISOString(), checks: {}, shots: [] };

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
page.setDefaultTimeout(45000);

try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const toggle = page.locator("[data-mcj-mnav-toggle], [data-mcj-nav-more], .mcj-mnav-toggle, button[aria-label*='菜单']").first();
  await toggle.click({ timeout: 15000 }).catch(async () => {
    // fallback: any hamburger in header
    await page.locator("header button").first().click();
  });
  await page.waitForTimeout(800);
  await page.waitForSelector("[data-mcj-instagram-entry], .mcj-mnav-instagram-card", { timeout: 15000 });

  const metrics = await page.evaluate(() => {
    const card = document.querySelector("[data-mcj-instagram-entry], .mcj-mnav-instagram-card");
    const companion = document.querySelector("[data-mcj-companion-entry], .mcj-mnav-companion-card:not(.mcj-mnav-instagram-card)");
    const drawer = document.querySelector(".mcj-mnav-drawer, .mcj-mnav-sheet, [data-mcj-mnav-drawer]");
    const href = card ? card.getAttribute("href") || "" : "";
    const text = card ? card.textContent || "" : "";
    const orderOk = (() => {
      if (!card || !companion) return false;
      const pos = card.compareDocumentPosition(companion);
      return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
    })();
    return {
      hasCard: !!card,
      href,
      hasHandle: /@meowcuijiao/.test(text),
      hasTitle: /官方 Instagram/.test(text),
      noLegacy: !/lianmiaoclub/i.test(text + href),
      targetBlank: card ? card.getAttribute("target") === "_blank" : false,
      relOk: card ? /noopener/.test(card.getAttribute("rel") || "") : false,
      companionAfterIg: orderOk,
      drawerOpen: !!(drawer && (drawer.classList.contains("open") || drawer.classList.contains("is-open") || getComputedStyle(drawer).visibility !== "hidden")),
    };
  });
  report.checks = metrics;

  const menuShot = path.join(out, "01-menu-full-390.png");
  await page.screenshot({ path: menuShot, fullPage: false });
  report.shots.push("01-menu-full-390.png");

  const card = page.locator("[data-mcj-instagram-entry], .mcj-mnav-instagram-card").first();
  await card.screenshot({ path: path.join(out, "02-instagram-card.png") });
  report.shots.push("02-instagram-card.png");

  // Click and capture destination (popup or same tab)
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
    card.click(),
  ]);
  const dest = popup || page;
  await dest.waitForLoadState("domcontentloaded").catch(() => {});
  await dest.waitForTimeout(2000);
  const destUrl = dest.url();
  report.checks.destUrl = destUrl;
  report.checks.destIsMeowcuijiao = /instagram\.com\/meowcuijiao/i.test(destUrl);
  report.checks.destNotLegacy = !/lianmiaoclub/i.test(destUrl);
  await dest.screenshot({ path: path.join(out, "03-instagram-destination.png"), fullPage: false }).catch(() => {});
  report.shots.push("03-instagram-destination.png");
  if (popup) await popup.close().catch(() => {});

  report.pass =
    !!metrics.hasCard &&
    !!metrics.hasHandle &&
    !!metrics.hasTitle &&
    !!metrics.noLegacy &&
    !!metrics.targetBlank &&
    !!metrics.companionAfterIg &&
    !!report.checks.destIsMeowcuijiao &&
    !!report.checks.destNotLegacy;

  fs.writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
} finally {
  await browser.close();
}
