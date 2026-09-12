import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const EDGE = "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe";

const login = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "login", email: BOSS, password: PASS }),
}).then((r) => r.json());
if (!login.ok) throw new Error(JSON.stringify(login));

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => {
  sessionStorage.setItem("mcjAuthAccessToken", s.accessToken);
  if (s.refreshToken) sessionStorage.setItem("mcjAuthRefreshToken", s.refreshToken);
  if (s.expiresAt != null) sessionStorage.setItem("mcjAuthExpiresAt", String(s.expiresAt));
  sessionStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
  sessionStorage.setItem(
    "customerUser",
    JSON.stringify({ role: "boss", email: s.user?.email || "", displayName: s.user?.displayName || "Boss" })
  );
  sessionStorage.setItem("mcjRole", "boss");
}, login.session);
await page.goto(`${BASE}/support.html?start=1`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const text = (document.body.innerText || "").slice(0, 3000);
  const orderCards = document.querySelectorAll(".support-order-card, [data-open-order-conversation]").length;
  const sessions = document.querySelectorAll(".support-session").length;
  return { url: location.href, orderCards, sessions, text };
});
fs.mkdirSync("tmp-restore-verify", { recursive: true });
await page.screenshot({ path: "tmp-restore-verify/p0-support-leak.png", fullPage: true });
const token = login.session.accessToken;
const chats = await fetch(`${BASE}/api/chat?action=conversations`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
const orders = await fetch(`${BASE}/api/orders`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
console.log(
  JSON.stringify(
    {
      ...info,
      apiConvs: (chats.conversations || []).length,
      apiOrders: (orders.orders || orders.items || []).length,
    },
    null,
    2
  )
);
await browser.close();
