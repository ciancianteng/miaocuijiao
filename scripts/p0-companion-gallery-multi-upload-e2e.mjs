/**
 * P0: Companion gallery multi-select upload (mobile-capable input[multiple]).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-gallery-multi-upload-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-gallery-multi-upload-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-gallery-multi-upload-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LOCAL_JS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
const LOCAL_CSS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.css"), "utf8");

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(pathname, token, body, method = null, headers = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tinyPng(seed = 0) {
  const buf = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    "base64"
  );
  if (seed) buf[buf.length - 6] = (buf[buf.length - 6] + seed) % 256;
  return buf;
}
function pngDataUrl(seed = 0) {
  return `data:image/png;base64,${tinyPng(seed).toString("base64")}`;
}
async function shot(page, name) {
  const p = path.join(ART, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  try {
    fs.copyFileSync(p, path.join(ART_REPO, `${name}.png`));
  } catch {
    /* ignore */
  }
}
function galleryOf(boot) {
  const media = boot?.json?.data?.media || boot?.json?.media || [];
  return (Array.isArray(media) ? media : []).filter((m) => String(m.mediaType || m.media_type || "") === "gallery");
}

(async () => {
  console.log("BASE", BASE);
  step("source_has_multiple_attr", /data-pw-gallery-multi/.test(LOCAL_JS) && /multiple data-pw-gallery-multi/.test(LOCAL_JS), "label+multiple input");
  step("source_batch_uploader", /function uploadGalleryFiles/.test(LOCAL_JS) && /uploadOneGalleryFile/.test(LOCAL_JS), "batch helpers");
  step("source_no_sheet_for_album", /Native <label>\+<input multiple>/.test(LOCAL_JS), "album via native label");

  const login = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const token =
    tok(login.json) || login.json?.session?.accessToken || login.json?.data?.session?.accessToken || "";
  const refresh =
    login.json?.session?.refreshToken || login.json?.data?.session?.refreshToken || "";
  const user = login.json?.user || login.json?.session?.user || login.json?.data?.user || {};
  step("companion_login", !!token, COMP);
  if (!token) {
    fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(results, null, 2));
    process.exit(1);
  }

  // Free gallery slots for the test (keep at most 1).
  let boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  let gals = galleryOf(boot);
  const companionId = boot.json?.data?.player?.id || user.id || "";
  step("bootstrap", !!(boot.ok && companionId), `id=${companionId} gallery=${gals.length}`);
  for (const g of gals) {
    if (!g.id) continue;
    await api("/api/companion", token, { action: "delete_media", media_id: g.id, id: g.id }).catch(() => {});
  }
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  const baseCount = gals.length;
  step("gallery_prepared", baseCount === 0, `base=${baseCount}`);

  // API: upload 2 then verify persistence (storage truth).
  const upA = await api("/api/companion", token, {
    action: "upload_media",
    media_type: "gallery",
    data_url: pngDataUrl(11),
    filename: "multi-a.png",
  });
  const upB = await api("/api/companion", token, {
    action: "upload_media",
    media_type: "gallery",
    data_url: pngDataUrl(12),
    filename: "multi-b.png",
  });
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  step("api_upload_two", !!(upA.ok && upB.ok && gals.length >= 2), `n=${gals.length} a=${upA.ok} b=${upB.ok}`);

  // Clear again to leave room for UI multi-select of 5.
  for (const g of galleryOf(boot)) {
    if (g.id) await api("/api/companion", token, { action: "delete_media", media_id: g.id, id: g.id }).catch(() => {});
  }
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  step("gallery_cleared", galleryOf(boot).length === 0, `n=${galleryOf(boot).length}`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // iPhone viewport for mobile multi-select attribute checks; session mirrors working media e2e.
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  await context.addInitScript(
    (payload) => {
      try {
        const session = {
          token: payload.token,
          accessToken: payload.token,
          refreshToken: payload.refresh || "",
          user: payload.user || { role: "companion" },
          remember: true,
        };
        const raw = JSON.stringify(session);
        localStorage.setItem("mcjCompanionSession", raw);
        sessionStorage.setItem("mcjCompanionSession", raw);
        localStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
        sessionStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
        localStorage.setItem("companionUser", JSON.stringify(Object.assign({ role: "companion" }, payload.user || {})));
        localStorage.setItem("mcjAuthAccessToken", payload.token);
        sessionStorage.setItem("mcjAuthAccessToken", payload.token);
        localStorage.setItem("mcjRole", "companion");
        sessionStorage.setItem("mcjRole", "companion");
      } catch (_) {}
    },
    { token, refresh, user }
  );
  // Prefer deployed bundle (Vite assets). Set INJECT_LOCAL=1 to force raw source.
  const injectLocal = process.env.INJECT_LOCAL === "1";
  const page = await context.newPage();
  if (injectLocal) {
    const fulfillJs = async (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: LOCAL_JS + "\nexport default {};\n",
        headers: { "cache-control": "no-store" },
      });
    const fulfillCss = async (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/css; charset=utf-8",
        body: LOCAL_CSS,
        headers: { "cache-control": "no-store" },
      });
    await page.route(/companion-workbench\.js(?:\?.*)?$/, fulfillJs);
    await page.route(/companion-workbench\.css(?:\?.*)?$/, fulfillCss);
    await page.route(/\/assets\/companion-workbench-[^/?#]+\.js(?:\?.*)?$/, fulfillJs);
    await page.route(/\/assets\/companion-workbench-[^/?#]+\.css(?:\?.*)?$/, fulfillCss);
  }

  async function dismissForced() {
    await page.evaluate(() => {
      document.querySelectorAll("[data-pw-forced-mask], .pw-forced-mask").forEach((el) => el.remove());
      const ack = document.querySelector("[data-forced-ack], [data-ack-forced], button[data-ack]");
      if (ack) try { ack.click(); } catch (_) {}
    });
  }

  await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  await dismissForced();
  // Isolation companions may land on review-status — jump to profile.
  if (!/\/companion\/profile/.test(page.url())) {
    await page.evaluate(() => {
      try {
        history.pushState(null, "", "/companion/profile/");
      } catch (_) {}
    });
    await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    await dismissForced();
  }
  await page.waitForSelector("[data-pw-gallery-multi], .pw-gallery-block, [data-field='gallery']", { timeout: 45000 });
  await dismissForced();
  await page.locator(".pw-gallery-block, [data-field='gallery']").first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "01-profile-gallery");

  const inputInfo = await page.evaluate(() => {
    const input = document.querySelector("[data-pw-gallery-multi]");
    if (!input) return null;
    return {
      multiple: !!input.multiple,
      hasAttr: input.hasAttribute("multiple"),
      accept: input.accept || "",
      capture: input.getAttribute("capture"),
      disabled: !!input.disabled,
      tag: input.tagName,
      inLabel: !!input.closest("label"),
    };
  });
  step(
    "mobile_input_multiple",
    !!(inputInfo && inputInfo.multiple && inputInfo.hasAttr && !inputInfo.capture && inputInfo.inLabel),
    JSON.stringify(inputInfo)
  );

  // Select 2 files at once via the real multiple input.
  await page.setInputFiles("[data-pw-gallery-multi]", [
    { name: "g1.png", mimeType: "image/png", buffer: tinyPng(21) },
    { name: "g2.png", mimeType: "image/png", buffer: tinyPng(22) },
  ]);
  await page.waitForTimeout(800);
  const thumbs2 = await page.locator(".pw-gallery-grid .pw-media-thumb").count();
  step("ui_select_2_thumbs_appear", thumbs2 >= 2, `thumbs=${thumbs2}`);
  await page
    .waitForFunction(() => document.querySelectorAll(".pw-media-thumb.is-uploading").length === 0, null, { timeout: 120000 })
    .catch(() => null);
  await page.waitForTimeout(1500);
  await shot(page, "02-after-two");
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  step("ui_upload_2_persisted", gals.length >= 2, `n=${gals.length}`);

  // Select 5 more while room=4 → should clamp to remaining.
  const room = Math.max(0, 6 - gals.length);
  await dismissForced();
  await page.setInputFiles("[data-pw-gallery-multi]", [
    { name: "g3.png", mimeType: "image/png", buffer: tinyPng(31) },
    { name: "g4.png", mimeType: "image/png", buffer: tinyPng(32) },
    { name: "g5.png", mimeType: "image/png", buffer: tinyPng(33) },
    { name: "g6.png", mimeType: "image/png", buffer: tinyPng(34) },
    { name: "g7.png", mimeType: "image/png", buffer: tinyPng(35) },
  ]);
  await page.waitForTimeout(1000);
  await page
    .waitForFunction(() => document.querySelectorAll(".pw-media-thumb.is-uploading").length === 0, null, { timeout: 180000 })
    .catch(() => null);
  await page.waitForTimeout(2000);
  await shot(page, "03-after-five-clamped");
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  step("ui_upload_clamp_to_6", gals.length === 6, `n=${gals.length} roomWas=${room}`);

  // Over limit: picker hidden or disabled when full.
  const fullUi = await page.evaluate(() => {
    const input = document.querySelector("[data-pw-gallery-multi]");
    return { hasInput: !!input, disabled: !!(input && input.disabled), actions: !!document.querySelector(".pw-gallery-actions") };
  });
  step("ui_full_hides_or_disables_picker", !fullUi.hasInput || fullUi.disabled || !fullUi.actions, JSON.stringify(fullUi));

  // Delete one saved thumb.
  const beforeDel = gals.length;
  const delId = gals[1]?.id;
  if (delId) {
    await page.evaluate((id) => {
      const btn = document.querySelector(`[data-delete-media="${id}"]`);
      if (btn) btn.click();
    }, delId);
    await page.waitForTimeout(2500);
  }
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  step("delete_one_others_remain", gals.length === beforeDel - 1 && !gals.some((x) => x.id === delId), `n=${gals.length}`);

  // Refresh page — remaining persist.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissForced();
  await page.waitForSelector(".pw-gallery-block, [data-field='gallery']", { timeout: 45000 });
  await page.waitForTimeout(1500);
  const thumbsAfterRefresh = await page.locator(".pw-gallery-grid .pw-media-thumb").count();
  boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  gals = galleryOf(boot);
  step("refresh_persists", thumbsAfterRefresh === gals.length && gals.length >= 4, `thumbs=${thumbsAfterRefresh} api=${gals.length}`);
  await shot(page, "04-after-refresh");

  // Boss public detail
  const pub = await api(`/api/public/companions?id=${encodeURIComponent(companionId)}`, null, null, "GET");
  const pubCompanion = pub.json?.companion || pub.json?.data || pub.json || {};
  const pubGal = pubCompanion.gallery || pubCompanion.media?.gallery || [];
  const pubCount = Array.isArray(pubGal)
    ? pubGal.length
    : (pubCompanion.media || []).filter((m) => (m.mediaType || m.media_type) === "gallery").length;
  step("boss_detail_sees_gallery", pub.ok && pubCount >= 4, `n=${pubCount}`);

  // Admin player detail
  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  const adminDetail = await api(`/api/admin/players?id=${encodeURIComponent(companionId)}`, adminT, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const adminGal =
    adminDetail.json?.player?.media?.gallery ||
    adminDetail.json?.data?.media?.gallery ||
    adminDetail.json?.media?.gallery ||
    [];
  const adminCount = Array.isArray(adminGal) ? adminGal.length : 0;
  step("admin_sees_gallery", !!(adminT && adminDetail.ok && adminCount >= 4), `n=${adminCount}`);

  // Companion self still sees
  step("companion_self_synced", gals.length >= 4, `n=${gals.length}`);
  step(
    "four_end_same_count",
    gals.length >= 4 && pubCount >= 4 && adminCount >= 4,
    `comp=${gals.length} boss=${pubCount} admin=${adminCount}`
  );

  await browser.close();
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ results, companionId }, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify({ results, companionId }, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log("SUMMARY", results.length - failed.length, "/", results.length);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
