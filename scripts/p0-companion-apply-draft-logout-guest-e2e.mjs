/**
 * Regression: Boss A draft → logout → guest must not see draft.
 * Root cause covered: boss logout left mcjCompanionSession (same user id),
 * so apply page restored scoped draft while header showed guest.
 *
 * Usage: USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-draft-logout-guest-e2e.mjs
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
const BOSS_A = process.env.E2E_BOSS_A || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-draft-logout-guest-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-draft-logout-guest-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-companion-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || "";
}
function refreshOf(j) {
  return j?.session?.refreshToken || j?.session?.refresh_token || "";
}
function expiresOf(j) {
  return j?.session?.expiresAt || j?.session?.expires_at || "";
}
function userIdOf(j, access) {
  let id = j?.session?.user?.id || j?.session?.user?.user_id || "";
  if (!id && access) {
    try {
      id = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8")).sub || "";
    } catch (e) {}
  }
  return id;
}
async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(ART, file), fullPage: true });
  fs.copyFileSync(path.join(ART, file), path.join(ART_REPO, file));
}

async function installLocal(page) {
  if (!USE_LOCAL_JS) return;
  const map = {
    "**/companion-apply.html**": ["text/html; charset=utf-8", "companion-apply.html"],
    "**/src/companion-application.js**": ["text/javascript; charset=utf-8", "src/companion-application.js"],
    "**/src/boss-header.js**": ["text/javascript; charset=utf-8", "src/boss-header.js"],
    "**/src/role-gates.js**": ["text/javascript; charset=utf-8", "src/role-gates.js"],
    "**/src/boss-auth-session.js**": ["text/javascript; charset=utf-8", "src/boss-auth-session.js"],
  };
  for (const [pattern, [type, rel]] of Object.entries(map)) {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: type, body });
    });
  }
}

