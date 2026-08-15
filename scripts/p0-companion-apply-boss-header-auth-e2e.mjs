/**
 * Companion-apply header auth chrome:
 * - Guest →「登录」
 * - Boss logged in (valid or expired+refresh) →「个人中心」+「退出登录」
 * - Logout on apply → guest「登录」, no leftover boss chrome
 *
 * Usage:
 *   USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-boss-header-auth-e2e.mjs
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
const ART = path.join("/opt/cursor/artifacts", "companion-apply-boss-header-auth-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-boss-header-auth-e2e");
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    "**/src/boss-header.css**": {
      type: "text/css; charset=utf-8",
      body: fs.readFileSync(path.join(ROOT, "src/boss-header.css"), "utf8"),
    },
  };
  for (const [pattern, payload] of Object.entries(files)) {
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: payload.type, body: payload.body });
    });
  }
}

async function readHeaderAuth(page) {
  return page.evaluate(() => {
    const desk = document.querySelector("header.mcj-boss-header .mcj-desk-nav");
    const deskText = (desk && desk.innerText) || "";
    const mine = desk && desk.querySelector('a[href="mine.html"], a[href="/mine.html"]');
    const login = desk && desk.querySelector("[data-mcj-boss-login]");
    const logout = desk && desk.querySelector("[data-mcj-boss-logout]");
    const bodyAuth = document.body.getAttribute("data-mcj-auth") || "";
    const headerAuth =
      (document.querySelector("header.mcj-boss-header") &&
        document.querySelector("header.mcj-boss-header").getAttribute("data-mcj-auth")) ||
      "";
    return {
      deskText: deskText.replace(/\s+/g, " ").trim(),
      hasMine: !!(mine && /个人中心/.test(mine.textContent || "")),
      hasLogin: !!(login && /登录/.test(login.textContent || "")),
      hasLogout: !!(logout && /退出登录/.test(logout.textContent || "")),
      bodyAuth,
      headerAuth,
      mineHref: mine ? mine.getAttribute("href") : "",
    };
  });
}

async function injectBoss(page, { token, refreshToken, expiresAt, email, expireAccess }) {
  await page.addInitScript(
    ({ token, refreshToken, expiresAt, email, expireAccess }) => {
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
      const user = { email, account: email, role: "boss", hasBoss: true, roles: ["boss"] };
      localStorage.setItem("customerUser", JSON.stringify(user));
      sessionStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(user));
      sessionStorage.setItem("mcjCurrentUser", JSON.stringify(user));
      localStorage.setItem("customerAuthToken", "customer_session_v4_header_e2e");
      sessionStorage.setItem("customerAuthToken", "customer_session_v4_header_e2e");
    },
    { token, refreshToken, expiresAt, email, expireAccess: !!expireAccess }
  );
}

async function injectGuest(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

(async () => {
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
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // Guest
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectGuest(page);
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1800);
    const h = await readHeaderAuth(page);
    await shot(page, "guest-header");
    step(
      "guest_shows_login",
      h.hasLogin && !h.hasMine && !h.hasLogout && h.bodyAuth === "out",
      JSON.stringify(h)
    );
    await page.close();
  }

  // Valid boss JWT
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectBoss(page, { token: access, refreshToken: refresh, expiresAt, email: BOSS });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2200);
    const h = await readHeaderAuth(page);
    await shot(page, "boss-valid-header");
    step(
      "boss_valid_shows_mine_logout",
      h.hasMine && h.hasLogout && !h.hasLogin && h.mineHref.includes("mine.html") && h.bodyAuth === "in",
      JSON.stringify(h)
    );
    await page.close();
  }

  // Expired access + refresh (the previous inconsistency case)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocalJs(page);
    await injectBoss(page, {
      token: access,
      refreshToken: refresh,
      expiresAt,
      email: BOSS,
      expireAccess: true,
    });
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2800);
    const h = await readHeaderAuth(page);
    const gate = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        bossTitle: /使用当前老板账号申请陪玩/.test(text),
        registerTitle: /先创建\s*\/\s*登录陪玩账号/.test(text),
      };
    });
    await shot(page, "boss-expired-refresh-header");
    step(
      "boss_expired_refresh_header_logged_in",
      h.hasMine && h.hasLogout && !h.hasLogin && gate.bossTitle && !gate.registerTitle,
      JSON.stringify({ h, gate })
    );

    // Logout stays on apply and returns guest chrome
    await page.click("header.mcj-boss-header [data-mcj-boss-logout]");
    await page.waitForTimeout(1500);
    const after = await readHeaderAuth(page);
    const url = page.url();
    const tokens = await page.evaluate(() => ({
      access: localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "",
      refresh: localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken") || "",
    }));
    await shot(page, "after-logout-header");
    step(
      "logout_on_apply_restores_guest",
      /companion-apply\.html/i.test(url) &&
        after.hasLogin &&
        !after.hasMine &&
        !after.hasLogout &&
        !tokens.access &&
        !tokens.refresh &&
        after.bodyAuth === "out",
      JSON.stringify({ url, after, tokens })
    );
    await page.close();
  }

  await browser.close();

  const out = {
    base: BASE,
    useLocalJs: USE_LOCAL_JS,
    boss: BOSS,
    results,
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result !== "PASS").length;
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
