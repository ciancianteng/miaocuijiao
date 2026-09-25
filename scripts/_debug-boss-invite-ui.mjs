import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "OrganicGoLive!Mcj2026";
const exe = existsSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sess = await (
  await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: "organic.boss@mcj-staging-organic.invalid",
      password: PASS,
      role: "boss",
    }),
  })
).json();

const token = sess.session.accessToken;
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage();
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
page.on("response", (r) => {
  if (r.url().includes("invite-links") || r.url().includes("direct-companions")) {
    console.log("RESP", r.status(), r.url());
  }
});

await page.addInitScript((token) => {
  localStorage.setItem("mcjAuthAccessToken", token);
  sessionStorage.setItem("mcjAuthAccessToken", token);
  localStorage.setItem("access_token", token);
  sessionStorage.setItem("access_token", token);
}, token);

await page.goto(`${BASE}/my-direct-companions.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => ({
  hasAuth: !!window.MCJBossAuth,
  tokenViaAuth: window.MCJBossAuth && window.MCJBossAuth.getAccessToken ? window.MCJBossAuth.getAccessToken() : null,
  ls: localStorage.getItem("mcjAuthAccessToken")?.slice(0, 20),
  body: document.body.innerText.slice(0, 500),
  invite: document.querySelector("[data-invite-panel]")?.innerText?.slice(0, 300) || null,
  app: document.getElementById("directCompanionsApp")?.innerHTML?.slice(0, 200),
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "artifacts/invite-direct-p0/debug-boss.png", fullPage: true });
await browser.close();
