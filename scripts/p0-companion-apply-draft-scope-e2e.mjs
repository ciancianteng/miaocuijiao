/**
 * Companion apply draft isolation by auth user id.
 * - Boss A draft → logout → guest cannot see
 * - Boss A draft → Boss B login → cannot see Boss A draft
 * - Boss A login again → can resume own draft
 *
 * Usage: USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-draft-scope-e2e.mjs
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
const BOSS_B = process.env.E2E_BOSS_B || "boss@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-draft-scope-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-draft-scope-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1000) });
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
function userIdOf(j) {
  return j?.session?.user?.id || j?.session?.user?.user_id || j?.user?.id || j?.userId || "";
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
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

function draftPayload(nickname) {
  return {
    step: 1,
    ownerUserId: "",
    rulesAgreement: { accepted: true, version: "e2e", agreedAt: new Date().toISOString() },
    data: { nickname, gender: "女", age: "22", mainGames: "王者荣耀" },
    uploads: {},
    voice: {},
    identity: {},
    gameCards: [],
  };
}

async function loginBoss(email) {
  const login = await api("/api/auth", null, {
    action: "login",
    email,
    password: PASS,
    loginPortal: "boss",
    remember: true,
  });
  const access = tok(login.json);
  const refresh = refreshOf(login.json);
  const expiresAt = expiresOf(login.json);
  let uid = userIdOf(login.json);
  if (!uid && access) {
    try {
      const payload = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
      uid = payload.sub || "";
    } catch (e) {}
  }
  const upgrade = await api("/api/companion", access, {
    action: "apply_companion_role",
    refreshToken: refresh,
    expiresAt,
  });
  return {
    ok: !!(login.ok && access && uid),
    access: tok(upgrade.json) || access,
    refresh: refreshOf(upgrade.json) || refresh,
    expiresAt: expiresOf(upgrade.json) || expiresAt,
    uid,
    email,
  };
}

async function openAsUser(browser, user, draft) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocal(page);
  await page.addInitScript(
    ({ user, draft }) => {
      localStorage.clear();
      sessionStorage.clear();
      const soft = "customer_session_v4_" + Date.now();
      const profile = {
        id: user.uid,
        user_id: user.uid,
        email: user.email,
        account: user.email,
        role: "boss",
        hasBoss: true,
        hasCompanion: true,
        roles: ["boss", "companion"],
      };
      localStorage.setItem("mcjAuthAccessToken", user.access);
      sessionStorage.setItem("mcjAuthAccessToken", user.access);
      if (user.refresh) {
        localStorage.setItem("mcjAuthRefreshToken", user.refresh);
        sessionStorage.setItem("mcjAuthRefreshToken", user.refresh);
      }
      if (user.expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(user.expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(user.expiresAt));
      }
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", soft);
      localStorage.setItem("customerUser", JSON.stringify(profile));
      localStorage.setItem("mcjCurrentUser", JSON.stringify(profile));
      const companion = {
        token: user.access,
        accessToken: user.access,
        refreshToken: user.refresh || "",
        expiresAt: user.expiresAt || "",
        user: Object.assign({}, profile, { role: "companion" }),
        remember: true,
        portal: "companion",
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      if (draft) {
        const scoped = Object.assign({}, draft, { ownerUserId: user.uid });
        localStorage.setItem("mcjCompanionApplicationDraft.v1.u:" + user.uid, JSON.stringify(scoped));
        localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", user.uid);
        // Poison legacy unscoped key with another nickname — must never win.
        localStorage.setItem(
          "mcjCompanionApplicationDraft.v1",
          JSON.stringify(Object.assign({}, draft, { data: { nickname: "LEAKED_UNSCOPED_DRAFT" }, ownerUserId: "" }))
        );
      }
    },
    { user, draft }
  );
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1600);
  return page;
}

(async () => {
  const staticOk =
    fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8").includes("DRAFT_KEY_PREFIX") &&
    fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8").includes("authUserId");
  step("static_scoped_draft_helpers", staticOk, "DRAFT_KEY_PREFIX + authUserId present");

  const a = await loginBoss(BOSS_A);
  step("boss_a_login", a.ok, `uid=${a.uid} email=${a.email}`);
  const b = await loginBoss(BOSS_B);
  step("boss_b_login", b.ok && b.uid && b.uid !== a.uid, `uid=${b.uid} email=${b.email}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  });

  const nickA = "DraftOwnerA_" + Date.now().toString(36);

  // Seed Boss A draft via UI save path
  {
    const page = await openAsUser(browser, a, null);
    await page.waitForFunction(() => !document.querySelector("[data-apply-auth-gate]"), { timeout: 30000 }).catch(() => {});
    await page.evaluate((draft) => {
      const key = "mcjCompanionApplicationDraft.v1.u:" + (window.MCJCompanionApplyDraft?.authUserId?.() || "");
      const uid = window.MCJCompanionApplyDraft?.authUserId?.() || "";
      localStorage.setItem(key, JSON.stringify(Object.assign({}, draft, { ownerUserId: uid })));
      localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", uid);
      // Also plant unscoped poison
      localStorage.setItem(
        "mcjCompanionApplicationDraft.v1",
        JSON.stringify(Object.assign({}, draft, { data: { nickname: "LEAKED_UNSCOPED_DRAFT" } }))
      );
    }, draftPayload(nickA));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate((nick) => {
      const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
      const text = document.body.innerText || "";
      return {
        uid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
        nick: d.data?.nickname || "",
        showsNick: text.includes(nick),
        showsLeak: text.includes("LEAKED_UNSCOPED_DRAFT"),
        legacyGone: !localStorage.getItem("mcjCompanionApplicationDraft.v1"),
        scoped: !!localStorage.getItem("mcjCompanionApplicationDraft.v1.u:" + (window.MCJCompanionApplyDraft?.authUserId?.() || "")),
      };
    }, nickA);
    await shot(page, "01-boss-a-draft");
    step(
      "boss_a_can_see_own_draft",
      seen.nick === nickA && seen.scoped && !seen.showsLeak,
      JSON.stringify(seen)
    );
    await page.close();
  }

  // Guest after full logout wipe
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocal(page);
    await page.addInitScript((nickA) => {
      // Simulate leftover unscoped draft after buggy logout
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(
        "mcjCompanionApplicationDraft.v1",
        JSON.stringify({
          step: 1,
          data: { nickname: nickA },
          rulesAgreement: { accepted: true },
        })
      );
    }, nickA);
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    const guest = await page.evaluate((nick) => {
      const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
      const text = document.body.innerText || "";
      return {
        uid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
        nick: d.data?.nickname || "",
        showsNick: text.includes(nick),
        legacyGone: !localStorage.getItem("mcjCompanionApplicationDraft.v1"),
        gate: document.querySelector("[data-apply-auth-gate]")?.getAttribute("data-apply-auth-gate") || "",
      };
    }, nickA);
    await shot(page, "02-guest-no-draft");
    step(
      "guest_cannot_see_boss_a_draft",
      !guest.uid && !guest.nick && !guest.showsNick && guest.legacyGone,
      JSON.stringify(guest)
    );
    await page.close();
  }

  // Boss B must not see Boss A draft
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installLocal(page);
    await page.addInitScript(
      ({ user, aUid, nickA }) => {
        localStorage.clear();
        sessionStorage.clear();
        const soft = "customer_session_v4_" + Date.now();
        const profile = {
          id: user.uid,
          user_id: user.uid,
          email: user.email,
          account: user.email,
          role: "boss",
          hasBoss: true,
          hasCompanion: true,
          roles: ["boss", "companion"],
        };
        localStorage.setItem("mcjAuthAccessToken", user.access);
        sessionStorage.setItem("mcjAuthAccessToken", user.access);
        if (user.refresh) {
          localStorage.setItem("mcjAuthRefreshToken", user.refresh);
          sessionStorage.setItem("mcjAuthRefreshToken", user.refresh);
        }
        if (user.expiresAt) {
          localStorage.setItem("mcjAuthExpiresAt", String(user.expiresAt));
          sessionStorage.setItem("mcjAuthExpiresAt", String(user.expiresAt));
        }
        localStorage.setItem("mcjRole", "boss");
        localStorage.setItem("customerAuthToken", soft);
        localStorage.setItem("customerUser", JSON.stringify(profile));
        localStorage.setItem("mcjCurrentUser", JSON.stringify(profile));
        const companion = {
          token: user.access,
          accessToken: user.access,
          refreshToken: user.refresh || "",
          expiresAt: user.expiresAt || "",
          user: Object.assign({}, profile, { role: "companion" }),
          remember: true,
          portal: "companion",
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
        // Boss A leftover draft must not leak to Boss B
        localStorage.setItem(
          "mcjCompanionApplicationDraft.v1.u:" + aUid,
          JSON.stringify({
            step: 1,
            ownerUserId: aUid,
            data: { nickname: nickA },
            rulesAgreement: { accepted: true },
          })
        );
        localStorage.setItem(
          "mcjCompanionApplicationDraft.v1",
          JSON.stringify({ step: 1, data: { nickname: nickA } })
        );
      },
      { user: b, aUid: a.uid, nickA }
    );
    await page.goto(`${BASE}/companion-apply.html?t=${Date.now() + 2}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1600);
    const other = await page.evaluate((nick) => {
      const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
      const text = document.body.innerText || "";
      return {
        uid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
        nick: d.data?.nickname || "",
        showsNick: text.includes(nick),
        legacyGone: !localStorage.getItem("mcjCompanionApplicationDraft.v1"),
      };
    }, nickA);
    await shot(page, "03-boss-b-isolated");
    step(
      "boss_b_cannot_see_boss_a_draft",
      other.uid === b.uid && other.nick !== nickA && !other.showsNick,
      JSON.stringify(other)
    );
    await page.close();
  }

  // Boss A returns and resumes
  {
    const page = await openAsUser(browser, a, draftPayload(nickA));
    await page.waitForTimeout(1500);
    const resumed = await page.evaluate((nick) => {
      const d = window.MCJCompanionApplyDraft?.readDraft?.() || {};
      const text = document.body.innerText || "";
      return {
        uid: window.MCJCompanionApplyDraft?.authUserId?.() || "",
        nick: d.data?.nickname || "",
        step: d.step,
        showsNick: text.includes(nick) || d.data?.nickname === nick,
        showsLeak: text.includes("LEAKED_UNSCOPED_DRAFT") || d.data?.nickname === "LEAKED_UNSCOPED_DRAFT",
      };
    }, nickA);
    await shot(page, "04-boss-a-resume");
    step(
      "boss_a_resumes_own_draft",
      resumed.uid === a.uid && resumed.nick === nickA && !resumed.showsLeak,
      JSON.stringify(resumed)
    );
    await page.close();
  }

  await browser.close();
  const out = { base: BASE, useLocalJs: USE_LOCAL_JS, bossA: BOSS_A, bossB: BOSS_B, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result !== "PASS");
  console.log(`\nDone: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
