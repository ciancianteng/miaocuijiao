#!/usr/bin/env node
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;
const out = "artifacts/voice-admin";
mkdirSync(out, { recursive: true });

const login = await fetch(`${STG}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "login",
    role: "admin",
    email: "admin@meow.test",
    password: "McjTest@12345678",
  }),
}).then((r) => r.json());
const tok = login.session?.accessToken;
console.log("tok", !!tok);

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${STG}/admin.html`, { waitUntil: "domcontentloaded" });
await page.evaluate((token) => {
  localStorage.setItem("adminAuthToken", token);
  localStorage.setItem("mcjAdminRole", "admin");
  localStorage.setItem(
    "adminUser",
    JSON.stringify({ role: "admin", email: "admin@meow.test", roleKey: "admin", accessToken: token })
  );
}, tok);
await page.goto(`${STG}/admin.html`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
const info = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  hasNav: !!document.querySelector('[data-section="voice-types"]'),
  sections: [...document.querySelectorAll("[data-section]")].map((b) => b.getAttribute("data-section")).slice(0, 20),
  bodyText: (document.body?.innerText || "").slice(0, 300),
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(out, "debug-admin.png"), fullPage: true });
await browser.close();
