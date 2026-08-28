/**
 * Verifies the human Preview mismatch fix:
 * companion session + draft present, boss mcjAuth* absent → header must still show 个人中心.
 *
 * USE_LOCAL_JS=1 serves local companion-apply sources (including hydrate fix).
 * Against Preview origin for /api/*.
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
const USE_LOCAL_JS = process.env.USE_LOCAL_JS !== "0";
const PASS = process.env.PASS || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-boss-header-hydrate-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-boss-header-hydrate-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  const row = { step: name, result: ok ? "PASS" : "FAIL", detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1500) };
  results.push(row);
  console.log(`[${row.result}] ${name} :: ${row.detail.slice(0, 900)}`);
  return ok;
}

async function installLocal(page) {
  if (!USE_LOCAL_JS) return;
  const files = {
    "**/companion-apply.html**": {
      type: "text/html; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "companion-apply.html"), "utf8"),
    },
    "**/src/companion-application.js**": {
      type: "text/javascript; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8"),
    },
    "**/src/boss-header.js**": {
      type: "text/javascript; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/boss-header.js"), "utf8"),
    },
    "**/src/boss-auth-session.js**": {
      type: "text/javascript; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/boss-auth-session.js"), "utf8"),
    },
    "**/src/design-system.js**": {
      type: "text/javascript; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/design-system.js"), "utf8"),
    },
    "**/src/role-gates.js**": {
      type: "text/javascript; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/role-gates.js"), "utf8"),
    },
  };
  for (const [pattern, payload] of Object.entries(files)) {
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: payload.type, body: payload.body });
    });
  }
}

async function desk(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("header.mcj-boss-header .mcj-desk-nav");
    const text = (nav?.innerText || "").replace(/\s+/g, " ").trim();
    const loginEl = nav && nav.querySelector("[data-mcj-boss-login]");
    const mineEl = nav && nav.querySelector('a[href*="mine.html"]');
    const logoutEl = nav && nav.querySelector("[data-mcj-boss-logout]");
    return {
      text,
      hasMine: !!(mineEl && /个人中心/.test(mineEl.textContent || "")),
      hasLoginOnly: !!(loginEl && /登录/.test(loginEl.textContent || "")),
      hasLogout: !!(logoutEl && /退出登录/.test(logoutEl.textContent || "")),
      bodyAuth: document.body.getAttribute("data-mcj-auth"),
      access: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
      refresh: !!(localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken")),
      companion: !!(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession")),
      layoutHidden: !!document.querySelector(".apply-layout")?.hasAttribute("hidden"),
      apply: (document.getElementById("companionApplyRoot")?.innerText || "").replace(/\s+/g, " ").slice(0, 200),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
      headerScriptFlag: !!window.__MCJBossHeaderScript,
      classicBossHeaderLoads: [...document.scripts].filter((s) => /\/src\/boss-header\.js/i.test(s.src || "")).length,
    };
  });
}

const login = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ action: "login", email: BOSS, password: PASS, loginPortal: "boss", remember: true }),
}).then((r) => r.json());
const access = login.session?.accessToken;
const refresh = login.session?.refreshToken;
const expiresAt = login.session?.expiresAt;
const user = login.session?.user || {};
step("boss_api_login", !!(access && refresh), { uid: user.id, useLocalJs: USE_LOCAL_JS });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// Build companion-only snap via apply-from-boss on local sources
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocal(page);
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
      localStorage.setItem("customerAuthToken", "customer_session_v4_hydrate");
    },
    { access, refresh, expiresAt, user, BOSS }
  );
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2000);
  const before = await desk(page);
  step("boss_keys_header_ok", before.hasMine && before.hasLogout, before);
  await page.click("[data-apply-from-boss]");
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const nick = document.querySelector('input[name="nickname"]');
    const email = document.querySelector('input[name="email"]');
    if (nick) {
      nick.value = "HydrateNick";
      nick.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (email) {
      email.value = "boss.final.1785714993009@meow.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);
  const snap = await page.evaluate(() => {
    const companion = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession");
    const drafts = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/Draft/i.test(k)) drafts[k] = localStorage.getItem(k);
    }
    return { companion, drafts, customerUser: localStorage.getItem("customerUser") };
  });
  await page.close();

  // Companion-only reload (the human mismatch)
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocal(page2);
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
  const d = await desk(page2);
  await page2.screenshot({ path: path.join(ART, "companion-only-hydrated.png"), fullPage: true });
  fs.copyFileSync(path.join(ART, "companion-only-hydrated.png"), path.join(ART_REPO, "companion-only-hydrated.png"));
  step(
    "companion_only_header_shows_mine",
    d.hasMine && d.hasLogout && !d.hasLoginOnly && d.companion && d.access && !d.layoutHidden,
    d
  );

  // Logout restores guest
  if (d.hasLogout) {
    await page2.click("header.mcj-boss-header [data-mcj-boss-logout]");
    await page2.waitForTimeout(1500);
    const after = await desk(page2);
    await page2.screenshot({ path: path.join(ART, "after-logout.png"), fullPage: true });
    fs.copyFileSync(path.join(ART, "after-logout.png"), path.join(ART_REPO, "after-logout.png"));
    step("logout_restores_login", after.hasLoginOnly && !after.hasMine && !after.access, after);
  } else {
    step("logout_restores_login", false, "no logout");
  }
  await page2.close();
}

// Guest
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocal(page);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2000);
  const g = await desk(page);
  await page.screenshot({ path: path.join(ART, "guest.png"), fullPage: true });
  fs.copyFileSync(path.join(ART, "guest.png"), path.join(ART_REPO, "guest.png"));
  step("guest_shows_login", g.hasLoginOnly && !g.hasMine, g);
  await page.close();
}

await browser.close();
const out = { base: BASE, useLocalJs: USE_LOCAL_JS, results };
fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(results.some((r) => r.result !== "PASS") ? 1 : 0);
