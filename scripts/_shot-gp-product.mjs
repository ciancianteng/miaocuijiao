import { chromium } from "playwright";
import fs from "fs";
const BASE = "https://meow-cuijiao-homepage-1bdbxjkbb-ciancianteng-4581s-projects.vercel.app";
fs.mkdirSync("tmp-shots", { recursive: true });
const list = await (await fetch(BASE + "/api/platform/gameplay-products")).json();
const product = (list.products || []).find((p) => p.id === "gp-delta-loot") || (list.products || [])[0];
const url = BASE + "/gameplay-product.html?id=" + encodeURIComponent(product.id);
console.log("URL", url, "coverApi", product.coverUrl);
const head = await fetch(BASE + "/gameplay-cover-placeholder.jpg");
console.log("PLACEHOLDER_STATUS", head.status);
const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await desktop.waitForSelector(".gameplay-product-info", { timeout: 30000 });
await desktop.waitForTimeout(1500);
await desktop.screenshot({ path: "tmp-shots/gp-desktop-1440.png", fullPage: false });
const metrics = await desktop.evaluate(() => {
  const c = document.querySelector(".gameplay-product-container");
  const info = document.querySelector(".gameplay-product-info");
  const order = document.querySelector(".gameplay-order-card");
  const pkgs = [...document.querySelectorAll(".gameplay-package-btn")];
  const img = document.querySelector(".gameplay-product-cover-img");
  const r = c.getBoundingClientRect();
  const or = order.getBoundingClientRect();
  return {
    containerW: Math.round(r.width),
    containerLeft: Math.round(r.left),
    infoW: Math.round(info.getBoundingClientRect().width),
    orderW: Math.round(or.width),
    orderLeft: Math.round(or.left),
    rightGap: Math.round(document.documentElement.clientWidth - (or.left + or.width)),
    pkgCount: pkgs.length,
    pkgMaxW: Math.max(...pkgs.map((p) => Math.round(p.getBoundingClientRect().width))),
    coverSrc: img && img.currentSrc,
    naturalW: img && img.naturalWidth,
    hasAvatar: !!(img && /default-avatar/i.test(img.currentSrc || "")),
    scrollOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  };
});
console.log("DESKTOP_METRICS", JSON.stringify(metrics, null, 2));
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await mobile.waitForSelector(".gameplay-product-info", { timeout: 30000 });
await mobile.waitForTimeout(1500);
await mobile.screenshot({ path: "tmp-shots/gp-mobile-390.png", fullPage: false });
await browser.close();
if (metrics.hasAvatar || metrics.pkgMaxW > 400 || metrics.rightGap > 200 || metrics.containerLeft < 80) {
  console.error("UI_FAIL");
  process.exit(2);
}
console.log("UI_PASS");
