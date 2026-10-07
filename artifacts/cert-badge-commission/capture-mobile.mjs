#!/usr/bin/env node
/** Read-only: mobile screenshots of the badge holder pages, scrolled screen by screen inside the admin scroll container. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "holders");
const STG = /^https:\/\/meow-cuijiao-homepage-[a-z0-9]+-ciancianteng-4581s-projects\.vercel\.app$/.test(process.env.STG_URL || "")
  ? process.env.STG_URL
  : "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "cert-badge-capture-mobile", base: STG });
const prev = JSON.parse(fs.readFileSync(path.join(OUT, "report.json"), "utf8"));
const HID = prev.badge.id;
const PID = prev.holderA.profileId;
const root = "#companionCertTagManagement";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await ctx.newPage();
await page.goto(`${STG}/admin/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator('form[data-admin-login] input[name="account"]').fill("admin@meow.test");
await page.locator('form[data-admin-login] input[name="password"]').fill("McjTest@12345678");
await page.locator('form[data-admin-login] [type="submit"]').click();
await page.waitForURL((u) => /\/admin/.test(String(u)) && !/\/admin\/login/.test(String(u)), { timeout: 45000 }).catch(() => {});
await page.goto(`${STG}/admin/#companion-cert-tags`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(`${root} [data-cert-filter-tag]`, { timeout: 45000 });
const settle = async () => {
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .content-loading`), root, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);
};
async function segments(prefix, max = 6) {
  const files = [];
  const info = await page.evaluate((sel) => {
    let el = document.querySelector(sel);
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) break;
      el = el.parentElement;
    }
    const sc = el && el !== document.body ? el : document.scrollingElement;
    sc.setAttribute("data-shot-scroller", "1");
    sc.scrollTop = 0;
    return { h: sc.scrollHeight, c: sc.clientHeight };
  }, root);
  const steps = Math.min(max, Math.ceil(info.h / Math.max(1, info.c - 80)));
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate(({ i, step }) => {
      document.querySelector("[data-shot-scroller]").scrollTop = i * step;
    }, { i, step: info.c - 80 });
    await page.waitForTimeout(350);
    const name = `${prefix}-${String(i + 1).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    files.push(name);
  }
  return files;
}
const shots = {};
await page.locator('[data-cert-range="all"]').first().click();
await settle();
await page.selectOption(`${root} [data-cert-filter-tag]`, HID);
await settle();
shots.list = await segments("m-list", 3);
await page.locator(`${root} .panel[data-cert-detail="${HID}"]`).first().click();
await page.waitForSelector(`${root} [data-cert-detail-tab]`);
await settle();
shots.detail = await segments("m-detail-holders", 5);
await page.locator(`${root} [data-cert-holder="${PID}"] >> visible=true`).first().click();
await page.waitForSelector(`${root} [data-cert-holder-back]`);
await settle();
shots.holder = await segments("m-holder-orders", 7);
async function anchorShot(selector, name) {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -150);
    return true;
  }, selector);
  await page.waitForTimeout(400);
  if (ok) await page.screenshot({ path: path.join(OUT, name) });
  return ok ? name : null;
}
shots.holderOrders = [
  await anchorShot(`${root} [data-cert-order-filter]`, "m-holder-orders-list-1.png"),
  await anchorShot(`${root} .capp-mobile-cards .capp-card:nth-child(2)`, "m-holder-orders-list-2.png"),
];
await page.locator(`${root} [data-cert-order-filter="open"]`).first().click();
await page.waitForTimeout(400);
shots.holderOpen = await anchorShot(`${root} [data-cert-order-filter]`, "m-holder-orders-unfinished.png");
await browser.close();
console.log(JSON.stringify(shots));
