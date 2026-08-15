/**
 * Human-like Preview flow: login.html → companion-apply.html on real Vite bundle.
 * Also repro: companion session kept, boss keys cleared by failed ensureSession.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (
  process.env.PREVIEW ||
  "https://meow-cuijiao-homepage-git-cu-323b1d-ciancianteng-4581s-projects.vercel.app"
).replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-boss-header-human-flow-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(path.join(ROOT, "artifacts", "companion-apply-boss-header-human-flow-e2e"), { recursive: true });

function step(name, ok, detail) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${String(detail).slice(0, 1000)}`);
  return { step: name, result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 1200) };
}

async function desk(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("header.mcj-boss-header .mcj-desk-nav");
    const text = (nav?.innerText || "").replace(/\s+/g, " ").trim();
    return {
      text,
      hasMine: /个人中心/.test(text),
      hasLogin: /登录/.test(text) && !/个人中心/.test(text),
      hasLogout: /退出登录/.test(text),
      bodyAuth: document.body.getAttribute("data-mcj-auth"),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
      keys: {
        access: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
        refresh: !!(localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken")),
        companion: !!(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession")),
        customerUser: !!(localStorage.getItem("customerUser") || sessionStorage.getItem("customerUser")),
      },
      apply: (document.getElementById("companionApplyRoot")?.innerText || "").replace(/\s+/g, " ").slice(0, 200),
      nick: document.querySelector('input[name="nickname"]')?.value || "",
      email: document.querySelector('input[name="email"]')?.value || "",
      canRestore: !!(window.MCJBossAuth && window.MCJBossAuth.canRestoreSession && window.MCJBossAuth.canRestoreSession()),
      hasValid: !!(window.MCJBossAuth && window.MCJBossAuth.hasValidAccessToken && window.MCJBossAuth.hasValidAccessToken()),
      syncType: window.MCJBossHeader && typeof window.MCJBossHeader.sync,
    };
  });
}

const results = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// Flow 1: login.html UI → companion-apply
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/login.html`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  // Clear any prior
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Fill login form — try common selectors
  const filled = await page.evaluate(({ email, pass }) => {
    const emailEl =
      document.querySelector('input[type="email"], input[name="email"], input[name="account"], #email, #account') ||
      document.querySelector("input");
    const passEl = document.querySelector('input[type="password"], input[name="password"], #password');
    if (!emailEl || !passEl) return { ok: false, reason: "no inputs", html: document.body.innerText.slice(0, 200) };
    emailEl.focus();
    emailEl.value = email;
    emailEl.dispatchEvent(new Event("input", { bubbles: true }));
    passEl.focus();
    passEl.value = pass;
    passEl.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  }, { email: BOSS, pass: PASS });

  if (!filled.ok) {
    results.push(step("login_page_inputs", false, filled));
  } else {
    // Click password login
    const clicked = await page.evaluate(() => {
      const btn =
        document.querySelector('[data-login-password], [data-auth-login], button[type="submit"]') ||
        [...document.querySelectorAll("button")].find((b) => /登录/.test(b.textContent || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await page.waitForTimeout(4000);
    const afterLogin = await page.evaluate(() => ({
      href: location.href,
      access: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
      refresh: !!(localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken")),
      user: localStorage.getItem("customerUser") || sessionStorage.getItem("customerUser") || "",
      bodyText: document.body.innerText.slice(0, 150),
    }));
    results.push(step("login_html_ Persists_boss_keys", !!(clicked && afterLogin.access && afterLogin.refresh), afterLogin));

    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(3500);
    const d = await desk(page);
    await page.screenshot({ path: path.join(ART, "after-login-html.png"), fullPage: true });
    results.push(step("after_login_html_apply_header", d.hasMine && d.hasLogout && !d.hasLogin, d));
  }
  await page.close();
}

// Flow 2: API login inject → apply-from-boss → new context with ONLY companion session (+ draft)
{
  const login = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: BOSS, password: PASS, loginPortal: "boss", remember: true }),
  }).then((r) => r.json());
  const access = login.session?.accessToken;
  const refresh = login.session?.refreshToken;
  const expiresAt = login.session?.expiresAt;
  const user = login.session?.user || {};

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(
    ({ access, refresh, expiresAt, user, BOSS }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("mcjAuthAccessToken", access);
      sessionStorage.setItem("mcjAuthAccessToken", access);
      localStorage.setItem("mcjAuthRefreshToken", refresh);
      sessionStorage.setItem("mcjAuthRefreshToken", refresh);
      if (expiresAt) localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      localStorage.setItem("mcjRole", "boss");
      const u = Object.assign({ role: "boss", hasBoss: true, roles: ["boss"], email: BOSS, account: BOSS }, user);
      localStorage.setItem("customerUser", JSON.stringify(u));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(u));
      localStorage.setItem("customerAuthToken", "customer_session_v4_flow2");
    },
    { access, refresh, expiresAt, user, BOSS }
  );
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.click("[data-apply-from-boss]");
  await page.waitForTimeout(4000);
  // Seed draft fields
  await page.evaluate(() => {
    const nick = document.querySelector('input[name="nickname"]');
    const email = document.querySelector('input[name="email"]');
    if (nick) {
      nick.value = "真人预览昵称";
      nick.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (email) {
      email.value = "boss.final.1785714993009@meow.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(800);
  const snap = await page.evaluate(() => {
    const raw = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession");
    const drafts = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/mcjCompanionApplicationDraft/i.test(k)) drafts[k] = localStorage.getItem(k);
    }
    return { companion: raw, drafts, customerUser: localStorage.getItem("customerUser") };
  });
  await page.close();

  // New page: ONLY companion + draft + customerUser — NO boss mcjAuth* (mismatch)
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page2.addInitScript((snap) => {
    localStorage.clear();
    sessionStorage.clear();
    if (snap.companion) {
      localStorage.setItem("mcjCompanionSession", snap.companion);
      sessionStorage.setItem("mcjCompanionSession", snap.companion);
    }
    if (snap.customerUser) {
      localStorage.setItem("customerUser", snap.customerUser);
      localStorage.setItem("mcjCurrentUser", snap.customerUser);
    }
    Object.entries(snap.drafts || {}).forEach(([k, v]) => localStorage.setItem(k, v));
  }, snap);
  await page2.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  await page2.waitForTimeout(3500);
  const d2 = await desk(page2);
  await page2.screenshot({ path: path.join(ART, "companion-only-after-apply.png"), fullPage: true });
  results.push(
    step(
      "repro_companion_without_boss_keys",
      true,
      Object.assign({ note: "expect human mismatch if hasLogin while nick/email restored" }, d2)
    )
  );
  // This is the bug if true:
  results.push(
    step(
      "BUG_apply_restored_but_header_guest",
      !(d2.hasLogin && (d2.nick || d2.email || /申请|步骤|昵称/.test(d2.apply)) && d2.keys.companion && !d2.keys.access),
      d2
    )
  );
  await page2.close();
}

await browser.close();
const out = { base: BASE, results };
fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(
  path.join(ROOT, "artifacts", "companion-apply-boss-header-human-flow-e2e", "results.json"),
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify(out, null, 2));
const failed = results.filter((r) => r.result === "FAIL" && r.step !== "repro_companion_without_boss_keys").length;
process.exit(failed ? 1 : 0);
