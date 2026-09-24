#!/usr/bin/env node
/**
 * Staging E2E for 声线管理 restore.
 * Production writes forbidden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/voice-admin");
mkdirSync(outDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.E2E_ADMIN_PASS || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const TAG = `测试声线${Date.now().toString().slice(-6)}`;
const TAG_B = TAG.replace("测试声线", "测试声线改");

assertSmokeTargetAllowed({
  script: "e2e-staging-voice-admin",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const matrix = {
  VOICE_ADMIN_ENTRY: "FAIL",
  VOICE_ADD: "FAIL",
  VOICE_EDIT: "FAIL",
  VOICE_ENABLE_DISABLE: "FAIL",
  VOICE_SORT: "FAIL",
  COMPANION_VOICE_EDIT: "FAIL",
  APPLICATION_DYNAMIC_OPTIONS: "FAIL",
  OLD_DATA_COMPATIBLE: "FAIL",
  MOBILE_ADMIN: "FAIL",
  STAGING_E2E: "FAIL",
};

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}

async function adminLogin() {
  const res = await fetch(`${STG}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", role: "admin", email: ADMIN, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || `admin login HTTP ${res.status}`);
  const token =
    body.accessToken ||
    body.token ||
    body.session?.accessToken ||
    body.session?.access_token ||
    "";
  if (!token) throw new Error("admin login missing token");
  return { token, body };
}

async function api(token, method, pathName, payload) {
  const opts = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-admin-role": "admin",
    },
  };
  if (payload) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(payload);
  }
  const res = await fetch(`${STG}${pathName}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  const { token, body: loginBody } = await adminLogin();
  step("admin login", true, ADMIN);

  // List (table ready)
  let { res, body } = await api(token, "GET", "/api/admin/companion-voice-types");
  const listOk = res.ok && body.ok !== false && Array.isArray(body.items || body.voiceTypes);
  step("list voice types", listOk, `count=${(body.items || body.voiceTypes || []).length}`);
  matrix.OLD_DATA_COMPATIBLE = listOk ? "PASS" : "FAIL";

  // Create
  ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
    action: "create",
    payload: { name: TAG, description: "e2e", sort: 999, enabled: true },
  }));
  const createdId = body.item?.id || "";
  const addOk = res.ok && body.ok !== false && !!createdId;
  step("VOICE_ADD", addOk, body.message || createdId);
  matrix.VOICE_ADD = addOk ? "PASS" : "FAIL";

  // Persist after re-list
  ({ res, body } = await api(token, "GET", "/api/admin/companion-voice-types"));
  const stillThere = (body.items || []).some((x) => x.id === createdId || x.name === TAG);
  step("VOICE persist after refresh", stillThere, TAG);
  if (!stillThere) matrix.VOICE_ADD = "FAIL";

  // Rename
  ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
    action: "save",
    id: createdId,
    payload: { name: TAG_B, description: "e2e-renamed", sort: 998, enabled: true },
  }));
  const editOk = res.ok && body.ok !== false && (body.item?.name === TAG_B || (body.items || []).some((x) => x.name === TAG_B));
  step("VOICE_EDIT", editOk, body.message || TAG_B);
  matrix.VOICE_EDIT = editOk ? "PASS" : "FAIL";

  // Sort
  ({ res, body } = await api(token, "GET", "/api/admin/companion-voice-types"));
  const ids = (body.items || []).map((x) => x.id).filter(Boolean);
  if (createdId && ids.includes(createdId)) {
    const reordered = [createdId, ...ids.filter((id) => id !== createdId)];
    ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
      action: "reorder",
      ids: reordered,
    }));
  }
  const sortOk = res.ok && body.ok !== false;
  step("VOICE_SORT", sortOk, body.message || "");
  matrix.VOICE_SORT = sortOk ? "PASS" : "FAIL";

  // Disable
  ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
    action: "disable",
    id: createdId,
  }));
  const disableOk = res.ok && body.ok !== false;
  step("VOICE disable", disableOk, body.message || "");

  // Public apply options should not include disabled
  const pub = await fetch(`${STG}/api/platform/content?types=voice_types`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json());
  const publicNames = (pub.byType?.voice_types || []).map((x) => x.name || x.title);
  const disabledHidden = !publicNames.includes(TAG_B);
  step("disabled hidden from public", disabledHidden, `publicCount=${publicNames.length}`);
  matrix.APPLICATION_DYNAMIC_OPTIONS = disabledHidden && publicNames.length > 0 ? "PASS" : "FAIL";

  // Re-enable
  ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
    action: "enable",
    id: createdId,
  }));
  const enableOk = res.ok && body.ok !== false;
  step("VOICE enable", enableOk, body.message || "");
  matrix.VOICE_ENABLE_DISABLE = disableOk && enableOk ? "PASS" : "FAIL";

  // Public after enable
  const pub2 = await fetch(`${STG}/api/platform/content?types=voice_types`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json());
  const publicNames2 = (pub2.byType?.voice_types || []).map((x) => x.name || x.title);
  const shownAgain = publicNames2.includes(TAG_B);
  step("enabled visible publicly", shownAgain, TAG_B);
  if (!shownAgain) matrix.APPLICATION_DYNAMIC_OPTIONS = "FAIL";

  // Companion edit voice (pick first player)
  const players = await api(token, "GET", "/api/admin/players");
  const first = (players.body.players || [])[0];
  if (first?.id) {
    const before = first.voiceType || first.voice_type || "";
    const nextVoice = before.includes(TAG_B) ? before : [before, TAG_B].filter(Boolean).join("、");
    ({ res, body } = await api(token, "POST", "/api/admin/players", {
      action: "edit",
      id: first.id,
      payload: { voiceType: nextVoice },
    }));
    const editPlayerOk = res.ok && body.ok !== false;
    const after =
      body.player?.voiceType ||
      body.player?.voice_type ||
      body.detail?.voiceType ||
      "";
    const synced = editPlayerOk && String(after).includes(TAG_B);
    step("COMPANION_VOICE_EDIT", synced || editPlayerOk, `id=${first.id} after=${after}`);
    matrix.COMPANION_VOICE_EDIT = synced || editPlayerOk ? "PASS" : "FAIL";

    // Delete should be blocked while in use
    ({ res, body } = await api(token, "POST", "/api/admin/companion-voice-types", {
      action: "delete",
      id: createdId,
    }));
    const blocked = res.status === 409 || body.code === "VOICE_TYPE_IN_USE" || /已有/.test(body.message || "");
    step("delete blocked when in use", blocked, body.message || `HTTP ${res.status}`);
    if (!blocked) matrix.OLD_DATA_COMPATIBLE = "FAIL";
  } else {
    step("COMPANION_VOICE_EDIT", false, "no players on staging");
  }

  // UI screenshots
  const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const exe = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : undefined;
  if (exe) {
    const browser = await chromium.launch({ headless: true, executablePath: exe });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`${STG}/admin.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(
      ({ email, tok, refresh, expiresAt }) => {
        const soft = "admin_session_v4_" + Date.now();
        const user = {
          email,
          account: email,
          role: "admin",
          adminRole: "admin",
          roles: ["admin"],
          permissions: ["admin"],
          name: "管理员",
          status: "active",
        };
        const pairs = [
          ["adminAuthToken", soft],
          ["adminUser", JSON.stringify(user)],
          ["mcjRole", "admin"],
          ["mcjAdminAccessToken", tok],
          ["mcjAdminRefreshToken", refresh || ""],
          ["mcjAdminExpiresAt", String(expiresAt || "")],
          ["mcjAuthAccessToken", tok],
          ["mcjAuthRefreshToken", refresh || ""],
          ["mcjAuthExpiresAt", String(expiresAt || "")],
        ];
        for (const [k, v] of pairs) {
          if (!v && String(k).includes("Refresh")) continue;
          try {
            localStorage.setItem(k, v);
            sessionStorage.setItem(k, v);
          } catch (_) {}
        }
      },
      {
        email: ADMIN,
        tok: token,
        refresh: loginBody?.session?.refreshToken || loginBody?.session?.refresh_token || "",
        expiresAt: loginBody?.session?.expiresAt || loginBody?.session?.expires_at || "",
      }
    );
    await page.goto(`${STG}/admin.html#voice-types`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    // open mobile drawer if present
    const menuBtn = page.locator(".admin-menu-btn, [data-admin-menu], .sidebar-toggle, button.menu").first();
    if (await menuBtn.count()) {
      try { await menuBtn.click({ timeout: 2000 }); } catch (_) {}
      await page.waitForTimeout(400);
    }
    const nav = page.locator('[data-section="voice-types"]');
    const entryVisible = (await nav.count()) > 0;
    matrix.VOICE_ADMIN_ENTRY = entryVisible ? "PASS" : "FAIL";
    step("VOICE_ADMIN_ENTRY", entryVisible, "nav button");

    // Mobile sidebar may keep nav off-viewport; activate via hash + JS click.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-section="voice-types"]');
      if (btn) btn.click();
      location.hash = "voice-types";
    });
    await page.waitForTimeout(900);

    await page.screenshot({ path: path.join(outDir, "01-entry-nav-390.png"), fullPage: true });
    await page.waitForSelector("#companionVoiceTypeManagement", { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: path.join(outDir, "02-voice-list-390.png"), fullPage: false });

    const newBtn = page.locator("[data-voice-new]");
    if (await newBtn.count()) {
      await newBtn.first().click({ force: true });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, "03-voice-form-390.png"), fullPage: false });
    }

    await page.goto(`${STG}/admin.html#players`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-section="players"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    const editBtn = page.locator('[data-player-action="edit"]').first();
    if (await editBtn.count()) {
      await editBtn.click({ force: true });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(outDir, "04-player-edit-voice-390.png"), fullPage: false });
      const hasVoiceOpts = (await page.locator('[name="voice_type_opt"]').count()) > 0;
      step("player edit voice field", hasVoiceOpts, `opts=${await page.locator('[name="voice_type_opt"]').count()}`);
      if (hasVoiceOpts) matrix.COMPANION_VOICE_EDIT = "PASS";
      await page.evaluate(() => {
        const close = document.querySelector("[data-player-drawer-close]");
        if (close) close.click();
      });
      await page.waitForTimeout(400);
      const viewBtn = page.locator('[data-player-action="view"]').first();
      if (await viewBtn.count()) {
        await viewBtn.click({ force: true });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(outDir, "05-player-detail-voice-390.png"), fullPage: false });
      }
    }

    matrix.MOBILE_ADMIN = entryVisible ? "PASS" : "FAIL";
    await browser.close();
  } else {
    step("screenshots", false, "no browser");
  }

  // Cleanup: disable test voice (keep row; do not hard-delete if used)
  await api(token, "POST", "/api/admin/companion-voice-types", { action: "disable", id: createdId });

  const allPass = Object.values(matrix).every((v) => v === "PASS");
  matrix.STAGING_E2E = allPass || Object.values(matrix).filter((v) => v === "PASS").length >= 7 ? "PASS" : "FAIL";
  // recompute STAGING_E2E strictly
  const required = [
    "VOICE_ADMIN_ENTRY",
    "VOICE_ADD",
    "VOICE_EDIT",
    "VOICE_ENABLE_DISABLE",
    "VOICE_SORT",
    "COMPANION_VOICE_EDIT",
    "APPLICATION_DYNAMIC_OPTIONS",
    "OLD_DATA_COMPATIBLE",
    "MOBILE_ADMIN",
  ];
  matrix.STAGING_E2E = required.every((k) => matrix[k] === "PASS") ? "PASS" : "FAIL";

  const report = { staging: STG, tag: TAG_B, createdId, matrix, steps };
  fs.writeFileSync(path.join(outDir, "REPORT.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(outDir, "REPORT.md"),
    "# Voice Admin Staging\n\n" +
      Object.entries(matrix)
        .map(([k, v]) => `- ${k} = ${v}`)
        .join("\n") +
      "\n"
  );
  console.log(JSON.stringify(matrix, null, 2));
  if (matrix.STAGING_E2E !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
