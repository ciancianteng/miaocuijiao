/**
 * REAL Preview page test — NO USE_LOCAL_JS.
 * Hits the Vite-bundled companion-apply.html on Vercel Preview and asserts
 * the live header.mcj-boss-header desk nav auth chrome.
 *
 * Usage:
 *   PREVIEW=<pr-preview-url> CHROME_PATH=/usr/bin/google-chrome \
 *     node scripts/p0-companion-apply-boss-header-real-preview-e2e.mjs
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
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-boss-header-real-preview-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-boss-header-real-preview-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
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
function userOf(j) {
  return j?.session?.user || j?.user || {};
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function probePage(page) {
  return page.evaluate(() => {
    const scripts = [...document.scripts].map((s) => s.src || s.getAttribute("src") || "(inline)").filter(Boolean);
    const header = document.querySelector("header.mcj-boss-header");
    const desk = header && header.querySelector(".mcj-desk-nav");
    const deskHtml = desk ? desk.innerHTML : "";
    const deskText = desk ? (desk.innerText || "").replace(/\s+/g, " ").trim() : "";
    const mine = desk && desk.querySelector('a[href*="mine.html"]');
    const login = desk && desk.querySelector("[data-mcj-boss-login]");
    const logout = desk && desk.querySelector("[data-mcj-boss-logout]");
    const storage = {
      access: localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "",
      refresh: localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken") || "",
      expires: localStorage.getItem("mcjAuthExpiresAt") || sessionStorage.getItem("mcjAuthExpiresAt") || "",
      customerUser: localStorage.getItem("customerUser") || sessionStorage.getItem("customerUser") || "",
      companionSession: localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "",
      companionToken: localStorage.getItem("companionAuthToken") || "",
    };
    const draftKeys = Object.keys(localStorage).filter((k) => /mcjCompanionApplicationDraft/i.test(k));
    const applyRoot = document.getElementById("companionApplyRoot");
    const applyText = (applyRoot && applyRoot.innerText) || "";
    const nickInput = document.querySelector('input[name="nickname"]');
    const emailInput = document.querySelector('input[name="email"]');
    return {
      href: location.href,
      scriptCount: scripts.length,
      scripts: scripts.slice(0, 20),
      hasBundledEntry: scripts.some((s) => /\/assets\/companion-apply-/i.test(s)),
      hasSrcBossHeader: scripts.some((s) => /\/src\/boss-header\.js/i.test(s)),
      headerPresent: !!header,
      headerAuth: header ? header.getAttribute("data-mcj-auth") : "",
      bodyAuth: document.body.getAttribute("data-mcj-auth") || "",
      deskText,
      deskHtml: deskHtml.slice(0, 500),
      hasMine: !!(mine && /个人中心/.test(mine.textContent || "")),
      hasLogin: !!(login && /登录/.test(login.textContent || "")),
      hasLogout: !!(logout && /退出登录/.test(logout.textContent || "")),
      mineHref: mine ? mine.getAttribute("href") : "",
      mcjBossHeader: !!window.MCJBossHeader,
      mcjBossHeaderSyncType: window.MCJBossHeader && typeof window.MCJBossHeader.sync,
      mcjBossAuth: !!window.MCJBossAuth,
      canRestore: !!(window.MCJBossAuth && window.MCJBossAuth.canRestoreSession && window.MCJBossAuth.canRestoreSession()),
      hasValid: !!(window.MCJBossAuth && window.MCJBossAuth.hasValidAccessToken && window.MCJBossAuth.hasValidAccessToken()),
      accessLen: storage.access.length,
      refreshLen: storage.refresh.length,
      expires: storage.expires,
      hasCustomerUser: !!storage.customerUser,
      hasCompanionSession: !!storage.companionSession,
      draftKeys,
      bossGate: /使用当前老板账号申请陪玩/.test(applyText),
      registerGate: /先创建\s*\/\s*登录陪玩账号/.test(applyText),
      nickValue: nickInput ? nickInput.value : "",
      emailValue: emailInput ? emailInput.value : "",
      applySnippet: applyText.replace(/\s+/g, " ").trim().slice(0, 220),
    };
  });
}

async function injectBossSession(page, { token, refreshToken, expiresAt, user, expireAccess }) {
  await page.addInitScript(
    ({ token, refreshToken, expiresAt, user, expireAccess }) => {
      const u = Object.assign(
        {
          id: user.id || user.user_id || "",
          email: user.email || "",
          account: user.email || user.account || "",
          role: "boss",
          hasBoss: true,
          roles: ["boss"],
        },
        user || {}
      );
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      if (refreshToken) {
        localStorage.setItem("mcjAuthRefreshToken", refreshToken);
        sessionStorage.setItem("mcjAuthRefreshToken", refreshToken);
      }
      if (expireAccess) {
        localStorage.setItem("mcjAuthExpiresAt", String(Math.floor(Date.now() / 1000) - 120));
        sessionStorage.setItem("mcjAuthExpiresAt", String(Math.floor(Date.now() / 1000) - 120));
      } else if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerUser", JSON.stringify(u));
      sessionStorage.setItem("customerUser", JSON.stringify(u));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(u));
      sessionStorage.setItem("mcjCurrentUser", JSON.stringify(u));
      localStorage.setItem("customerAuthToken", "customer_session_v4_real_preview");
      sessionStorage.setItem("customerAuthToken", "customer_session_v4_real_preview");
    },
    { token, refreshToken, expiresAt, user, expireAccess: !!expireAccess }
  );
}

(async () => {
  // Sanity: Preview HTML must be Vite-bundled (the human path).
  const html = await fetch(`${BASE}/companion-apply.html`).then((r) => r.text());
  const bundled = /\/assets\/companion-apply-[^"]+\.js/.test(html);
  const hasSrcScripts = /src\/boss-header\.js/.test(html) || /src\/companion-application\.js/.test(html);
  step(
    "preview_html_is_vite_bundle",
    bundled && !hasSrcScripts,
    JSON.stringify({ bundled, hasSrcScripts, head: html.slice(0, 400) })
  );

  const login = await api("/api/auth", {
    action: "login",
    email: BOSS,
    password: PASS,
    loginPortal: "boss",
    remember: true,
  });
  const access = tok(login.json);
  const refresh = refreshOf(login.json);
  const expiresAt = expiresOf(login.json);
  const user = userOf(login.json);
  step("boss_api_login", !!(login.ok && access && refresh), `boss=${BOSS} uid=${user.id || ""}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // A) Guest on real Preview bundle
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.waitForTimeout(2500);
    const p = await probePage(page);
    await shot(page, "real-guest");
    step(
      "real_guest_header_login",
      p.hasBundledEntry && p.headerPresent && p.hasLogin && !p.hasMine && !p.hasLogout,
      JSON.stringify(p)
    );
    await page.close();
  }

  // B) Valid boss JWT on real Preview bundle (no local JS override)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await injectBossSession(page, { token: access, refreshToken: refresh, expiresAt, user });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.waitForTimeout(3500);
    const p = await probePage(page);
    await shot(page, "real-boss-valid");
    step(
      "real_boss_valid_header_mine",
      p.hasBundledEntry && p.hasMine && p.hasLogout && !p.hasLogin && p.bodyAuth === "in",
      JSON.stringify(p)
    );
    await page.close();
  }

  // C) Expired access + refresh on real Preview
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await injectBossSession(page, {
      token: access,
      refreshToken: refresh,
      expiresAt,
      user,
      expireAccess: true,
    });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.waitForTimeout(4000);
    const p = await probePage(page);
    await shot(page, "real-boss-expired-refresh");
    step(
      "real_boss_expired_refresh_header_mine",
      p.hasMine && p.hasLogout && !p.hasLogin && (p.bossGate || p.hasValid || p.canRestore),
      JSON.stringify(p)
    );

    if (p.hasLogout) {
      await page.click("header.mcj-boss-header [data-mcj-boss-logout]");
      await page.waitForTimeout(2000);
      const after = await probePage(page);
      await shot(page, "real-after-logout");
      step(
        "real_logout_restores_login",
        /companion-apply\.html/i.test(after.href) && after.hasLogin && !after.hasMine && !after.hasLogout && after.accessLen === 0,
        JSON.stringify(after)
      );
    } else {
      step("real_logout_restores_login", false, "no logout button to click: " + JSON.stringify(p));
    }
    await page.close();
  }

  // D) Companion-session + draft only (no boss JWT) — reproduces human mismatch if this is the path
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const uid = user.id || "e2e-uid";
    await page.addInitScript(
      ({ uid, email }) => {
        localStorage.clear();
        sessionStorage.clear();
        const sess = {
          token: "companion_fake_token_not_jwt",
          accessToken: "companion_fake_token_not_jwt",
          user: { id: uid, email, role: "companion", hasCompanion: true },
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(sess));
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(sess));
        localStorage.setItem(
          "mcjCompanionApplicationDraft.v1.u:" + uid,
          JSON.stringify({
            step: 0,
            ownerUserId: uid,
            data: { nickname: "PreviewNick", email: email || "boss@test.com" },
          })
        );
        localStorage.setItem(
          "customerUser",
          JSON.stringify({ id: uid, email, role: "boss", hasBoss: true, roles: ["boss"] })
        );
      },
      { uid, email: user.email || BOSS }
    );
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.waitForTimeout(3500);
    const p = await probePage(page);
    await shot(page, "real-companion-only-mismatch");
    step(
      "diag_companion_only_without_boss_jwt",
      true,
      JSON.stringify({
        note: "diagnostic: apply may restore draft while header stays guest",
        hasMine: p.hasMine,
        hasLogin: p.hasLogin,
        nickValue: p.nickValue,
        emailValue: p.emailValue,
        hasCompanionSession: p.hasCompanionSession,
        accessLen: p.accessLen,
        refreshLen: p.refreshLen,
        applySnippet: p.applySnippet,
      })
    );
    await page.close();
  }

  await browser.close();
  const out = { base: BASE, useLocalJs: false, boss: BOSS, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result !== "PASS" && !String(r.step).startsWith("diag_")).length;
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
