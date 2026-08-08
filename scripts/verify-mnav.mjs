import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const base = process.argv[2] || "https://meow-cuijiao-homepage-r6ed0r1zt-ciancianteng-4581s-projects.vercel.app";
const outDir = path.join(process.cwd(), "tmp-mnav-shots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base + "/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1200);
const toggle = page.locator("[data-mcj-mnav-toggle]");
await toggle.waitFor({ state: "visible" });
await toggle.click();
await page.waitForTimeout(400);

const afterOpen = await page.evaluate(() => {
  const sheet = document.getElementById("mcjMnavSheet");
  const links = [...document.querySelectorAll("[data-mcj-mnav-links] a")].map((a) => ({
    text: a.textContent.trim(),
    href: a.getAttribute("href"),
  }));
  const drawer = document.querySelector("[data-mcj-mnav-drawer]");
  const r = drawer && drawer.getBoundingClientRect();
  return {
    expanded: document.querySelector("[data-mcj-mnav-toggle]")?.getAttribute("aria-expanded"),
    sheetHidden: sheet?.hidden,
    bodyOpen: document.body.classList.contains("mcj-mnav-open"),
    bodyPos: getComputedStyle(document.body).position,
    links,
    drawer: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } : null,
    zSheet: sheet ? getComputedStyle(sheet).zIndex : null,
    zHeader: getComputedStyle(document.querySelector("header.mcj-boss-header")).zIndex,
  };
});
await page.screenshot({ path: path.join(outDir, "mnav-open-390.png"), fullPage: false });

await page.locator("[data-mcj-mnav-backdrop]").click({ position: { x: 20, y: 400 } });
await page.waitForTimeout(250);
const afterBackdrop = await page.evaluate(() => ({
  expanded: document.querySelector("[data-mcj-mnav-toggle]")?.getAttribute("aria-expanded"),
  sheetHidden: document.getElementById("mcjMnavSheet")?.hidden,
  bodyOpen: document.body.classList.contains("mcj-mnav-open"),
}));

await toggle.click();
await page.waitForTimeout(200);
await page.locator("[data-mcj-mnav-close]").click();
await page.waitForTimeout(200);
const afterCloseBtn = await page.evaluate(() => ({
  expanded: document.querySelector("[data-mcj-mnav-toggle]")?.getAttribute("aria-expanded"),
  sheetHidden: document.getElementById("mcjMnavSheet")?.hidden,
}));

await toggle.click();
await page.waitForTimeout(200);
await toggle.click();
await page.waitForTimeout(200);
const afterToggleClose = await page.evaluate(() => ({
  expanded: document.querySelector("[data-mcj-mnav-toggle]")?.getAttribute("aria-expanded"),
  sheetHidden: document.getElementById("mcjMnavSheet")?.hidden,
}));

const linkTests = [];
const expected = [
  { label: "首页", hrefRe: /index\.html|^\/?$/, ok: (url) => /index\.html/i.test(url) || new URL(url).pathname === "/" || /#/.test(url) },
  { label: "陪玩大厅", hrefRe: /companion-center/, ok: (url) => /companion-center/i.test(url) },
  { label: "订单", hrefRe: /orders/, ok: (url) => /orders/i.test(url) || /login/i.test(url) },
  { label: "客服", hrefRe: /support/, ok: (url) => /support/i.test(url) || /login/i.test(url) },
  { label: "登录", hrefRe: /login/, ok: (url, modal) => !!modal || /login/i.test(url) },
];

for (const item of expected) {
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.locator("[data-mcj-mnav-toggle]").click();
  await page.waitForTimeout(300);
  const link = page.locator("[data-mcj-mnav-links] a", { hasText: new RegExp("^" + item.label + "$") });
  const href = await link.getAttribute("href");
  const hrefOk = item.hrefRe.test(String(href || ""));
  await link.click();
  await page.waitForTimeout(1200);
  const url = page.url();
  let modal = false;
  if (item.label === "登录") {
    modal = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".modal, [class*=login], [data-modal], dialog")];
      return nodes.some((n) => {
        const s = getComputedStyle(n);
        return s.display !== "none" && s.visibility !== "hidden" && n.getBoundingClientRect().width > 40;
      });
    });
  }
  linkTests.push({
    label: item.label,
    href,
    hrefOk,
    url,
    modal,
    pass: hrefOk && item.ok(url, modal),
  });
}

const summary = {
  openOk: afterOpen.expanded === "true" && afterOpen.bodyOpen && (afterOpen.links || []).length >= 5,
  backdropClose: afterBackdrop.expanded === "false" && afterBackdrop.sheetHidden,
  closeBtn: afterCloseBtn.expanded === "false" && afterCloseBtn.sheetHidden,
  toggleClose: afterToggleClose.expanded === "false" && afterToggleClose.sheetHidden,
  linksPass: linkTests.every((t) => t.pass),
};

console.log(
  JSON.stringify(
    {
      afterOpen,
      afterBackdrop,
      afterCloseBtn,
      afterToggleClose,
      linkTests,
      summary,
      errors,
      shot: path.join(outDir, "mnav-open-390.png"),
    },
    null,
    2
  )
);
await browser.close();
process.exit(Object.values(summary).every(Boolean) && errors.length === 0 ? 0 : 1);
