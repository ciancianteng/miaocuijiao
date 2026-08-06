import fs from "node:fs";
import { chromium } from "playwright-core";

function chromePath() {
  const cands = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  return null;
}

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const exe = chromePath();
if (!exe) throw new Error("no chrome");

const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext(); // clean = incognito-like
const page = await context.newPage();

async function shot(name) {
  await page.screenshot({ path: `tmp-restore-verify/${name}.png`, fullPage: false });
}

// Test A: homepage login button
await page.goto(BASE + "/?authProbe=1", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
const home = await page.evaluate(() => {
  const links = [...document.querySelectorAll("a,button")].map((el) => (el.textContent || "").trim());
  const loginLinks = [...document.querySelectorAll("a[data-mcj-boss-login], a[href*='login']")].map((a) => ({
    text: (a.textContent || "").trim(),
    href: a.getAttribute("href"),
    visible: !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length),
  }));
  const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
  const drawer = (document.querySelector("[data-mcj-mnav-links]") || {}).innerText || "";
  return {
    desk,
    drawer,
    loginLinks,
    hasLoginText: links.some((t) => t === "登录"),
    authAttr: document.body.getAttribute("data-mcj-auth"),
  };
});
await shot("p0-home-unauth");
console.log("A_HOME", JSON.stringify(home, null, 2));

// Test B: support without auth
await page.goto(BASE + "/support.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
const support = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  bodyStart: (document.body && document.body.innerText || "").slice(0, 400),
  hasOrderLike: /订单|会话|MCJ|ORD/i.test(document.body && document.body.innerText || ""),
}));
await shot("p0-support-unauth");
console.log("B_SUPPORT", JSON.stringify(support, null, 2));

// Test C: support with forged params
await page.goto(BASE + "/support.html?order=fake-order&conversation=fake-conv", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2500);
const forged = await page.evaluate(() => ({
  url: location.href,
  bodyStart: (document.body && document.body.innerText || "").slice(0, 400),
  hasBiz: /订单号|会话列表|历史咨询/i.test(document.body && document.body.innerText || ""),
}));
await shot("p0-support-forged");
console.log("C_FORGED", JSON.stringify(forged, null, 2));

await browser.close();
