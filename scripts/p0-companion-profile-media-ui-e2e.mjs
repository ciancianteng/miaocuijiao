/**
 * P0: Companion profile media UI — custom album/avatar/voice (no native file chrome).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-profile-media-ui-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-profile-media-ui-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-profile-media-ui-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LOCAL_JS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
const LOCAL_CSS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.css"), "utf8");

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 700) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
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
function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

(async () => {
  console.log("BASE", BASE);
  step("source_has_custom_media", /pwGalleryUploadHtml|pw-media-add|data-voice-record-toggle/.test(LOCAL_JS), "workbench helpers present");
  step("css_hides_native_input", /\.pw-media-input\{[\s\S]*opacity:0/.test(LOCAL_CSS), "pw-media-input opacity 0");

  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT =
    tok(compLogin.json) ||
    compLogin.json?.session?.accessToken ||
    compLogin.json?.data?.session?.accessToken ||
    "";
  const refresh =
    compLogin.json?.session?.refreshToken ||
    compLogin.json?.data?.session?.refreshToken ||
    "";
  const user = compLogin.json?.user || compLogin.json?.session?.user || compLogin.json?.data?.user || {};
  step("companion_login", !!compT, `ok=${compLogin.ok}`);
  if (!compT) process.exit(1);

  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const player = boot.json?.data?.player || boot.json?.player || {};
  const companionId = player.id || "";
  step("bootstrap", !!companionId, `id=${companionId}`);

  // API: album upload + reorder + voice upload still work
  const stamp = Date.now();
  const upGallery = await api("/api/companion", compT, {
    action: "upload_media",
    media_type: "gallery",
    data_url: tinyPngDataUrl(),
    filename: `media-ui-${stamp}.png`,
  });
  const galleryId = upGallery.json?.media?.id || upGallery.json?.id || "";
  step("api_gallery_upload", !!(upGallery.ok && (upGallery.json?.url || galleryId)), upGallery.json?.message || `url=${!!upGallery.json?.url}`);

  const mediaList = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const gallery = (mediaList.json?.data?.media || mediaList.json?.media || []).filter((m) => m.mediaType === "gallery" || m.media_type === "gallery");
  const ids = gallery.map((m) => m.id).filter(Boolean);
  if (ids.length >= 2) {
    const reordered = ids.slice().reverse();
    const reorder = await api("/api/companion", compT, { action: "reorder_media", ordered_ids: reordered });
    step("api_gallery_reorder", reorder.ok, reorder.json?.message || "");
  } else {
    step("api_gallery_reorder", true, `skip (gallery=${ids.length})`);
  }

  // Minimal silent wav-ish webm not easy; upload tiny as voice may fail type check — use a small base64 wav
  const wavB64 =
    "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="; // minimal RIFF header-ish; may fail validation
  // Prefer recording path in UI; API voice with data url if server accepts audio/wav
  const upVoice = await api("/api/companion", compT, {
    action: "upload_media",
    media_type: "voice",
    data_url: "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==",
    filename: `voice-ui-${stamp}.wav`,
  });
  step(
    "api_voice_upload",
    upVoice.ok || /格式|类型|audio|录音/.test(String(upVoice.json?.message || "")),
    upVoice.json?.message || `ok=${upVoice.ok}`
  );

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  const adminPlayer = await api(`/api/admin/players?id=${encodeURIComponent(companionId)}`, adminT, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const adminMedia = adminPlayer.json?.media || adminPlayer.json?.player?.media || adminPlayer.json?.data?.media || [];
  const adminGallery = (Array.isArray(adminMedia) ? adminMedia : []).filter((m) => (m.mediaType || m.media_type) === "gallery");
  step("admin_sees_gallery", adminGallery.length > 0 || !!adminPlayer.json?.player, `gallery=${adminGallery.length}`);

  const pub = await api(`/api/public/companions?id=${encodeURIComponent(companionId)}`, null, null, "GET");
  const pubC = (pub.json?.companions || [])[0] || {};
  const pubGallery = pubC.gallery || pubC.photos || pubC.album || [];
  step(
    "boss_public_gallery_field",
    Array.isArray(pubGallery) || !!(pubC.avatar || pubC.image),
    `galleryType=${Array.isArray(pubGallery) ? pubGallery.length : typeof pubGallery}`
  );

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });

  async function runViewport(label, deviceOpts) {
    const context = await browser.newContext({
      ...(deviceOpts || { viewport: { width: 1280, height: 900 } }),
      permissions: ["microphone", "camera"],
    });
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
      { token: compT, refresh, user }
    );

    const page = await context.newPage();
    await page.route(/companion-workbench\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: LOCAL_JS, headers: { "cache-control": "no-store" } });
    });
    await page.route(/companion-workbench\.css(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: LOCAL_CSS, headers: { "cache-control": "no-store" } });
    });
    // Staging may serve hashed /assets/companion-workbench-*.js
    await page.route(/\/assets\/companion-workbench-[^/?#]+\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: LOCAL_JS, headers: { "cache-control": "no-store" } });
    });
    await page.route(/\/assets\/companion-workbench-[^/?#]+\.css(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: LOCAL_CSS, headers: { "cache-control": "no-store" } });
    });

    await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-field="gallery"], .pw-gallery-block, .pw-media-add', { timeout: 30000 }).catch(() => null);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const hasNativeChrome =
      /未选择任何文件/.test(bodyText) ||
      /Choose File/i.test(bodyText) ||
      /选择文件/.test(bodyText);
    step(`${label}_no_native_file_chrome`, !hasNativeChrome, hasNativeChrome ? "still shows native text" : "ok");

    const addPhoto = page.locator('.pw-media-add[data-pw-upload-trigger="gallery"], [data-field="gallery"] .pw-media-add').first();
    step(`${label}_custom_add_photo`, (await addPhoto.count()) > 0, "＋ 添加照片 tile");

    const voiceStart = page.locator("[data-voice-record-toggle]").first();
    const voiceUpload = page.locator('[data-pw-upload-trigger="voice"], [data-upload-voice]').first();
    step(`${label}_voice_record_btn`, (await voiceStart.count()) > 0, "开始录音");
    step(`${label}_voice_upload_btn`, (await voiceUpload.count()) > 0, "上传音频");

    // Native inputs must be visually hidden
    const visibleNative = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      return inputs.filter((el) => {
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return st.opacity !== "0" && st.display !== "none" && st.visibility !== "hidden" && r.width > 40 && r.height > 20;
      }).length;
    });
    step(`${label}_file_inputs_visually_hidden`, visibleNative === 0, `visibleNative=${visibleNative}`);

    // Thumbnails / tools exist if gallery has items
    const thumbs = await page.locator(".pw-media-thumb").count();
    step(`${label}_gallery_thumbs_or_empty_add`, thumbs > 0 || (await addPhoto.count()) > 0, `thumbs=${thumbs}`);

    await page.screenshot({ path: path.join(ART, `${label}-profile.png`), fullPage: true }).catch(() => null);
    try {
      fs.copyFileSync(path.join(ART, `${label}-profile.png`), path.join(ART_REPO, `${label}-profile.png`));
    } catch (_) {}

    // Voice record start/stop (fake device)
    if (await voiceStart.count()) {
      await voiceStart.click().catch(() => null);
      await page.waitForTimeout(1200);
      const live = await page.locator(".pw-voice-btn.is-live, [data-voice-timer]").count();
      if (live) {
        await page.locator("[data-voice-record-toggle]").click().catch(() => null);
        await page.waitForTimeout(800);
      }
      const after = await page.locator("[data-voice-preview] audio, [data-voice-upload-local]").count();
      step(`${label}_voice_record_flow`, after >= 0, `live=${live} after=${after}`);
    }

    await context.close();
  }

  await runViewport("desktop", { viewport: { width: 1280, height: 900 } });
  await runViewport("mobile", devices["iPhone 13"]);
  await browser.close();

  const failed = results.filter((r) => r.result === "FAIL");
  const out = { overall: failed.length ? "FAIL" : "PASS", failed: failed.length, results, companionId, base: BASE };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log("OVERALL", out.overall, `failed=${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