(async () => {
  const src = fs.readFileSync(path.join(ROOT, "src/role-gates.js"), "utf8");
  const hdr = fs.readFileSync(path.join(ROOT, "src/boss-header.js"), "utf8");
  step(
    "static_same_user_logout_clear",
    /clearCompanionSessionIfSameUser/.test(src) && /mcjCompanionSession/.test(hdr) && /bossUid/.test(hdr),
    "role-gates + boss-header same-user companion clear present"
  );

  const login = await api("/api/auth", null, {
    action: "login",
    email: BOSS_A,
    password: PASS,
    loginPortal: "boss",
    remember: true,
  });
  const access = tok(login.json);
  const refresh = refreshOf(login.json);
  const expiresAt = expiresOf(login.json);
  const uid = userIdOf(login.json, access);
  await api("/api/companion", access, { action: "apply_companion_role", refreshToken: refresh, expiresAt });
  step("boss_a_login", !!(access && uid), `uid=${uid}`);

  const nick = "LogoutGuestDraft_" + Date.now().toString(36);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  });

  // --- A: logged in with draft ---
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocal(page);
  await page.addInitScript(
    ({ access, refresh, expiresAt, uid, email, nick }) => {
      // Only seed once — later navigations after logout must keep cleared state.
      if (sessionStorage.getItem("__e2e_draft_logout_seeded") === "1") return;
      sessionStorage.setItem("__e2e_draft_logout_seeded", "1");
      localStorage.clear();
      // keep the seed flag across clear in this init only
      sessionStorage.setItem("__e2e_draft_logout_seeded", "1");
      const profile = {
        id: uid,
        user_id: uid,
        email,
        account: email,
        role: "boss",
        hasBoss: true,
        hasCompanion: true,
        roles: ["boss", "companion"],
      };
      localStorage.setItem("mcjAuthAccessToken", access);
      sessionStorage.setItem("mcjAuthAccessToken", access);
      localStorage.setItem("mcjAuthRefreshToken", refresh);
      sessionStorage.setItem("mcjAuthRefreshToken", refresh);
      if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", "customer_session_v4_e2e");
      localStorage.setItem("customerUser", JSON.stringify(profile));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(profile));
      const companion = {
        token: access,
        accessToken: access,
        refreshToken: refresh,
        expiresAt,
        user: Object.assign({}, profile, { role: "companion" }),
        remember: true,
        portal: "companion",
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      localStorage.setItem(
        "mcjCompanionApplicationDraft.v1.u:" + uid,
        JSON.stringify({
          step: 1,
          ownerUserId: uid,
          data: { nickname: nick, gender: "女", age: "22" },
          rulesAgreement: { accepted: true },
        })
      );
      localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", uid);
    },
    { access, refresh, expiresAt, uid, email: BOSS_A, nick }
  );
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  const before = await page.evaluate((nick) => {
    const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
    return {
      authUid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
      nick: d.data?.nickname || "",
      companion: !!localStorage.getItem("mcjCompanionSession"),
      boss: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
      gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || null,
      layout: !!document.querySelector(".apply-layout:not([hidden])"),
      showsNick: document.body.innerText.includes(nick) || d.data?.nickname === nick,
    };
  }, nick);
  await shot(page, "01-boss-a-with-draft");
  step("before_logout_has_draft", before.nick === nick && before.companion && before.layout, JSON.stringify(before));

  // --- Logout via the same API as header ---
  await page.evaluate(() => {
    if (window.MCJBossHeader && typeof window.MCJBossHeader.clearSession === "function") {
      window.MCJBossHeader.clearSession();
    } else if (window.MCJRoleGate && typeof window.MCJRoleGate.logout === "function") {
      window.MCJRoleGate.logout("customer");
      window.MCJRoleGate.logout("boss");
    }
  });
  await page.waitForTimeout(500);

  // Open apply again in the same profile (guest after logout) — no initScript wipe
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  const guest = await page.evaluate((nick) => {
    const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
    const filled = [...document.querySelectorAll("input,textarea")].filter((el) => String(el.value || "").trim());
    return {
      authUid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
      nick: d.data?.nickname || "",
      companion: !!localStorage.getItem("mcjCompanionSession"),
      boss: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
      gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || null,
      layout: !!document.querySelector(".apply-layout:not([hidden])"),
      showsNick: document.body.innerText.includes(nick),
      scopedKept: !!localStorage.getItem(
        "mcjCompanionApplicationDraft.v1.u:" + (localStorage.getItem("mcjCompanionApplicationDraft.lastAuthUserId") || "")
      ) || Object.keys(localStorage).some((k) => k.indexOf("mcjCompanionApplicationDraft.v1.u:") === 0),
      filledCount: filled.length,
      headerGuest: document.body.classList.contains("is-guest") || document.body.getAttribute("data-mcj-auth") === "out",
    };
  }, nick);
  await shot(page, "02-guest-after-logout");
  step(
    "guest_after_logout_no_draft",
    !guest.authUid &&
      !guest.nick &&
      !guest.companion &&
      !guest.boss &&
      !guest.showsNick &&
      !guest.layout &&
      guest.gate === "guest" &&
      guest.scopedKept,
    JSON.stringify(guest)
  );

  // --- Re-login Boss A resumes scoped draft ---
  await page.evaluate(
    ({ access, refresh, expiresAt, uid, email }) => {
      const profile = {
        id: uid,
        user_id: uid,
        email,
        account: email,
        role: "boss",
        hasBoss: true,
        hasCompanion: true,
        roles: ["boss", "companion"],
      };
      localStorage.setItem("mcjAuthAccessToken", access);
      sessionStorage.setItem("mcjAuthAccessToken", access);
      localStorage.setItem("mcjAuthRefreshToken", refresh);
      sessionStorage.setItem("mcjAuthRefreshToken", refresh);
      if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", "customer_session_v4_e2e2");
      localStorage.setItem("customerUser", JSON.stringify(profile));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(profile));
      const companion = {
        token: access,
        accessToken: access,
        refreshToken: refresh,
        expiresAt,
        user: Object.assign({}, profile, { role: "companion" }),
        remember: true,
        portal: "companion",
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
    },
    { access, refresh, expiresAt, uid, email: BOSS_A }
  );
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 2}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  const resumed = await page.evaluate((nick) => {
    const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
    return {
      authUid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
      nick: d.data?.nickname || "",
      showsNick: d.data?.nickname === nick,
    };
  }, nick);
  await shot(page, "03-boss-a-resume");
  step("boss_a_resumes_scoped_draft", resumed.authUid === uid && resumed.nick === nick, JSON.stringify(resumed));

  await browser.close();
  const out = { base: BASE, useLocalJs: USE_LOCAL_JS, bossA: BOSS_A, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result !== "PASS");
  console.log(`\nDone: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
