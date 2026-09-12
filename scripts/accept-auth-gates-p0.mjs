/**
 * P0 auth gate acceptance — unauth redirects, soft-token denial, login/logout.
 * Usage: node scripts/accept-auth-gates-p0.mjs [baseUrl]
 * Never prints passwords or tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const which = execSync("where chrome", { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
    if (which && fs.existsSync(which)) return which;
  } catch {}
  return null;
}

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = (process.argv[2] || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const ACCOUNTS = {
  boss: "boss@meow.test",
  customer_service: "service@meow.test",
  companion: "companion@meow.test",
  admin: "admin@meow.test",
};

const UNAUTH_CASES = [
  { name: "companion_root", url: "/companion/", expect: /\/companion\/login/i },
  { name: "companion_dashboard", url: "/companion/dashboard/", expect: /\/companion\/login/i },
  { name: "companion_orders", url: "/companion/orders/", expect: /\/companion\/login/i },
  { name: "cs_root", url: "/customer-service/", expect: /\/customer-service\/login/i },
  { name: "cs_dashboard", url: "/customer-service/dashboard/", expect: /\/customer-service\/login/i },
  { name: "admin_root", url: "/admin/", expect: /\/admin\/login/i },
  { name: "admin_html", url: "/admin.html", expect: /\/admin\/login/i },
  { name: "admin_dashboard_legacy", url: "/admin-dashboard.html", expect: /\/admin\/login|\/admin\.html/i },
  { name: "boss_mine", url: "/mine.html", expect: /\/login\.html/i },
  { name: "boss_orders", url: "/orders.html", expect: /\/login\.html/i },
];

function verdict(ok) {
  return ok ? "PASS" : "FAIL";
}

async function loginApi(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) {
    throw new Error(`${email}: ${body.message || res.status}`);
  }
  return body.session;
}

async function main() {
  const chrome = resolveChrome();
  if (!chrome) {
    console.error("Chrome/Edge not found");
    process.exit(2);
  }

  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
  });

  const results = {
    companion: "FAIL",
    customer_service: "FAIL",
    admin: "FAIL",
    boss: "FAIL",
    softTokenDenied: "FAIL",
    wrongPassword: "FAIL",
    details: [],
  };

  // 1) Unauth deep links — fresh context each time
  let unauthOk = true;
  for (const c of UNAUTH_CASES) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    const ok = c.expect.test(finalUrl);
    results.details.push({ case: c.name, ok, finalUrl });
    if (!ok) unauthOk = false;
    await ctx.close();
  }

  // Soft-token-only must NOT unlock admin/companion
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("adminAuthToken", "admin_session_v4_fake");
      localStorage.setItem("adminUser", JSON.stringify({ role: "admin", adminRole: "admin", permissions: ["admin"] }));
      localStorage.setItem("mcjRole", "admin");
      localStorage.setItem("companionAuthToken", "companion_session_v4_fake");
      localStorage.setItem("companionUser", JSON.stringify({ role: "companion" }));
      localStorage.setItem("mcjCompanionSession", JSON.stringify({ token: "not-a-jwt", user: { role: "companion" } }));
      localStorage.setItem("customerServiceAuthToken", "customer_service_session_v4_fake");
      localStorage.setItem("mcjServiceSession", JSON.stringify({ token: "not-a-jwt", user: { role: "customer_service" } }));
      localStorage.setItem("customerAuthToken", "customer_session_v4_fake");
      localStorage.setItem("customerUser", JSON.stringify({ role: "boss" }));
    });
    const softCases = [
      { url: "/admin/", expect: /\/admin\/login/i },
      { url: "/companion/", expect: /\/companion\/login/i },
      { url: "/customer-service/", expect: /\/customer-service\/login/i },
      { url: "/mine.html", expect: /\/login\.html/i },
    ];
    let softOk = true;
    for (const c of softCases) {
      await page.goto(BASE + c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(600);
      if (!c.expect.test(page.url())) softOk = false;
    }
    results.softTokenDenied = verdict(softOk);
    await ctx.close();
  }

  // Wrong password
  {
    const res = await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "login", email: ACCOUNTS.admin, password: "definitely-wrong-password" }),
    });
    const body = await res.json().catch(() => ({}));
    results.wrongPassword = verdict(!res.ok || body.ok === false);
  }

  // Per-portal: login → enter → logout → cannot reopen
  async function portalFlow(role, loginPath, homePath, loginExpect) {
    const session = await loginApi(ACCOUNTS[role] || ACCOUNTS.boss);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ role, session }) => {
        const keys = [
          "customerAuthToken",
          "customerUser",
          "customerServiceAuthToken",
          "customerServiceUser",
          "mcjServiceSession",
          "companionAuthToken",
          "companionUser",
          "mcjCompanionSession",
          "adminAuthToken",
          "adminUser",
          "mcjAuthAccessToken",
          "mcjAuthRefreshToken",
          "mcjAuthExpiresAt",
          "mcjRole",
        ];
        keys.forEach((k) => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
        const user = Object.assign({}, session.user || {}, { role: session.user?.role || role });
        localStorage.setItem("mcjRole", user.role);
        localStorage.setItem("mcjAuthAccessToken", session.accessToken || "");
        if (session.refreshToken) localStorage.setItem("mcjAuthRefreshToken", session.refreshToken);
        if (session.expiresAt) localStorage.setItem("mcjAuthExpiresAt", String(session.expiresAt));
        if (role === "admin") {
          localStorage.setItem("adminAuthToken", "admin_session_v4_" + Date.now());
          localStorage.setItem(
            "adminUser",
            JSON.stringify(
              Object.assign({}, user, {
                adminRole: user.role === "super_admin" ? "super_admin" : "admin",
                permissions: [user.role === "super_admin" ? "super_admin" : "admin"],
              })
            )
          );
        } else if (role === "companion") {
          localStorage.setItem("companionAuthToken", "companion_session_v4_" + Date.now());
          localStorage.setItem("companionUser", JSON.stringify(user));
          localStorage.setItem(
            "mcjCompanionSession",
            JSON.stringify({
              token: session.accessToken,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken || "",
              expiresAt: session.expiresAt || "",
              user,
            })
          );
        } else if (role === "customer_service") {
          localStorage.setItem("customerServiceAuthToken", "customer_service_session_v4_" + Date.now());
          localStorage.setItem("customerServiceUser", JSON.stringify(user));
          localStorage.setItem(
            "mcjServiceSession",
            JSON.stringify({
              token: session.accessToken,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken || "",
              expiresAt: session.expiresAt || "",
              user,
            })
          );
        } else {
          localStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
          localStorage.setItem("customerUser", JSON.stringify(user));
        }
      },
      { role, session }
    );
    await page.goto(BASE + homePath, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1000);
    const entered = loginExpect.test(page.url()) === false && !/\/login/i.test(page.url());
    // Clear like logout
    await page.evaluate(() => {
      const keys = [
        "customerAuthToken",
        "customerUser",
        "customerServiceAuthToken",
        "customerServiceUser",
        "mcjServiceSession",
        "companionAuthToken",
        "companionUser",
        "mcjCompanionSession",
        "adminAuthToken",
        "adminUser",
        "mcjAuthAccessToken",
        "mcjAuthRefreshToken",
        "mcjAuthExpiresAt",
        "mcjRole",
      ];
      keys.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    });
    await page.goto(BASE + homePath, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    const blockedAfterLogout = loginExpect.test(page.url());
    await ctx.close();
    return entered && blockedAfterLogout;
  }

  try {
    results.admin = verdict(await portalFlow("admin", "/admin/login/", "/admin/", /\/admin\/login/i));
  } catch (e) {
    results.details.push({ case: "admin_flow", error: String(e.message || e) });
  }
  try {
    results.companion = verdict(
      await portalFlow("companion", "/companion/login/", "/companion/dashboard/", /\/companion\/login/i)
    );
  } catch (e) {
    results.details.push({ case: "companion_flow", error: String(e.message || e) });
  }
  try {
    results.customer_service = verdict(
      await portalFlow(
        "customer_service",
        "/customer-service/login/",
        "/customer-service/dashboard/",
        /\/customer-service\/login/i
      )
    );
  } catch (e) {
    results.details.push({ case: "cs_flow", error: String(e.message || e) });
  }
  try {
    results.boss = verdict(await portalFlow("boss", "/login.html", "/mine.html", /\/login\.html/i));
  } catch (e) {
    results.details.push({ case: "boss_flow", error: String(e.message || e) });
  }

  // Fold unauth into portal scores if needed
  if (!unauthOk) {
    results.companion = "FAIL";
    results.customer_service = "FAIL";
    results.admin = "FAIL";
    results.boss = "FAIL";
  }

  await browser.close();

  const summary = {
    base: BASE,
    老板端: results.boss,
    客服端: results.customer_service,
    陪玩端: results.companion,
    后台: results.admin,
    softTokenDenied: results.softTokenDenied,
    wrongPassword: results.wrongPassword,
    unauthAll: verdict(unauthOk),
    details: results.details,
  };
  console.log(JSON.stringify(summary, null, 2));
  const allPass =
    results.boss === "PASS" &&
    results.customer_service === "PASS" &&
    results.companion === "PASS" &&
    results.admin === "PASS" &&
    results.softTokenDenied === "PASS" &&
    results.wrongPassword === "PASS" &&
    unauthOk;
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
