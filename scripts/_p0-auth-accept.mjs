import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
fs.mkdirSync("tmp-restore-verify", { recursive: true });

function exe() {
  if (fs.existsSync(EDGE)) return EDGE;
  throw new Error("Edge not found");
}

const browser = await chromium.launch({ executablePath: exe(), headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const results = {};

// A: homepage login button (desktop)
await page.goto(BASE + "/?p0=" + Date.now(), { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(2500);
results.A = await page.evaluate(() => {
  const desk = document.querySelector(".mcj-desk-nav");
  const deskText = desk ? desk.innerText : "";
  const login = [...document.querySelectorAll("a[data-mcj-boss-login], .mcj-desk-nav a")].filter(
    (a) => (a.textContent || "").trim() === "登录"
  );
  return {
    deskText: deskText.replace(/\s+/g, " ").trim(),
    hasDeskLogin: /登录/.test(deskText),
    loginCount: login.length,
    auth: document.body.getAttribute("data-mcj-auth"),
  };
});
await page.screenshot({ path: "tmp-restore-verify/p0-A-home-login.png" });

// B: support unauth
await page.goto(BASE + "/support.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
results.B = await page.evaluate(() => ({
  url: location.href,
  hasBiz: /订单号|会话列表|历史咨询|ORD-|MCJ-/i.test(document.body?.innerText || ""),
  bodyLen: (document.body?.innerText || "").length,
}));
await page.screenshot({ path: "tmp-restore-verify/p0-B-support.png" });

// C: forged params
await page.goto(BASE + "/support.html?order=foreign-order&conversation=foreign-conv", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2500);
results.C = await page.evaluate(() => ({
  url: location.href,
  hasBiz: /订单号|会话列表|历史咨询/i.test(document.body?.innerText || ""),
}));

// API unauth
const apiChat = await page.evaluate(async () => {
  const r = await fetch("/api/chat?action=conversations", { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, message: j.message || null };
});
const apiOrders = await page.evaluate(async () => {
  const r = await fetch("/api/orders", { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok, message: j.message || null };
});
results.api = { apiChat, apiOrders };

console.log(JSON.stringify(results, null, 2));
await browser.close();

const passA = !!(results.A && results.A.hasDeskLogin);
const passB =
  !!(results.B && /login/i.test(results.B.url) && !results.B.hasBiz);
const passC =
  !!(results.C && /login/i.test(results.C.url) && !results.C.hasBiz);
const passApi =
  results.api.apiChat.status === 401 && results.api.apiOrders.status === 401;

console.log(
  JSON.stringify(
    {
      "首页登录按钮": passA ? "PASS" : "FAIL",
      "未登录客服拦截": passB ? "PASS" : "FAIL",
      "URL越权拦截": passC ? "PASS" : "FAIL",
      "API未登录拒绝": passApi ? "PASS" : "FAIL",
    },
    null,
    2
  )
);
