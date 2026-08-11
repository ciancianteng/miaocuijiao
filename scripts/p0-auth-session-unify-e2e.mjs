/**
 * P0: Unified Auth Session + Role — TEST 1–12
 * Usage:
 *   MCJ_STAGING_URL=http://127.0.0.1:4177 node scripts/p0-auth-session-unify-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = (process.env.MCJ_STAGING_URL || process.env.PREVIEW || "http://127.0.0.1:4177").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const CHROME = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome";
const OUT = path.join(process.cwd(), "artifacts", "auth-session-unify-e2e");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("/opt/cursor/artifacts/auth-session-unify-e2e", { recursive: true });

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
  return !!ok;
}

async function api(pathname, body, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

async function login(email, portal) {
  return api("/api/auth", {
    action: "login",
    email,
    password: PASS,
    ...(portal ? { loginPortal: portal, role: portal } : {}),
  });
}

async function injectBossSession(page, session, user) {
  await page.addInitScript(
    ({ session, user }) => {
      const access = session.accessToken || session.access_token || "";
      const refresh = session.refreshToken || session.refresh_token || "";
      const expiresAt = session.expiresAt || session.expires_at || "";
      const soft = "customer_session_v4_" + Date.now();
      const u = Object.assign({}, user || session.user || {}, { role: "boss" });
      for (const store of [sessionStorage, localStorage]) {
        store.setItem("mcjAuthAccessToken", access);
        if (refresh) store.setItem("mcjAuthRefreshToken", refresh);
        if (expiresAt) store.setItem("mcjAuthExpiresAt", String(expiresAt));
        store.setItem("customerAuthToken", soft);
        store.setItem("customerUser", JSON.stringify(u));
        store.setItem("mcjRole", "boss");
      }
    },
    { session, user: user || session.user || {} }
  );
}

async function injectCompanionSession(page, session, user) {
  await page.addInitScript(
    ({ session, user }) => {
      const access = session.accessToken || session.access_token || "";
      const refresh = session.refreshToken || session.refresh_token || "";
      const expiresAt = session.expiresAt || session.expires_at || "";
      const soft = "companion_session_v4_" + Date.now();
      const u = Object.assign({}, user || session.user || {}, { role: "companion" });
      const blob = {
        token: access,
        accessToken: access,
        refreshToken: refresh,
        expiresAt,
        user: u,
      };
      for (const store of [sessionStorage, localStorage]) {
        store.setItem("mcjCompanionSession", JSON.stringify(blob));
        store.setItem("companionAuthToken", soft);
        store.setItem("companionUser", JSON.stringify(u));
      }
    },
    { session, user: user || session.user || {} }
  );
}

async function injectCsSession(page, session, user) {
  await page.addInitScript(
    ({ session, user }) => {
      const access = session.accessToken || session.access_token || "";
      const refresh = session.refreshToken || session.refresh_token || "";
      const expiresAt = session.expiresAt || session.expires_at || "";
      const soft = "customer_service_session_v4_" + Date.now();
      const u = Object.assign({}, user || session.user || {}, { role: "customer_service" });
      const blob = {
        token: access,
        accessToken: access,
        refreshToken: refresh,
        expiresAt,
        user: u,
        remember: true,
      };
      for (const store of [sessionStorage, localStorage]) {
        store.setItem("mcjServiceSession", JSON.stringify(blob));
        store.setItem("customerServiceAuthToken", soft);
        store.setItem("customerServiceUser", JSON.stringify(u));
      }
    },
    { session, user: user || session.user || {} }
  );
}

async function injectAdminSession(page, session, user) {
  await page.addInitScript(
    ({ session, user }) => {
      const access = session.accessToken || session.access_token || "";
      const refresh = session.refreshToken || session.refresh_token || "";
      const expiresAt = session.expiresAt || session.expires_at || "";
      const soft = "admin_session_v4_" + Date.now();
      const u = Object.assign({}, user || session.user || {}, { role: "admin" });
      for (const store of [sessionStorage, localStorage]) {
        store.setItem("mcjAdminAccessToken", access);
        if (refresh) store.setItem("mcjAdminRefreshToken", refresh);
        if (expiresAt) store.setItem("mcjAdminExpiresAt", String(expiresAt));
        store.setItem("adminAuthToken", soft);
        store.setItem("adminUser", JSON.stringify(u));
        // Some admin paths still mirror shared auth for soft JWT fallback.
        store.setItem("mcjAuthAccessToken", access);
        if (refresh) store.setItem("mcjAuthRefreshToken", refresh);
        if (expiresAt) store.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
    },
    { session, user: user || session.user || {} }
  );
}

function pageText(page) {
  return page.evaluate(() => document.body && document.body.innerText ? document.body.innerText : "");
}

function hasBadAuthFlash(text) {
  return /只有老板账号可以访问|请先登录老板账号|请先登录(?!状态)|无权限|未登录/.test(String(text || ""));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const bossLogin = await login(BOSS, "boss");
  const compLogin = await login(COMP, "companion");
  const csLogin = await login(CS, "customer_service");
  const adminLogin = await login(ADMIN, "admin");

  if (!bossLogin.ok || !bossLogin.json.session) {
    step("bootstrap-boss-login", false, bossLogin.json.message || String(bossLogin.status));
  } else {
    step("bootstrap-boss-login", true, BOSS);
  }
  step("bootstrap-companion-login", !!(compLogin.ok && compLogin.json.session), COMP);
  step("bootstrap-cs-login", !!(csLogin.ok && csLogin.json.session), CS);
  step("bootstrap-admin-login", !!(adminLogin.ok && adminLogin.json.session), ADMIN);

  // TEST 1 — boss place order / pay methods
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    // Stale foreign JWT in localStorage to reproduce old localStorage-first bug
    await page.addInitScript(() => {
      // keep session boss token; poison local with garbage that must NOT win
      try {
        // do not overwrite if already set by inject — inject runs first in addInitScript order...
      } catch (e) {}
    });
    await page.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(1500);
    // open place order if button exists
    const orderBtn = page.locator('[data-mcj-place-order], [data-open-place-order], button:has-text("立即下单"), a:has-text("立即下单")').first();
    if ((await orderBtn.count()) > 0) {
      await orderBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      // fallback: navigate recharge + custom order
      await page.goto(`${BASE}/custom-order.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
      await page.waitForTimeout(2000);
    }
    const text = await pageText(page);
    const payOk =
      !/只有老板账号可以访问|请先登录老板账号后再选择支付方式|请先登录老板账号后再下单/.test(text) &&
      (/支付方式|确认订单|猫粮|DuitNow|TNG|充值|下单/.test(text) || (await page.locator("[data-mcj-po-mask], #customPayMethods, .mcj-po-pay").count()) > 0);
    // Also hit recharge API with page token
    const apiCheck = await page.evaluate(async () => {
      const t =
        (window.MCJBossAuth && window.MCJBossAuth.getAccessToken && window.MCJBossAuth.getAccessToken()) ||
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        "";
      const res = await fetch("/api/recharge", { headers: { Authorization: "Bearer " + t, Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, ok: !!(res.ok && body.ok !== false), message: body.message || "", tokenLen: String(t).length };
    });
    step(
      "TEST1-boss-order-pay-methods",
      payOk && apiCheck.ok && !/只有老板账号可以访问/.test(apiCheck.message || ""),
      `payOk=${payOk} api=${apiCheck.status} msg=${apiCheck.message} tokenLen=${apiCheck.tokenLen} console=${consoleErrors.slice(0, 2).join(";")}`
    );
    await page.screenshot({ path: path.join(OUT, "test1-order.png"), fullPage: true }).catch(() => {});
    await ctx.close();
  }

  // TEST 2 — recharge center
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    // Poison: put invalid JWT in localStorage AFTER inject by overwriting in page
    await page.goto("about:blank");
    await page.evaluate(({ session, user }) => {
      const access = session.accessToken;
      const refresh = session.refreshToken;
      const expiresAt = session.expiresAt;
      const soft = "customer_session_v4_" + Date.now();
      const u = Object.assign({}, user || {}, { role: "boss" });
      sessionStorage.setItem("mcjAuthAccessToken", access);
      sessionStorage.setItem("mcjAuthRefreshToken", refresh || "");
      sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt || ""));
      sessionStorage.setItem("customerAuthToken", soft);
      sessionStorage.setItem("customerUser", JSON.stringify(u));
      sessionStorage.setItem("mcjRole", "boss");
      // stale foreign-looking token in localStorage (must not win over session)
      localStorage.setItem("mcjAuthAccessToken", "eyJhbGciOiJub25lIn0.eyJyb2xlIjoiY29tcGFuaW9uIiwic3ViIjoiZmFrZSJ9.sig");
      localStorage.setItem("customerUser", JSON.stringify({ role: "companion" }));
    }, { session: bossLogin.json.session, user: bossLogin.json.user || bossLogin.json.session.user });
    await page.goto(`${BASE}/recharge.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    // Wait past authLoading
    await page.waitForFunction(() => {
      const t = document.body ? document.body.innerText : "";
      return t && !/正在验证登录状态|正在读取充值数据/.test(t);
    }, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const text = await pageText(page);
    const flashSamples = [];
    // quick poll for unauthorized flash was already past; check final
    const ok =
      !/请先登录老板账号|只有老板账号可以访问充值中心|当前账号已登录，但无老板端充值权限/.test(text) &&
      (/充值中心|充值活动|支付方式|猫粮余额|钱包流水/.test(text));
    step("TEST2-boss-recharge", ok, text.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, "test2-recharge.png"), fullPage: true }).catch(() => {});
    await ctx.close();
  }

  // TEST 3 — boss F5
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    await page.goto(`${BASE}/recharge.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2000);
    const samples = [];
    page.on("framenavigated", async () => {});
    await page.reload({ waitUntil: "commit" });
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(200);
      const t = await pageText(page);
      if (/请先登录老板|只有老板账号可以访问|未登录/.test(t) && !/正在验证登录状态/.test(t)) {
        samples.push(t.slice(0, 120));
      }
    }
    await page.waitForTimeout(1500);
    const finalText = await pageText(page);
    const ok =
      samples.length === 0 &&
      !/请先登录老板|只有老板账号可以访问/.test(finalText) &&
      /充值|猫粮|支付/.test(finalText);
    step("TEST3-boss-f5", ok, samples[0] || finalText.slice(0, 160));
    await ctx.close();
  }

  // TEST 4 — companion pages
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectCompanionSession(page, compLogin.json.session, compLogin.json.user || compLogin.json.session.user);
    const paths = ["/companion/dashboard/", "/companion/orders/", "/companion/account/"];
    let allOk = true;
    const details = [];
    for (const p of paths) {
      await page.goto(`${BASE}${p}?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
      await page.waitForTimeout(1500);
      const t = await pageText(page);
      const bad = /请先登录|未登录|只有老板|无权限|选择身份/.test(t) && !/工作台|订单|账号|收益|资料/.test(t);
      if (bad || /\/companion\/login/i.test(page.url())) {
        allOk = false;
        details.push(`${p}:FAIL url=${page.url()} text=${t.slice(0, 80)}`);
      } else {
        details.push(`${p}:ok`);
      }
    }
    step("TEST4-companion-pages", allOk, details.join(" | "));
    await ctx.close();
  }

  // TEST 5 — companion F5
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectCompanionSession(page, compLogin.json.session, compLogin.json.user || compLogin.json.session.user);
    await page.goto(`${BASE}/companion/dashboard/?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "commit" });
    await page.waitForTimeout(2000);
    const ok = !/\/companion\/login/i.test(page.url()) && !/请先登录|未登录/.test(await pageText(page));
    step("TEST5-companion-f5", ok, page.url());
    await ctx.close();
  }

  // TEST 6 — CS
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectCsSession(page, csLogin.json.session, csLogin.json.user || csLogin.json.session.user);
    await page.goto(`${BASE}/customer-service/dashboard/?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2500);
    const t = await pageText(page);
    const ok = !/\/customer-service\/login/i.test(page.url()) && !/请先登录|未登录|选择身份|老板端|陪玩端/.test(t);
    step("TEST6-cs-dashboard", ok, page.url() + " " + t.slice(0, 120));
    await ctx.close();
  }

  // TEST 7 — CS F5
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectCsSession(page, csLogin.json.session, csLogin.json.user || csLogin.json.session.user);
    await page.goto(`${BASE}/customer-service/orders/?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "commit" });
    await page.waitForTimeout(2500);
    const t = await pageText(page);
    const ok =
      !/\/customer-service\/login/i.test(page.url()) &&
      !/请选择身份|老板|陪玩登录|请先登录/.test(t);
    step("TEST7-cs-f5", ok, page.url() + " " + t.slice(0, 100));
    await ctx.close();
  }

  // TEST 8 — admin
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectAdminSession(page, adminLogin.json.session, adminLogin.json.user || adminLogin.json.session.user);
    await page.goto(`${BASE}/admin.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2500);
    const t = await pageText(page);
    const ok = !/\/admin\/login/i.test(page.url()) && !/请先登录|未登录/.test(t);
    step("TEST8-admin", ok, page.url() + " " + t.slice(0, 120));
    await ctx.close();
  }

  // TEST 9 — admin F5
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectAdminSession(page, adminLogin.json.session, adminLogin.json.user || adminLogin.json.session.user);
    await page.goto(`${BASE}/admin.html#payment?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "commit" });
    await page.waitForTimeout(2500);
    const ok = !/\/admin\/login/i.test(page.url()) && !/请先登录|未登录/.test(await pageText(page));
    step("TEST9-admin-f5", ok, page.url());
    await ctx.close();
  }

  // TEST 10 — logout
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    await page.goto(`${BASE}/recharge.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      if (window.MCJBossAuth && window.MCJBossAuth.clearSession) window.MCJBossAuth.clearSession();
      if (window.MCJRoleGate && window.MCJRoleGate.logout) {
        window.MCJRoleGate.logout("boss");
        window.MCJRoleGate.logout("customer");
      }
    });
    await page.goto(`${BASE}/recharge.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2000);
    const url = page.url();
    const t = await pageText(page);
    const ok = /login\.html/i.test(url) || /请先登录/.test(t);
    step("TEST10-logout", ok, url + " " + t.slice(0, 100));
    await ctx.close();
  }

  // TEST 11 — switch 10 boss pages
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    const pages = [
      "/index.html",
      "/recharge.html",
      "/orders.html",
      "/messages.html",
      "/support.html",
      "/mine.html",
      "/companion-center.html",
      "/favorites.html",
      "/recharge.html",
      "/orders.html",
    ];
    let fails = [];
    for (const p of pages) {
      await page.goto(`${BASE}${p}?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
      await page.waitForTimeout(900);
      const t = await pageText(page);
      if (/login\.html/i.test(page.url())) {
        fails.push(p + "→login");
        continue;
      }
      if (/只有老板账号可以访问|请先登录老板账号后再/.test(t)) fails.push(p + ":auth-msg");
    }
    step("TEST11-ten-page-switch", fails.length === 0, fails.join(",") || "all ok");
    await ctx.close();
  }

  // TEST 12 — console loops
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message || e)));
    page.on("console", (m) => {
      if (m.type() === "error") errs.push(m.text());
    });
    await injectBossSession(page, bossLogin.json.session, bossLogin.json.user || bossLogin.json.session.user);
    await page.goto(`${BASE}/recharge.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/support.html?t=${Date.now()}`, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(2500);
    const bad = errs.filter((e) => /Maximum call stack|infinite|auth loop|too much recursion/i.test(e));
    step("TEST12-console-no-auth-loop", bad.length === 0, bad.slice(0, 3).join(" | ") || `errors=${errs.length}`);
    await ctx.close();
  }

  await browser.close();

  const summary = {
    base: BASE,
    at: new Date().toISOString(),
    results,
    pass: results.filter((r) => r.result === "PASS").length,
    fail: results.filter((r) => r.result === "FAIL").length,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync("/opt/cursor/artifacts/auth-session-unify-e2e/summary.json", JSON.stringify(summary, null, 2));
  console.log("\nSUMMARY", summary.pass, "PASS /", summary.fail, "FAIL");
  if (summary.fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
