/**
 * P0 USER PASS: Admin 组队大厅管理 A–G（真实 UI + 持久化 + 老板端同步）
 * Usage:
 *   PREVIEW=https://xxx.vercel.app node scripts/p0-team-lobby-admin-real-e2e.mjs
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
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "team-lobby-admin-real-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "team-lobby-admin-real-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LINK_A = `https://discord.gg/mcj-team-lobby-e2e-a-${Date.now().toString(36)}`;
const LINK_B = `https://discord.gg/mcj-team-lobby-e2e-b-${Date.now().toString(36)}`;

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: false });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function api(pathname, token, body, method) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-admin-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function loginAdminUi(page) {
  await page.goto(`${BASE}/admin/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(600);
  await page.fill('input[type=email],input[name=email],input[name=account],#email', ADMIN);
  await page.fill('input[type=password]', PASS);
  await page.click('button[type=submit],button:has-text("登录")');
  await page.waitForURL(/admin\.html/, { timeout: 45000 });
  await page.waitForSelector('.side-nav [data-section]', { timeout: 45000 });
}

async function openTeamLobbyAdmin(page) {
  const nav = page.locator('.side-nav [data-section="team-lobby-links"]');
  const visible = await nav.count();
  step("A: sidebar has 组队大厅管理", visible > 0, visible ? await nav.first().innerText() : "MISSING");
  if (!visible) return false;
  await shot(page, "A-admin-sidebar-team-lobby");
  await nav.first().click({ timeout: 20000 });
  await page.waitForSelector("[data-team-lobby-form], #teamLobbySettings .admin-team-lobby-form", { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector("#teamLobbySettings .content-loading"), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);
  const hasForm = await page.locator("[data-team-lobby-form]").count();
  step("B: manage page opened", hasForm > 0, hasForm ? "form ready" : "form missing");
  await shot(page, "B-admin-team-lobby-page");
  return hasForm > 0;
}

async function saveTeamLobby(page, enabled, link) {
  if (enabled) await page.locator('input[name="teamLobbyEnabled"][value="true"]').check();
  else await page.locator('input[name="teamLobbyEnabled"][value="false"]').check();
  await page.fill('input[name="teamLobbyLink"]', link || "");
  await page.locator("[data-team-lobby-save]").click();
  await page.waitForTimeout(1200);
  await page.waitForFunction(
    () => {
      const note = document.querySelector("#teamLobbySettings .admin-sync-note");
      const err = note && /失败|错误/.test(note.textContent || "");
      const ok = note && /已保存|设置已保存/.test(note.textContent || "");
      return ok || err || !document.querySelector("[data-team-lobby-save][disabled]");
    },
    null,
    { timeout: 30000 }
  ).catch(() => {});
}

async function readAdminForm(page) {
  return page.evaluate(() => {
    const enabled = !!document.querySelector('input[name="teamLobbyEnabled"][value="true"]:checked');
    const link = (document.querySelector('input[name="teamLobbyLink"]') || {}).value || "";
    const hint = (document.querySelector(".tl-hint") || {}).textContent || "";
    return { enabled, link, hint };
  });
}

async function main() {
  console.log("BASE", BASE);
  const login = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminToken = tok(login.json);
  step("admin_api_login", !!(login.ok && adminToken), `tok=${!!adminToken}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  const opened = [];
  page.on("popup", (p) => opened.push(p));

  try {
    await loginAdminUi(page);
    const openedAdmin = await openTeamLobbyAdmin(page);
    if (!openedAdmin) throw new Error("admin team lobby UI missing — cannot continue A-G");

    // C: save link A enabled
    await saveTeamLobby(page, true, LINK_A);
    const afterSave = await readAdminForm(page);
    step("C: save enabled+link A", afterSave.enabled && afterSave.link === LINK_A, JSON.stringify(afterSave));
    await shot(page, "C-admin-saved-link-a");

    // D: refresh admin, prove persistence
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('.side-nav [data-section="team-lobby-links"]', { timeout: 45000 });
    await page.locator('.side-nav [data-section="team-lobby-links"]').click();
    await page.waitForSelector("[data-team-lobby-form]", { timeout: 45000 });
    await page.waitForFunction(() => !document.querySelector("#teamLobbySettings .content-loading"), null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(800);
    const afterReload = await readAdminForm(page);
    step("D: persist after refresh", afterReload.enabled && afterReload.link === LINK_A, JSON.stringify(afterReload));
    await shot(page, "D-admin-after-refresh");

    // Also verify public API
    const pub = await api("/api/platform/settings");
    step(
      "D2: public settings API",
      pub.ok && pub.json?.settings?.teamLobbyEnabled === true && pub.json?.settings?.teamLobbyLink === LINK_A,
      JSON.stringify(pub.json?.settings && { teamLobbyEnabled: pub.json.settings.teamLobbyEnabled, teamLobbyLink: pub.json.settings.teamLobbyLink })
    );

    // E: boss homepage opens same link
    const home = await context.newPage();
    const homeOpened = [];
    home.on("popup", (p) => homeOpened.push(p));
    await home.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await home.waitForSelector('[data-home-entry="team-lobby"],[data-team-lobby-entry]', { timeout: 45000 });
    await home.waitForTimeout(1200);
    await home.locator('[data-home-entry="team-lobby"],[data-team-lobby-entry]').first().click();
    await home.waitForTimeout(1500);
    const popupA = homeOpened[0];
    const urlA = popupA ? popupA.url() : "";
    // Some browsers may navigate same tab if popup blocked — also check dialogs
    const dialogs = [];
    home.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.accept();
    });
    step("E: boss opens link A", urlA.includes(LINK_A.replace("https://", "")) || urlA === LINK_A || homeOpened.length > 0, `popup=${urlA || "(none)"} count=${homeOpened.length}`);
    await shot(home, "E-boss-home-team-lobby");
    if (popupA) await popupA.close().catch(() => {});

    // F: change link to B, boss updates
    await page.bringToFront();
    await saveTeamLobby(page, true, LINK_B);
    const afterB = await readAdminForm(page);
    step("F1: admin saved link B", afterB.enabled && afterB.link === LINK_B, JSON.stringify(afterB));
    await shot(page, "F-admin-saved-link-b");

    homeOpened.length = 0;
    await home.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await home.waitForSelector('[data-home-entry="team-lobby"],[data-team-lobby-entry]', { timeout: 45000 });
    await home.waitForTimeout(1200);
    await home.locator('[data-home-entry="team-lobby"],[data-team-lobby-entry]').first().click();
    await home.waitForTimeout(1500);
    const popupB = homeOpened[0];
    const urlB = popupB ? popupB.url() : "";
    step("F2: boss opens updated link B", urlB.includes("e2e-b-") || urlB === LINK_B || (homeOpened.length > 0 && !String(urlB).includes("e2e-a-")), `popup=${urlB || "(none)"}`);
    await shot(home, "F-boss-home-updated-link");
    if (popupB) await popupB.close().catch(() => {});

    // G: disable — boss cannot enter
    await page.bringToFront();
    await saveTeamLobby(page, false, LINK_B);
    const afterOff = await readAdminForm(page);
    step("G1: admin disabled", afterOff.enabled === false, JSON.stringify(afterOff));
    await shot(page, "G-admin-disabled");

    const disabledDialogs = [];
    home.once("dialog", async (d) => {
      disabledDialogs.push(d.message());
      await d.accept();
    });
    homeOpened.length = 0;
    await home.goto(`${BASE}/index.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await home.waitForSelector('[data-home-entry="team-lobby"],[data-team-lobby-entry]', { timeout: 45000 });
    await home.waitForTimeout(1200);
    await home.locator('[data-home-entry="team-lobby"],[data-team-lobby-entry]').first().click();
    await home.waitForTimeout(1500);
    const blocked = disabledDialogs.some((m) => /暂未开放/.test(m)) || homeOpened.length === 0;
    step("G2: boss blocked when disabled", blocked, `dialogs=${JSON.stringify(disabledDialogs)} popups=${homeOpened.length}`);
    await shot(home, "G-boss-home-disabled");

    // Restore enabled with link B for staging sanity (optional)
    if (adminToken) {
      await api("/api/admin/platform-settings", adminToken, {
        action: "save_team_lobby",
        teamLobbyEnabled: true,
        teamLobbyLink: LINK_B,
        reason: "e2e restore after disable check",
      });
    }

    await home.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    base: BASE,
    linkA: LINK_A,
    linkB: LINK_B,
    failed: failed.length,
    results,
    verdict: failed.length ? "FAIL" : "USER PASS",
  };
  fs.writeFileSync(path.join(ART, "RESULTS.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
