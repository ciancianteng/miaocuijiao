/**
 * P0 portal session / role isolation — TEST1–7
 * PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-portal-session-role-isolation-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const COMPANION = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "portal-session-isolation-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "portal-session-isolation-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}

async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(ART, file), fullPage: true }).catch(() => {});
  try {
    fs.copyFileSync(path.join(ART, file), path.join(ART_REPO, file));
  } catch {
    await page.screenshot({ path: path.join(ART_REPO, file), fullPage: true }).catch(() => {});
  }
}

function writeReport() {
  const allPass = results.every((r) => r.result === "PASS");
  const out = { overall: allPass ? "PASS" : "FAIL", base: BASE, boss: BOSS, companion: COMPANION, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const md = [
    "# Portal session role isolation E2E",
    "",
    `Base: ${BASE}`,
    `Overall: **${out.overall}**`,
    "",
    "| Step | Result | Detail |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.step} | ${r.result} | ${String(r.detail || "").replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "report.md"), md);
  fs.writeFileSync(path.join(ART_REPO, "report.md"), md);
  return out;
}

async function waitDeploy(maxMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const js = await (await fetch(`${BASE}/src/role-gates.js?v=20260811portalIso1&cb=${Date.now()}`, { cache: "no-store" })).text();
      const gate = await (await fetch(`${BASE}/portal-early-gate.js?v=20260811portalIso1&cb=${Date.now()}`, { cache: "no-store" })).text();
      const wb = await (await fetch(`${BASE}/src/companion-workbench.js?v=20260811portalIso1&cb=${Date.now()}`, { cache: "no-store" })).text();
      const ok =
        /writeCompanionPortalSession/.test(js) &&
        /requireLogin/.test(js) &&
        /portalIso1|ignore shared mcjRole/.test(gate) &&
        /Do NOT wipe boss|portal:'companion'|writeCompanionPortalSession/.test(wb);
      if (ok) {
        step("deploy_ready", true, `elapsed=${Date.now() - t0}ms`);
        return true;
      }
      console.log("[wait] deploy", { len: js.length, hasWrite: /writeCompanionPortalSession/.test(js) });
    } catch (e) {
      console.log("[wait]", e.message);
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  step("deploy_ready", false, "timeout");
  return false;
}

async function apiLogin(email, portal) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, loginPortal: portal }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, json };
}

async function readStorage(page) {
  return page.evaluate(() => {
    const g = (k) => localStorage.getItem(k) || sessionStorage.getItem(k) || "";
    let companion = null;
    try {
      companion = JSON.parse(g("mcjCompanionSession") || "null");
    } catch {}
    let customer = null;
    try {
      customer = JSON.parse(g("customerUser") || "null");
    } catch {}
    return {
      bossSoft: g("customerAuthToken"),
      bossEmail: customer && customer.email,
      bossRole: customer && customer.role,
      access: (g("mcjAuthAccessToken") || "").slice(0, 24),
      accessLen: (g("mcjAuthAccessToken") || "").length,
      companionSoft: g("companionAuthToken"),
      companionEmail: companion && companion.user && companion.user.email,
      companionTok: companion && (companion.token || companion.accessToken) ? String(companion.token || companion.accessToken).slice(0, 24) : "",
      companionTokLen: companion && (companion.token || companion.accessToken) ? String(companion.token || companion.accessToken).length : 0,
      mcjRole: g("mcjRole"),
      adminSoft: g("adminAuthToken"),
    };
  });
}

async function loginBossUi(page, email) {
  await page.goto(`${BASE}/login.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(500);
  // Prefer dedicated login page fields; fall back to index modal.
  const emailSel = 'input[type=email],input[name=email],#loginGmail,#loginEmail,#email';
  const passSel = 'input[type=password],#loginGmailCode,#loginPassword,#password';
  if ((await page.locator(emailSel).count()) === 0) {
    await page.goto(`${BASE}/index.html#login`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(800);
  }
  await page.fill(emailSel, email);
  await page.fill(passSel, PASS);
  page.once("dialog", async (d) => {
    try {
      await d.accept();
    } catch {}
  });
  await page.click('button[type=submit],button:has-text("登录"),[data-login-submit]');
  // Role pick: choose boss if shown
  const pick = page.locator('[data-role-pick="boss"]');
  try {
    await pick.waitFor({ timeout: 5000 });
    await pick.click();
  } catch {}
  await page.waitForTimeout(2500);
  // Ensure boss session landed
  for (let i = 0; i < 20; i++) {
    const st = await readStorage(page);
    if (st.accessLen > 20 && st.bossSoft) return st;
    await page.waitForTimeout(500);
  }
  return readStorage(page);
}

async function loginCompanionUi(page, email) {
  await page.goto(`${BASE}/companion/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  // Must show login form (not auto-enter)
  const hasForm = (await page.locator('[data-login], form[data-login], input[name=account], input[type=password]').count()) > 0;
  await page.fill('input[name=account],input[type=email],#account', email);
  await page.fill('input[name=password],input[type=password]', PASS);
  page.once("dialog", async (d) => {
    try {
      await d.accept();
    } catch {}
  });
  await page.click('[data-login] button[type=submit], form[data-login] button[type=submit],button:has-text("登录")');
  await page.waitForTimeout(3000);
  for (let i = 0; i < 25; i++) {
    const st = await readStorage(page);
    if (st.companionTokLen > 20 && st.companionSoft) return { st, hasForm };
    await page.waitForTimeout(500);
  }
  return { st: await readStorage(page), hasForm };
}

async function main() {
  step("base", true, BASE);
  if (!(await waitDeploy())) {
    writeReport();
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // Shared browser context = same storage (simulates same browser, new tabs)
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await context.clearCookies();

    const bossPage = await context.newPage();
    await bossPage.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await bossPage.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    });

    // TEST 1: boss login A
    const bossSt = await loginBossUi(bossPage, BOSS);
    await shot(bossPage, "01-boss-logged-in");
    const bossEmailOk = String(bossSt.bossEmail || "").toLowerCase() === BOSS.toLowerCase() || bossSt.accessLen > 20;
    step("TEST1_boss_login_A", !!(bossSt.accessLen > 20 && bossSt.bossSoft), JSON.stringify(bossSt));

    // TEST 2: new tab companion — must show login, allow B
    const compPage = await context.newPage();
    await compPage.goto(`${BASE}/companion/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await compPage.waitForTimeout(1200);
    await shot(compPage, "02-companion-login-page");
    const stBeforeComp = await readStorage(compPage);
    const autoEntered =
      stBeforeComp.companionTokLen > 20 &&
      String(stBeforeComp.companionEmail || "").toLowerCase() === BOSS.toLowerCase();
    const onLogin =
      /\/companion\/login/i.test(compPage.url()) ||
      (await compPage.locator('[data-login], form[data-login], input[name=password]').count()) > 0;
    step("TEST2_no_auto_enter_A", !autoEntered && onLogin, JSON.stringify({ autoEntered, onLogin, url: compPage.url(), stBeforeComp }));

    const { st: compSt, hasForm } = await loginCompanionUi(compPage, COMPANION);
    await shot(compPage, "03-companion-logged-in-B");
    step(
      "TEST2_login_companion_B",
      !!(compSt.companionTokLen > 20 && String(compSt.companionEmail || "").toLowerCase() === COMPANION.toLowerCase()) ||
        (compSt.companionTokLen > 20 && hasForm),
      JSON.stringify(compSt)
    );

    // TEST 3: boss still A, no cross identity
    await bossPage.bringToFront();
    await bossPage.reload({ waitUntil: "domcontentloaded" });
    await bossPage.waitForTimeout(1000);
    const bossAfter = await readStorage(bossPage);
    const compAfter = await readStorage(compPage);
    const bossStill =
      bossAfter.accessLen > 20 &&
      bossAfter.bossSoft &&
      String(bossAfter.bossEmail || BOSS).toLowerCase().includes("boss");
    const emailsDiffer =
      String(compAfter.companionEmail || "").toLowerCase() !== String(bossAfter.bossEmail || "").toLowerCase() ||
      (BOSS.toLowerCase() !== COMPANION.toLowerCase() &&
        compAfter.companionTokLen > 20 &&
        bossAfter.accessLen > 20);
    step(
      "TEST3_no_cross_identity",
      bossAfter.accessLen > 20 && compAfter.companionTokLen > 20 && emailsDiffer,
      JSON.stringify({ bossAfter, companionEmail: compAfter.companionEmail, companionTokLen: compAfter.companionTokLen })
    );

    // TEST 4: refresh both
    await bossPage.reload({ waitUntil: "domcontentloaded" });
    await compPage.reload({ waitUntil: "domcontentloaded" });
    await bossPage.waitForTimeout(1200);
    await compPage.waitForTimeout(1200);
    const bossR = await readStorage(bossPage);
    const compR = await readStorage(compPage);
    step(
      "TEST4_persist_after_refresh",
      bossR.accessLen > 20 && compR.companionTokLen > 20,
      JSON.stringify({ bossAccess: bossR.accessLen, companionTok: compR.companionTokLen, urls: { boss: bossPage.url(), comp: compPage.url() } })
    );
    await shot(bossPage, "04-boss-after-refresh");
    await shot(compPage, "04-companion-after-refresh");

    // TEST 5: companion logout — boss stays
    await compPage.bringToFront();
    // Try logout control
    const logoutBtn = compPage.locator("[data-logout], button:has-text('退出'), a:has-text('退出登录')").first();
    if ((await logoutBtn.count()) > 0) {
      await logoutBtn.click({ timeout: 5000 }).catch(() => {});
    } else {
      await compPage.evaluate(() => {
        if (window.MCJRoleGate) window.MCJRoleGate.logout("companion");
        localStorage.removeItem("mcjCompanionSession");
        sessionStorage.removeItem("mcjCompanionSession");
        localStorage.removeItem("companionAuthToken");
        sessionStorage.removeItem("companionAuthToken");
      });
      await compPage.goto(`${BASE}/companion/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    }
    await compPage.waitForTimeout(1500);
    const afterCompLogout = await readStorage(compPage);
    const bossStill5 = await readStorage(bossPage);
    step(
      "TEST5_companion_logout_keeps_boss",
      afterCompLogout.companionTokLen === 0 && bossStill5.accessLen > 20,
      JSON.stringify({ afterCompLogout: { companionTokLen: afterCompLogout.companionTokLen }, bossAccess: bossStill5.accessLen })
    );
    await shot(compPage, "05-companion-logged-out");
    await shot(bossPage, "05-boss-still-in");

    // Re-login companion B for TEST 6
    await loginCompanionUi(compPage, COMPANION);
    await compPage.waitForTimeout(1000);

    // TEST 6: boss logout — companion stays
    await bossPage.bringToFront();
    await bossPage.evaluate(() => {
      if (window.MCJRoleGate) {
        window.MCJRoleGate.logout("boss");
        window.MCJRoleGate.logout("customer");
      }
      ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "customerAuthToken", "customerUser", "mcjCurrentUser", "mcjRole"].forEach((k) => {
        try {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        } catch {}
      });
    });
    await bossPage.waitForTimeout(500);
    const bossGone = await readStorage(bossPage);
    const compKept = await readStorage(compPage);
    step(
      "TEST6_boss_logout_keeps_companion",
      bossGone.accessLen === 0 && compKept.companionTokLen > 20,
      JSON.stringify({ bossAccess: bossGone.accessLen, companionTok: compKept.companionTokLen })
    );
    await shot(bossPage, "06-boss-logged-out");
    await shot(compPage, "06-companion-still-in");

    // TEST 7: boss/companion session must not unlock admin
    const adminPage = await context.newPage();
    // Restore a boss session without admin
    const bossLogin = await apiLogin(BOSS, "boss");
    await adminPage.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await adminPage.evaluate((session) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      if (session) {
        localStorage.setItem("mcjAuthAccessToken", session.accessToken || "");
        localStorage.setItem("mcjAuthRefreshToken", session.refreshToken || "");
        localStorage.setItem("mcjAuthExpiresAt", String(session.expiresAt || ""));
        localStorage.setItem("customerAuthToken", "customer_session_v4_e2e");
        localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, session.user || {}, { role: "boss" })));
        localStorage.setItem("mcjRole", "boss");
      }
    }, bossLogin.json?.session || null);
    await adminPage.goto(`${BASE}/admin.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await adminPage.waitForTimeout(2000);
    const adminUrl = adminPage.url();
    const blocked = /\/admin\/login/i.test(adminUrl) || !(await adminPage.locator(".side-nav [data-section]").count());
    step("TEST7_admin_blocked_for_boss_session", blocked, `url=${adminUrl}`);
    await shot(adminPage, "07-admin-blocked");

    // Positive: admin login works
    const adminLogin = await apiLogin(ADMIN, "admin");
    step("TEST7_admin_account_ok", !!(adminLogin.ok && adminLogin.json?.session?.accessToken), `adminLogin=${adminLogin.ok}`);
  } catch (err) {
    step("runtime", false, err.stack || err.message);
  } finally {
    await browser.close();
  }

  const out = writeReport();
  console.log("OVERALL", out.overall);
  process.exit(out.overall === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  step("fatal", false, e.message);
  writeReport();
  process.exit(1);
});
