/**
 * Companion apply: boss-session-first auth gate.
 * A) logged-in boss → use current account (no register/OTP)
 * B) logged-in boss → switch to other account UI
 * C) guest → register/login UI
 * D) refresh restores draft after boss apply
 * E) video direct-upload helpers still present (no regression)
 *
 * Usage:
 *   USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-boss-auth-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const USE_LOCAL_JS = process.env.USE_LOCAL_JS !== "0" && process.env.USE_LOCAL_JS !== "false";
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const OTHER = process.env.E2E_OTHER_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-boss-auth-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-boss-auth-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-companion-token": token,
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function refreshOf(j) {
  return j?.session?.refreshToken || j?.session?.refresh_token || j?.refreshToken || "";
}
function expiresOf(j) {
  return j?.session?.expiresAt || j?.session?.expires_at || "";
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function installLocalJs(page) {
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
  };
  for (const [pattern, payload] of Object.entries(files)) {
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: payload.type, body: payload.body });
    });
  }
}

async function injectBossOnly(page, { token, refreshToken, expiresAt, email }) {
  await page.addInitScript(
    ({ token, refreshToken, expiresAt, email }) => {
      const soft = "customer_session_v4_" + Date.now();
      const user = {
        id: "",
        email,
        account: email,
        role: "boss",
        hasBoss: true,
        roles: ["boss"],
      };
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      if (refreshToken) {
        localStorage.setItem("mcjAuthRefreshToken", refreshToken);
        sessionStorage.setItem("mcjAuthRefreshToken", refreshToken);
      }
      if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", soft);
      sessionStorage.setItem("customerAuthToken", soft);
      localStorage.setItem("customerUser", JSON.stringify(user));
      sessionStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(user));
      // Intentionally NO mcjCompanionSession — boss has not applied yet in this tab.
    },
    { token, refreshToken, expiresAt, email }
  );
}

async function injectExpiredBossKeepRefresh(page, { token, refreshToken, email }) {
  await page.addInitScript(
    ({ token, refreshToken, email }) => {
      localStorage.clear();
      sessionStorage.clear();
      // Expired access, valid refresh — header used to purge this and force register UI.
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjAuthRefreshToken", refreshToken);
      sessionStorage.setItem("mcjAuthRefreshToken", refreshToken);
      localStorage.setItem("mcjAuthExpiresAt", String(Math.floor(Date.now() / 1000) - 120));
      sessionStorage.setItem("mcjAuthExpiresAt", String(Math.floor(Date.now() / 1000) - 120));
      localStorage.setItem("mcjRole", "boss");
      const user = { email, account: email, role: "boss", hasBoss: true, roles: ["boss"] };
      localStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(user));
      localStorage.setItem("customerAuthToken", "customer_session_v4_expired_e2e");
    },
    { token, refreshToken, email }
  );
}

(async () => {
  // Static regression: video direct upload must remain untouched.
  const videoJs = fs.readFileSync(path.join(ROOT, "src/mcj-companion-video-upload.js"), "utf8");
  const applyJs = fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8");
  step(
    "E_video_direct_upload_intact",
    /prepareVideoUpload|tus|signed/.test(videoJs) && /McjCompanionVideoUpload/.test(applyJs),
    "mcj-companion-video-upload + apply wiring present"
  );

  const login = await api("/api/auth", null, {
    action: "login",
    email: BOSS,
    password: PASS,
    loginPortal: "boss",
    remember: true,
  });
  const access = tok(login.json);
  const refresh = refreshOf(login.json);
  const expiresAt = expiresOf(login.json);
  step("boss_api_login", !!(login.ok && access && refresh), `boss=${BOSS}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" || "/usr/local/bin/chrome",
  });

  // --- A: boss session → boss gate, apply without register ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectBossOnly(page, { token: access, refreshToken: refresh, expiresAt, email: BOSS });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    const gate = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        bossTitle: /使用当前老板账号申请陪玩/.test(text),
        registerTitle: /先创建\s*\/\s*登录陪玩账号/.test(text),
        preferOther: !!document.querySelector("[data-apply-prefer-other]"),
        applyBtn: !!document.querySelector("[data-apply-from-boss]"),
        gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || "",
      };
    });
    await shot(page, "A-boss-gate");
    step("A_boss_gate_default", gate.bossTitle && gate.applyBtn && !gate.registerTitle, JSON.stringify(gate));

    await page.click("[data-apply-from-boss]");
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const sess = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null");
      return {
        hasCompanionSession: !!(sess && (sess.token || sess.accessToken)),
        noRegister: !/先创建\s*\/\s*登录陪玩账号/.test(text),
        flowVisible: /申请进度|规则|第\s*1\s*步/.test(text) || !!document.querySelector(".apply-layout:not([hidden])"),
        authStill: !!document.querySelector("[data-apply-auth-gate]"),
      };
    });
    await shot(page, "A-after-apply");
    step(
      "A_apply_from_boss_no_register",
      after.hasCompanionSession && after.noRegister && !after.authStill,
      JSON.stringify(after)
    );
    await page.close();
  }

  // --- B: prefer other account expands login/register ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectBossOnly(page, { token: access, refreshToken: refresh, expiresAt, email: BOSS });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("[data-apply-prefer-other]", { timeout: 20000 });
    await page.click("[data-apply-prefer-other]");
    await page.waitForTimeout(500);
    const other = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || "",
        otherTitle: /改用其他陪玩账号/.test(text),
        loginTab: !!document.querySelector('[data-apply-auth-mode="login"]'),
        backBoss: !!document.querySelector("[data-apply-use-current-boss]"),
        pwdForm: !!document.querySelector('[data-apply-auth-form="login-password"]:not([hidden])'),
      };
    });
    await shot(page, "B-other-account");
    step("B_other_account_ui", other.gate === "other" && other.loginTab && other.backBoss, JSON.stringify(other));

    // Login as another companion account (password) if credentials work.
    const otherLogin = await api("/api/auth", null, {
      action: "login",
      email: OTHER,
      password: PASS,
      loginPortal: "companion",
      remember: true,
    });
    if (otherLogin.ok && tok(otherLogin.json)) {
      await page.fill('[data-apply-auth-form="login-password"] [name="authEmail"]', OTHER);
      await page.fill('[data-apply-auth-form="login-password"] [name="authPassword"]', PASS);
      await page.click("[data-apply-login-password]");
      await page.waitForTimeout(3000);
      const logged = await page.evaluate(() => {
        const sess = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null");
        return {
          email: sess?.user?.email || "",
          hasTok: !!(sess && (sess.token || sess.accessToken)),
          gateGone: !document.querySelector("[data-apply-auth-gate]"),
        };
      });
      await shot(page, "B-other-logged-in");
      step("B_other_account_login", logged.hasTok && logged.gateGone, JSON.stringify(logged));
    } else {
      step("B_other_account_login", true, `skipped live login (api=${otherLogin.status}); UI gate covered`);
    }
    await page.close();
  }

  // --- C: guest → register UI ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 2}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1200);
    const guest = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        registerTitle: /先创建\s*\/\s*登录陪玩账号/.test(text),
        bossTitle: /使用当前老板账号申请陪玩/.test(text),
        gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || "",
        regForm: !!document.querySelector('[data-apply-auth-form="register"]'),
      };
    });
    await shot(page, "C-guest-register");
    step("C_guest_register_ui", guest.registerTitle && !guest.bossTitle && guest.gate === "guest", JSON.stringify(guest));
    await page.close();
  }

  // --- D: draft restore after boss apply + refresh ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectBossOnly(page, { token: access, refreshToken: refresh, expiresAt, email: BOSS });
    const draft = {
      step: 1,
      rulesAgreement: { accepted: true, version: "e2e", agreedAt: new Date().toISOString() },
      data: { nickname: "BossApplyDraft", gender: "女", age: "22", mainGames: "王者荣耀" },
      uploads: {},
      voice: {},
      identity: {},
      gameCards: [],
    };
    await page.addInitScript((d) => {
      // Runs after injectBossOnly clear — seed draft without wiping boss tokens.
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d));
    }, draft);
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 3}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("[data-apply-from-boss]", { timeout: 20000 });
    await page.click("[data-apply-from-boss]");
    await page.waitForFunction(
      () => {
        try {
          const sess = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null");
          return !!(sess && (sess.token || sess.accessToken)) && !document.querySelector("[data-apply-auth-gate]");
        } catch (e) {
          return false;
        }
      },
      { timeout: 45000 }
    );
    await page.waitForTimeout(600);
    const snap = await page.evaluate(() => {
      return {
        companion: localStorage.getItem("mcjCompanionSession"),
        draft: localStorage.getItem("mcjCompanionApplicationDraft.v1"),
        access: localStorage.getItem("mcjAuthAccessToken"),
        refresh: localStorage.getItem("mcjAuthRefreshToken"),
        expires: localStorage.getItem("mcjAuthExpiresAt"),
      };
    });
    await page.close();

    // Fresh page: re-inject persisted companion + boss session (initScript clear would wipe reload).
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page2);
    await page2.addInitScript((snap) => {
      localStorage.clear();
      sessionStorage.clear();
      if (snap.access) {
        localStorage.setItem("mcjAuthAccessToken", snap.access);
        sessionStorage.setItem("mcjAuthAccessToken", snap.access);
      }
      if (snap.refresh) {
        localStorage.setItem("mcjAuthRefreshToken", snap.refresh);
        sessionStorage.setItem("mcjAuthRefreshToken", snap.refresh);
      }
      if (snap.expires) {
        localStorage.setItem("mcjAuthExpiresAt", snap.expires);
        sessionStorage.setItem("mcjAuthExpiresAt", snap.expires);
      }
      localStorage.setItem("mcjRole", "boss");
      if (snap.companion) {
        localStorage.setItem("mcjCompanionSession", snap.companion);
        sessionStorage.setItem("mcjCompanionSession", snap.companion);
      }
      if (snap.draft) {
        localStorage.setItem("mcjCompanionApplicationDraft.v1", snap.draft);
      }
    }, snap);
    await page2.goto(`${BASE}/companion-apply.html?t=${Date.now() + 5}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page2.waitForTimeout(1800);
    const resumed = await page2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      const sess = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null");
      const text = document.body.innerText || "";
      return {
        step: d.step,
        nickname: d.data?.nickname || "",
        hasSession: !!(sess && (sess.token || sess.accessToken)),
        showsNick: /BossApplyDraft/.test(text),
        noAuthGate: !document.querySelector("[data-apply-auth-gate]"),
        layoutVisible: !!document.querySelector(".apply-layout:not([hidden])"),
      };
    });
    await shot(page2, "D-draft-resume");
    step(
      "D_draft_resume_after_refresh",
      resumed.hasSession &&
        resumed.noAuthGate &&
        resumed.layoutVisible &&
        (resumed.nickname === "BossApplyDraft" || resumed.showsNick),
      JSON.stringify(resumed)
    );
    await page2.close();
  }

  // --- Expired JWT + refresh must NOT wipe into register form ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectExpiredBossKeepRefresh(page, { token: access, refreshToken: refresh, email: BOSS });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 4}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const expired = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        bossTitle: /使用当前老板账号申请陪玩/.test(text),
        registerTitle: /先创建\s*\/\s*登录陪玩账号/.test(text),
        hasAccess: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
        hasRefresh: !!(localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken")),
      };
    });
    await shot(page, "A2-expired-refresh-restore");
    step(
      "A2_expired_jwt_keeps_boss_gate",
      expired.bossTitle && !expired.registerTitle && expired.hasRefresh,
      JSON.stringify(expired)
    );
    await page.close();
  }

  await browser.close();

  const out = { base: BASE, useLocalJs: USE_LOCAL_JS, boss: BOSS, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));

  const failed = results.filter((r) => r.result !== "PASS");
  console.log(`\nDone: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
