import { chromium } from "playwright";
import fs from "fs";
const BASE = "https://meow-cuijiao-homepage-e8k4cmu8l-ciancianteng-4581s-projects.vercel.app";
fs.mkdirSync("tmp-shots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
const metrics = await page.evaluate(() => {
  const header = document.querySelector("header.mcj-boss-header");
  const nav = header && header.querySelector("nav");
  const links = nav ? [...nav.querySelectorAll("a")].map((a) => a.textContent.trim()) : [];
  const text = header ? header.innerText : "";
  const brand = !!header && !!header.querySelector(".brand, .mcj-boss-brand, .live2d-avatar");
  const more = !!header && !!header.querySelector(".mcj-boss-more, [data-mcj-nav-more]");
  const widths = nav ? [...nav.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().width)) : [];
  const heights = nav ? [...nav.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().height)) : [];
  let widest = null;
  let maxW = 0;
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > maxW) { maxW = r.width; widest = el.tagName + "." + (el.className || "").toString().slice(0, 80); }
  });
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    equal: document.documentElement.scrollWidth === window.innerWidth,
    links,
    text,
    brand,
    more,
    widths,
    heights,
    hasMiao: /妙脆角/.test(text),
    hasMyOrders: /我的订单/.test(text),
    hasOnlineCs: /在线客服/.test(text),
    hasHamburger: /☰/.test(text) || more,
    widest,
    maxW: Math.round(maxW),
  };
});
await page.screenshot({ path: "tmp-shots/header-390.png", fullPage: false });
console.log(JSON.stringify(metrics, null, 2));
const fail = !metrics.equal || metrics.hasMiao || metrics.hasMyOrders || metrics.hasOnlineCs || metrics.hasHamburger || metrics.brand || metrics.links.length !== 4 || !metrics.links.every((t, i) => t === ["首页","大厅","订单","客服"][i]);
console.log(fail ? "VERIFY_FAIL" : "VERIFY_PASS");
await browser.close();
process.exit(fail ? 2 : 0);
