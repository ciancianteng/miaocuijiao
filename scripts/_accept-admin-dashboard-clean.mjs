/**
 * Mobile admin console acceptance: before (live prod) + after (local assets routed over www).
 * Uses TEMP_PASSWORD.local.txt — never prints password.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-admin-dashboard-clean");
fs.mkdirSync(outDir, { recursive: true });

const secretFile = path.join(root, "artifacts/p0-admin-login-fail/TEMP_PASSWORD.local.txt");
if (!fs.existsSync(secretFile)) throw new Error("missing TEMP_PASSWORD.local.txt");
const secretLines = fs.readFileSync(secretFile, "utf8").split(/\r?\n/);
const email = (secretLines.find((l) => l.startsWith("email=")) || "").slice(6).trim();
const password = (secretLines.find((l) => l.startsWith("password=")) || "").slice(9).trim();
if (!email || !password) throw new Error("email/password missing");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "https://www.meowcuijiao.com";

const PLACEHOLDER_RE = /待办统计暂未接入|暂无待办统计数据|7日订单趋势|7日营业额趋势|7日平台利润趋势|暂无统计数据|未接入|暂未接入|暂无操作记录/;

async function login(page) {
  await page.goto(`${BASE}/admin/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('[data-admin-login] input[name="account"]', email);
  await page.fill('[data-admin-login] input[name="password"]', password);
  await page.click('[data-admin-login] button[type="submit"]');
  await page.waitForURL(/\/admin(\.html|\/|$)/i, { timeout: 45000 });
  await page.waitForTimeout(1200);
}

async function dashboardProbe(page) {
  await page.goto(`${BASE}/admin.html#dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const dash = document.getElementById("section-dashboard");
    const text = dash ? dash.innerText || "" : "";
    return {
      url: location.href,
      hasPending: !!document.getElementById("dashboardPending"),
      hasLogs: !!document.getElementById("table-admin_logs"),
      hasTrends: !!document.querySelector(".dashboard-trends"),
      hasSuperStats: !!document.getElementById("superStats"),
      statCards: document.querySelectorAll("#superStats .admin-final-stat").length,
      placeholderHit: re.test(text),
      snippet: text.slice(0, 600),
    };
  }, PLACEHOLDER_RE.source);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await login(page);
const before = await dashboardProbe(page);
await page.screenshot({ path: path.join(outDir, "01-before-mobile-console.png"), fullPage: true });

// Route fixed local assets while staying on www (real dashboard API).
const localMap = {
  "/admin.html": path.join(root, "admin.html"),
  "/src/admin-suite.js": path.join(root, "src/admin-suite.js"),
  "/src/admin-final-v1.js": path.join(root, "src/admin-final-v1.js"),
  "/src/admin-final-v1.css": path.join(root, "src/admin-final-v1.css"),
  "/src/admin-layout.css": path.join(root, "src/admin-layout.css"),
};
await page.route("**/*", async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.origin !== BASE) return route.continue();
  const key = Object.keys(localMap).find((k) => u.pathname === k || u.pathname.startsWith(k.split("?")[0]));
  // Match pathname ignoring query
  const pathname = u.pathname;
  const hit = localMap[pathname];
  if (!hit || !fs.existsSync(hit)) return route.continue();
  const body = fs.readFileSync(hit);
  const ext = path.extname(hit);
  const type =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : "application/javascript; charset=utf-8";
  return route.fulfill({ status: 200, contentType: type, body });
});

await page.goto(`${BASE}/admin.html#dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2800);
const after = await dashboardProbe(page);
await page.screenshot({ path: path.join(outDir, "02-after-mobile-console.png"), fullPage: true });
await page.screenshot({ path: path.join(outDir, "03-after-mobile-console-viewport.png"), fullPage: false });

await browser.close();

const report = {
  at: new Date().toISOString(),
  base: BASE,
  viewport: "390x844",
  before,
  after,
  pass:
    after.hasSuperStats === true &&
    after.statCards > 0 &&
    after.hasPending === false &&
    after.hasLogs === false &&
    after.hasTrends === false &&
    after.placeholderHit === false,
  shots: [
    "01-before-mobile-console.png",
    "02-after-mobile-console.png",
    "03-after-mobile-console-viewport.png",
  ],
};
fs.writeFileSync(path.join(outDir, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
