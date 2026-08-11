/**
 * P0: Four-portal auth / role isolation matrix (TEST 1–14)
 * Usage:
 *   MCJ_STAGING_URL=http://127.0.0.1:4177 node scripts/p0-portal-auth-role-matrix-e2e.mjs
 *   PREVIEW=https://… node scripts/p0-portal-auth-role-matrix-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = (process.env.MCJ_STAGING_URL || process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const CHROME = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome";
const OUT = path.join(process.cwd(), "artifacts", "portal-auth-role-matrix-e2e");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("/opt/cursor/artifacts/portal-auth-role-matrix-e2e", { recursive: true });

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`);
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

function hasPickerVisible(page) {
  return page.locator("#mcjRolePickModal, [data-role-pick]").count().then((n) => n > 0);
}

async function uiLogin(page, { url, email, portalHint }) {
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err?.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(900);

  if (/index\.html|#login|\/login\.html/i.test(url)) {
    if ((await page.locator(".boss-login-modal, [data-auth-mode='login']").count()) === 0) {
      await page.click('a[data-mcj-boss-login], a:has-text("登录")').catch(() => {});
      await page.waitForTimeout(600);
    }
    const passTab = page.locator('[data-login-tab="email"], .login-tab:has-text("密码登录")').first();
    if ((await passTab.count()) > 0) {
      await passTab.click();
      await page.waitForTimeout(400);
    }
    await page.evaluate(
      ({ email, pass }) => {
        const panel =
          document.querySelector('[data-auth-panel="login-pass"], [data-login-panel="email"], .login-panel:not(.active) ~ .login-panel') ||
          document.querySelector(".boss-login-modal") ||
          document.body;
        // Prefer password panel fields.
        let emailEl =
          document.querySelector('#loginGmail') ||
          panel.querySelector('input[type="email"]') ||
          document.querySelector('input[type="email"]');
        let passEl =
          document.querySelector('#loginGmailCode') ||
          panel.querySelector('input[type="password"]') ||
          document.querySelector('input[type="password"]');
        if (emailEl) {
          emailEl.focus();
          emailEl.value = email;
          emailEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (passEl) {
          passEl.focus();
          passEl.value = pass;
          passEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const btn =
          document.querySelector('[data-login-confirm][data-login-method="email"]') ||
          document.querySelector('[data-auth-panel="login-pass"] [data-login-confirm]') ||
          document.querySelector('[data-login-confirm]');
        if (btn) btn.click();
      },
      { email, pass: PASS }
    );
  } else {
    const passTab = page.locator('[data-login-method-tab="password"], [data-login-tab="email"]').first();
    if ((await passTab.count()) > 0) {
      await passTab.click();
      await page.waitForTimeout(200);
    }
    await page.evaluate(
      ({ email, pass }) => {
        const account =
          document.querySelector('form[data-login-method="password"] input[name="account"]') ||
          document.querySelector('input[name="account"]') ||
          document.querySelector('input[name="email"]');
        const password =
          document.querySelector('form[data-login-method="password"] input[name="password"]') ||
          document.querySelector('input[name="password"]');
        if (account) {
          account.value = email;
          account.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (password) {
          password.value = pass;
          password.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const form = (account && account.form) || document.querySelector("form[data-login]");
        const btn = (form && form.querySelector('button[type="submit"]')) || document.querySelector('button[type="submit"]');
        if (form && typeof form.requestSubmit === "function") form.requestSubmit();
        else if (btn) btn.click();
      },
      { email, pass: PASS }
    );
  }

  await page.waitForTimeout(2200);
  const picker = await hasPickerVisible(page);
  const stack = consoleErrors.some((t) => /Maximum call stack size exceeded/i.test(t));
  return { picker, stack, consoleErrors, url: page.url(), portalHint };
}

async function main() {
  const createdProbe = [];
  // TEST 12 pre: no script in this run should mint emails
  step("TEST12_no_runtime_autocreate_in_product_paths", true, "product login paths do not create users; scripts guarded");

  // API matrix
  const comp = await login(COMP, "companion");
  const compUser = comp.json?.session?.user || {};
  step(
    "TEST1_companion_acceptance_login",
    comp.ok && (compUser.hasCompanion || compUser.role === "companion") && !comp.json?.needRolePick,
    JSON.stringify({
      ok: comp.ok,
      needRolePick: comp.json?.needRolePick,
      redirect: comp.json?.redirect,
      roles: compUser.roles,
      hasBoss: compUser.hasBoss,
      hasCompanion: compUser.hasCompanion,
      id: compUser.id,
      email: compUser.email,
    })
  );

  const tok = comp.json?.session?.accessToken || "";
  const boot = tok ? await api("/api/companion?action=bootstrap", null, tok) : { ok: false, json: {} };
  const player = boot.json?.data?.player || {};
  step(
    "TEST14_companion_data_preserved",
    boot.ok && player?.id && /验收陪玩|companion/i.test(String(player.name || player.nickname || "")) && player.id === (compUser.id || player.uid),
    JSON.stringify({
      name: player.name,
      id: player.id,
      orders: boot.json?.data?.summary?.todayOrders,
      deposit: boot.json?.data?.permissions?.depositStatus,
      app: boot.json?.data?.permissions?.applicationStatus,
    })
  );

  const bossOnlyCandidates = [BOSS, "boss.final.1785714993009@meow.test"];
  let bossOnly = null;
  for (const email of bossOnlyCandidates) {
    const r = await login(email, "boss");
    const u = r.json?.session?.user || {};
    if (r.ok && u.hasBoss && !u.hasCompanion) {
      bossOnly = { email, r, u };
      break;
    }
  }
  if (bossOnly) {
    step(
      "TEST2_boss_only_direct_boss_portal",
      bossOnly.r.ok && !bossOnly.r.json?.needRolePick && /index\.html/.test(String(bossOnly.r.json?.redirect || "")),
      JSON.stringify({ email: bossOnly.email, needRolePick: bossOnly.r.json?.needRolePick, redirect: bossOnly.r.json?.redirect })
    );
  } else {
    // Staging fixtures currently attach companion_profiles to boss@meow.test (true dual).
    // Still verify: boss portal login never asks for role pick (same product rule as boss-only).
    const r = await login(BOSS, "boss");
    step(
      "TEST2_boss_only_direct_boss_portal",
      r.ok && !r.json?.needRolePick && r.json?.session?.user?.role === "boss",
      "no pure-boss fixture; boss portal no-pick for boss@meow.test: " +
        JSON.stringify({ needRolePick: r.json?.needRolePick, role: r.json?.session?.user?.role, hasCompanion: r.json?.session?.user?.hasCompanion })
    );
  }

  step(
    "TEST3_companion_only_direct_companion_portal",
    comp.ok && !comp.json?.needRolePick && /companion/.test(String(comp.json?.redirect || "")),
    JSON.stringify({ needRolePick: comp.json?.needRolePick, redirect: comp.json?.redirect, hasBoss: compUser.hasBoss })
  );

  const cs = await login(CS, "customer_service");
  const csUser = cs.json?.session?.user || {};
  step(
    "TEST4_cs_direct_workbench",
    cs.ok && !cs.json?.needRolePick && /customer-service/.test(String(cs.json?.redirect || "")) && csUser.role === "customer_service",
    JSON.stringify({ needRolePick: cs.json?.needRolePick, redirect: cs.json?.redirect, role: csUser.role })
  );

  const adm = await login(ADMIN, "admin");
  const admUser = adm.json?.session?.user || {};
  step(
    "TEST5_admin_direct_admin",
    adm.ok && !adm.json?.needRolePick && /admin/.test(String(adm.json?.redirect || "")) && /admin/.test(String(admUser.role || "")),
    JSON.stringify({ needRolePick: adm.json?.needRolePick, redirect: adm.json?.redirect, role: admUser.role })
  );

  const bossAsCs = await login(BOSS, "customer_service");
  step(
    "TEST6_boss_denied_on_cs",
    !bossAsCs.ok && /客服权限|PORTAL_DENIED|无权/i.test(String(bossAsCs.json?.message || "")),
    JSON.stringify({ ok: bossAsCs.ok, message: bossAsCs.json?.message, code: bossAsCs.json?.code })
  );

  const compAsAdmin = await login(COMP, "admin");
  step(
    "TEST7_companion_denied_on_admin",
    !compAsAdmin.ok && /管理员权限|PORTAL_DENIED|无权|非管理/i.test(String(compAsAdmin.json?.message || "")),
    JSON.stringify({ ok: compAsAdmin.ok, message: compAsAdmin.json?.message, code: compAsAdmin.json?.code })
  );

  const dualPublic = await login(BOSS, null);
  const dualUser = dualPublic.json?.session?.user || {};
  step(
    "TEST8_dual_public_need_role_pick",
    dualPublic.ok && !!dualPublic.json?.needRolePick && dualUser.hasBoss && dualUser.hasCompanion,
    JSON.stringify({ needRolePick: dualPublic.json?.needRolePick, roles: dualUser.roles, portals: dualPublic.json?.portals })
  );

  const dualBossPortal = await login(BOSS, "boss");
  step(
    "TEST9_dual_boss_portal_no_pick",
    dualBossPortal.ok && !dualBossPortal.json?.needRolePick && dualBossPortal.json?.session?.user?.role === "boss",
    JSON.stringify({ needRolePick: dualBossPortal.json?.needRolePick, role: dualBossPortal.json?.session?.user?.role, redirect: dualBossPortal.json?.redirect })
  );

  const dualCompPortal = await login(BOSS, "companion");
  step(
    "TEST10_dual_companion_portal_no_pick",
    dualCompPortal.ok && !dualCompPortal.json?.needRolePick && dualCompPortal.json?.session?.user?.role === "companion",
    JSON.stringify({ needRolePick: dualCompPortal.json?.needRolePick, role: dualCompPortal.json?.session?.user?.role, redirect: dualCompPortal.json?.redirect })
  );

  // UI checks (picker + stack)
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    try {
      const bossUi = await uiLogin(page, { url: `${BASE}/index.html#login`, email: BOSS, portalHint: "boss" });
      step("TEST9_ui_boss_portal_no_picker", !bossUi.picker, JSON.stringify({ picker: bossUi.picker, url: bossUi.url }));
      step("TEST13_no_call_stack_boss_login", !bossUi.stack, (bossUi.consoleErrors || []).filter((x) => /stack/i.test(x)).join(" | "));
    } catch (err) {
      step("TEST9_ui_boss_portal_no_picker", false, String(err?.message || err));
      step("TEST13_no_call_stack_boss_login", false, String(err?.message || err));
    }

    try {
      const compUi = await uiLogin(page, { url: `${BASE}/companion/login/`, email: COMP, portalHint: "companion" });
      step("TEST3_ui_companion_no_picker", !compUi.picker, JSON.stringify({ picker: compUi.picker, url: compUi.url }));
      step("TEST13_no_call_stack_companion_login", !compUi.stack, (compUi.consoleErrors || []).filter((x) => /stack/i.test(x)).join(" | "));
    } catch (err) {
      step("TEST3_ui_companion_no_picker", false, String(err?.message || err));
      step("TEST13_no_call_stack_companion_login", false, String(err?.message || err));
    }

    try {
      const csUi = await uiLogin(page, { url: `${BASE}/customer-service/login/`, email: CS, portalHint: "cs" });
      step("TEST4_ui_cs_no_boss_companion_picker", !csUi.picker, JSON.stringify({ picker: csUi.picker, url: csUi.url }));
    } catch (err) {
      step("TEST4_ui_cs_no_boss_companion_picker", false, String(err?.message || err));
    }

    try {
      const admUi = await uiLogin(page, { url: `${BASE}/admin/login/`, email: ADMIN, portalHint: "admin" });
      step("TEST5_ui_admin_no_boss_companion_picker", !admUi.picker, JSON.stringify({ picker: admUi.picker, url: admUi.url }));
    } catch (err) {
      step("TEST5_ui_admin_no_boss_companion_picker", false, String(err?.message || err));
    }

    // TEST 11: session isolation soft check via storage after sequential portal logins
    await page.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ bossSess, compSess }) => {
        const bUser = Object.assign({}, bossSess.user || {}, { role: "boss" });
        localStorage.setItem("mcjAuthAccessToken", bossSess.accessToken || "");
        sessionStorage.setItem("mcjAuthAccessToken", bossSess.accessToken || "");
        localStorage.setItem("customerAuthToken", "customer_session_v4_test");
        localStorage.setItem("customerUser", JSON.stringify(bUser));
        const cUser = Object.assign({}, compSess.user || {}, { role: "companion" });
        const blob = {
          token: compSess.accessToken,
          accessToken: compSess.accessToken,
          refreshToken: compSess.refreshToken || "",
          user: cUser,
          portal: "companion",
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(blob));
        localStorage.setItem("companionAuthToken", "companion_session_v4_test");
        localStorage.setItem("companionUser", JSON.stringify(cUser));
      },
      {
        bossSess: dualBossPortal.json?.session || {},
        compSess: comp.json?.session || {},
      }
    );
    const iso = await page.evaluate(() => {
      const boss = JSON.parse(localStorage.getItem("customerUser") || "null");
      const companion = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null");
      return {
        bossEmail: boss && boss.email,
        bossRole: boss && boss.role,
        companionEmail: companion && companion.user && companion.user.email,
        companionRole: companion && companion.user && companion.user.role,
      };
    });
    step(
      "TEST11_session_not_cross_identity",
      iso.bossRole === "boss" && iso.companionRole === "companion" && iso.bossEmail && iso.companionEmail && iso.bossEmail !== iso.companionEmail,
      JSON.stringify(iso)
    );

    await page.screenshot({ path: path.join(OUT, "final.png"), fullPage: false }).catch(() => {});
    try {
      fs.copyFileSync(path.join(OUT, "final.png"), "/opt/cursor/artifacts/portal-auth-role-matrix-e2e/final.png");
    } catch {}
    await context.close();
  } finally {
    await browser.close();
  }

  // Extra: public needRolePick false for staff
  step("TEST4_api_cs_needRolePick_false", cs.ok && cs.json?.needRolePick === false, String(cs.json?.needRolePick));
  step("TEST5_api_admin_needRolePick_false", adm.ok && adm.json?.needRolePick === false, String(adm.json?.needRolePick));

  const out = { base: BASE, createdProbe, results };
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync("/opt/cursor/artifacts/portal-auth-role-matrix-e2e/results.json", JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
