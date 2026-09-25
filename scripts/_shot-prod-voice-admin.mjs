#!/usr/bin/env node
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROD = "https://www.meowcuijiao.com";
const out = "artifacts/voice-admin";
mkdirSync(out, { recursive: true });

const html = await fetch(`${PROD}/admin.html`).then((r) => r.text());
const voices = await fetch(`${PROD}/api/platform/content?types=voice_types`).then((r) => r.json());
const build = await fetch(`${PROD}/api/build-info`).then((r) => r.json().catch(() => ({})));
const probe = {
  hasNav: html.includes('data-section="voice-types"'),
  hasScript: html.includes("admin-companion-voice-types"),
  hasMount: html.includes("companionVoiceTypeManagement"),
  publicVoiceCount: (voices.byType?.voice_types || []).length,
  sample: (voices.byType?.voice_types || []).slice(0, 5).map((x) => x.name),
  build,
};
writeFileSync(path.join(out, "PROD_PROBE.json"), JSON.stringify(probe, null, 2));
console.log(JSON.stringify(probe, null, 2));

const login = await fetch(`${PROD}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "login",
    role: "admin",
    email: "admin@meow.test",
    password: "McjTest@12345678",
  }),
}).then((r) => r.json());
const tok = login.session?.accessToken || "";
console.log("admin login", !!tok, login.ok);

if (!tok) process.exit(0);

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${PROD}/admin.html`, { waitUntil: "domcontentloaded" });
await page.evaluate(
  ({ token, refresh, expiresAt }) => {
    const soft = "admin_session_v4_" + Date.now();
    const user = {
      email: "admin@meow.test",
      role: "admin",
      adminRole: "admin",
      roles: ["admin"],
      name: "管理员",
      status: "active",
    };
    const pairs = [
      ["adminAuthToken", soft],
      ["adminUser", JSON.stringify(user)],
      ["mcjRole", "admin"],
      ["mcjAdminAccessToken", token],
      ["mcjAdminRefreshToken", refresh || ""],
      ["mcjAdminExpiresAt", String(expiresAt || "")],
    ];
    for (const [k, v] of pairs) {
      if (!v && k.includes("Refresh")) continue;
      localStorage.setItem(k, v);
      sessionStorage.setItem(k, v);
    }
  },
  {
    token: tok,
    refresh: login.session?.refreshToken || "",
    expiresAt: login.session?.expiresAt || "",
  }
);
await page.goto(`${PROD}/admin.html#voice-types`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const btn = document.querySelector('[data-section="voice-types"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(out, "06-prod-voice-admin-390.png"), fullPage: false });
await browser.close();
console.log("shot ok");
