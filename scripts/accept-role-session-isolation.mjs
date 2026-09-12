/**
 * P0: prove four-end login identity isolation (no CS JWT on boss soft session, etc).
 * Usage: node scripts/accept-role-session-isolation.mjs [baseUrl]
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
  boss: "boss.final.1785714993009@meow.test",
  customer_service: "service.final.1785714993009@meow.test",
  companion: "companion.idcard.1785715257525@meow.test",
  admin: "admin@meow.test",
};

const KEYS = [
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

function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "customer" || r === "boss") return "boss";
  if (r === "service" || r === "customer_service") return "customer_service";
  if (r === "player" || r === "companion") return "companion";
  if (r === "super_admin" || r === "admin") return "admin";
  return r;
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

async function me(token) {
  const res = await fetch(`${BASE}/api/auth?action=me`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.user) throw new Error(`me failed: ${body.message || res.status}`);
  return body.user;
}

async function applyRoleLogin(page, role, session) {
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ role, session, keys }) => {
      keys.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      if (window.MCJRoleGate && typeof window.MCJRoleGate.saveSession === "function") {
        window.MCJRoleGate.saveSession(session, true);
        if (typeof window.MCJRoleGate.syncPortalSessions === "function") {
          window.MCJRoleGate.syncPortalSessions(session, true);
        }
        return { via: "role-gate" };
      }
      // Fallback mirrors (should not happen on staging index).
      localStorage.setItem("mcjAuthAccessToken", session.accessToken || "");
      localStorage.setItem("mcjAuthRefreshToken", session.refreshToken || "");
      localStorage.setItem("mcjRole", (session.user && session.user.role) || role);
      return { via: "fallback" };
    },
    { role, session, keys: KEYS }
  );
}

async function snapshot(page) {
  return page.evaluate((keys) => {
    const out = {};
    keys.forEach((k) => {
      out[k] = localStorage.getItem(k) || sessionStorage.getItem(k) || null;
    });
    const gate = window.MCJRoleGate;
    out._isBoss = !!(gate && (gate.isLogged("boss") || gate.isLogged("customer")));
    out._isCs = !!(gate && gate.isLogged("customer_service"));
    out._isCompanion = !!(gate && gate.isLogged("companion"));
    out._isAdmin = !!(gate && gate.isLogged("admin"));
    out._hasPortalCs = !!(gate && gate.hasPortalSession && gate.hasPortalSession("customer_service"));
    out._hasPortalCompanion = !!(gate && gate.hasPortalSession && gate.hasPortalSession("companion"));
    return out;
  }, KEYS);
}

function expectExclusive(snap, role) {
  const issues = [];
  const nr = normalizeRole(role);
  const shared = normalizeRole(snap.mcjRole);
  if (shared && shared !== nr) issues.push(`mcjRole=${snap.mcjRole} expected ${nr}`);
  if (nr === "boss") {
    if (!snap.customerAuthToken) issues.push("missing customerAuthToken");
    if (snap.mcjServiceSession) issues.push("boss login left mcjServiceSession");
    if (snap.customerServiceAuthToken) issues.push("boss login left CS soft token");
    if (snap.mcjCompanionSession) issues.push("boss login left companion session");
    if (snap.adminAuthToken) issues.push("boss login left admin token");
    if (!snap._isBoss) issues.push("isLogged(boss) false");
    if (snap._isCs) issues.push("isLogged(cs) true after boss");
  }
  if (nr === "customer_service") {
    if (!snap.mcjServiceSession && !snap.customerServiceAuthToken) issues.push("missing CS session");
    if (snap.customerAuthToken) issues.push("CS login left boss soft token");
    if (snap.mcjCompanionSession) issues.push("CS login left companion session");
    if (snap.adminAuthToken) issues.push("CS login left admin token");
    if (snap._isBoss) issues.push("isLogged(boss) true after CS");
  }
  if (nr === "companion") {
    if (!snap.mcjCompanionSession && !snap.companionAuthToken) issues.push("missing companion session");
    if (snap.customerAuthToken) issues.push("companion login left boss soft token");
    if (snap.mcjServiceSession) issues.push("companion login left CS session");
    if (snap._isBoss) issues.push("isLogged(boss) true after companion");
  }
  if (nr === "admin") {
    if (!snap.adminAuthToken) issues.push("missing adminAuthToken");
    if (snap.customerAuthToken) issues.push("admin login left boss soft token");
    if (snap.mcjServiceSession) issues.push("admin login left CS session");
    if (snap._isBoss) issues.push("isLogged(boss) true after admin");
  }
  return issues;
}

const results = { base: BASE, at: new Date().toISOString(), steps: [], ok: true };

const chromePath = resolveChrome();
let browser;
try {
  browser = await chromium.launch(
    chromePath
      ? { headless: true, executablePath: chromePath }
      : { channel: "chrome", headless: true }
  );
} catch (e1) {
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch (e2) {
    throw new Error(`browser launch failed: ${e1.message}; ${e2.message}`);
  }
}
const page = await browser.newPage();

try {
  // 1) API role sanity
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const session = await loginApi(email);
    const user = await me(session.accessToken);
    const got = normalizeRole(user.role);
    const want = normalizeRole(role);
    const pass = got === want;
    results.steps.push({ step: `api-me:${role}`, pass, email, role: user.role });
    if (!pass) results.ok = false;
  }

  // 2) Simulate CS login then boss login (the bleed repro)
  {
    const cs = await loginApi(ACCOUNTS.customer_service);
    await applyRoleLogin(page, "customer_service", cs);
    // Also mimic old CS persistAuthMirrors without clearing boss (inject stale boss soft session)
    await page.evaluate(() => {
      localStorage.setItem("customerAuthToken", "customer_session_v4_stale");
      localStorage.setItem("customerUser", JSON.stringify({ role: "boss", email: "stale-boss@meow.test" }));
    });
    // Now login as boss via RoleGate — must wipe CS + stale conflict
    const boss = await loginApi(ACCOUNTS.boss);
    await page.evaluate((session) => {
      window.MCJRoleGate.saveSession(session, true);
      if (window.MCJRoleGate.syncPortalSessions) window.MCJRoleGate.syncPortalSessions(session, true);
    }, boss);
    const snap = await snapshot(page);
    const issues = expectExclusive(snap, "boss");
    // Support chat must not treat session as CS
    await page.goto(`${BASE}/support.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const tip = await page.evaluate(() => {
      const t = document.body ? document.body.innerText : "";
      return {
        hasCsTip: /当前登录的是客服账号/.test(t),
        isBossLogged: !!(window.MCJRoleGate && (window.MCJRoleGate.isLogged("boss") || window.MCJRoleGate.isLogged("customer"))),
        mcjRole: localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole"),
        hasServiceSession: !!(localStorage.getItem("mcjServiceSession") || sessionStorage.getItem("mcjServiceSession")),
      };
    });
    const pass = issues.length === 0 && tip.hasCsTip === false && tip.isBossLogged === true && tip.hasServiceSession === false;
    results.steps.push({
      step: "bleed-repro:cs-then-boss",
      pass,
      issues,
      tip,
      snap: {
        mcjRole: snap.mcjRole,
        hasCsBlob: !!snap.mcjServiceSession,
        hasBossSoft: !!snap.customerAuthToken,
        isBoss: snap._isBoss,
      },
    });
    if (!pass) results.ok = false;
  }

  // 3) Switch through each role; each must be exclusive
  for (const role of ["boss", "customer_service", "companion", "admin"]) {
    const session = await loginApi(ACCOUNTS[role]);
    await applyRoleLogin(page, role, session);
    // CS portal also goes through MCJServiceAuth when available
    if (role === "customer_service") {
      await page.goto(`${BASE}/customer-service/login/`, { waitUntil: "domcontentloaded" });
      await page.evaluate((session) => {
        if (window.MCJServiceAuth && window.MCJServiceAuth.saveSession) {
          window.MCJServiceAuth.saveSession(
            {
              token: session.accessToken,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              expiresAt: session.expiresAt,
              user: session.user,
            },
            true
          );
        } else if (window.MCJRoleGate) {
          window.MCJRoleGate.saveSession(session, true);
          window.MCJRoleGate.syncPortalSessions(session, true);
        }
      }, session);
    }
    const snap = await snapshot(page);
    const user = await me(snap.mcjAuthAccessToken);
    const issues = expectExclusive(snap, role);
    if (normalizeRole(user.role) !== normalizeRole(role)) {
      issues.push(`/me role ${user.role} != ${role}`);
    }
    const pass = issues.length === 0;
    results.steps.push({
      step: `exclusive:${role}`,
      pass,
      issues,
      meRole: user.role,
      mcjRole: snap.mcjRole,
    });
    if (!pass) results.ok = false;
  }

  // 4) Boss after CS ServiceAuth.saveSession (exact production path)
  {
    const cs = await loginApi(ACCOUNTS.customer_service);
    await page.goto(`${BASE}/customer-service/login/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((session) => {
      ["customerAuthToken", "customerUser", "mcjAuthAccessToken", "mcjRole"].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      // Pre-seed a boss soft session like a previous tab
      localStorage.setItem("customerAuthToken", "customer_session_v4_prev");
      localStorage.setItem("customerUser", JSON.stringify({ role: "boss", email: "prev@meow.test" }));
      if (window.MCJServiceAuth && window.MCJServiceAuth.saveSession) {
        window.MCJServiceAuth.saveSession(
          {
            token: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt,
            user: session.user,
          },
          true
        );
      }
    }, cs);
    let snap = await snapshot(page);
    let issues = [];
    if (snap.customerAuthToken) issues.push("CS ServiceAuth left boss soft token");
    if (snap._isBoss) issues.push("isLogged(boss) after CS ServiceAuth");
    const boss = await loginApi(ACCOUNTS.boss);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate((session) => {
      window.MCJRoleGate.saveSession(session, true);
    }, boss);
    snap = await snapshot(page);
    issues = issues.concat(expectExclusive(snap, "boss"));
    await page.goto(`${BASE}/support.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const bodyText = await page.evaluate(() => (document.body && document.body.innerText) || "");
    if (/当前登录的是客服账号/.test(bodyText)) issues.push("support shows CS tip after boss login");
    const pass = issues.length === 0;
    results.steps.push({ step: "serviceAuth-then-boss-support", pass, issues });
    if (!pass) results.ok = false;
  }
} catch (err) {
  results.ok = false;
  results.error = String(err && err.stack ? err.stack : err);
} finally {
  await browser.close();
}

const outPath = path.join(ROOT, "scripts/accept-role-session-isolation-results.json");
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ok: results.ok, steps: results.steps.length, outPath }, null, 2));
for (const s of results.steps) {
  console.log(`${s.pass ? "PASS" : "FAIL"}\t${s.step}${s.issues && s.issues.length ? "\t" + s.issues.join("; ") : ""}`);
}
if (results.error) console.error(results.error);
process.exit(results.ok ? 0 : 1);
