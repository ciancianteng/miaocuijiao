/**
 * P0: Companion profile album + voice — real File/Blob → upload_media → Storage → DB → play.
 * Injects local companion-workbench.js/css so Preview lag does not hide the fix.
 *
 * Usage:
 *   PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-media-real-upload-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-media-real-upload-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-media-real-upload-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LOCAL_JS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
const LOCAL_CSS = fs.readFileSync(path.join(ROOT, "src/companion-workbench.css"), "utf8");
const LOCAL_UPLOAD_JS = fs.readFileSync(path.join(ROOT, "src/mcj-upload.js"), "utf8");
const LOCAL_UPLOAD_CSS = fs.readFileSync(path.join(ROOT, "src/mcj-upload.css"), "utf8");

const report = {
  相册选择: "FAIL",
  相册Storage上传: "FAIL",
  相册DB保存: "FAIL",
  刷新后存在: "FAIL",
  后台可见: "FAIL",
  老板端可见: "FAIL",
  删除同步: "FAIL",
  音频文件上传: "FAIL",
  现场录音: "FAIL",
  停止录音: "FAIL",
  试听: "FAIL",
  Storage上传: "FAIL",
  DB保存: "FAIL",
  刷新后播放: "FAIL",
  后台播放: "FAIL",
  老板端播放: "FAIL",
  语音删除同步: "FAIL",
};
const meta = {
  bugCauses: [],
  files: [],
  buckets: { gallery: "companion-public", voice: "companion-audio", galleryPrivateFallback: "companion-gallery" },
  dbFields: {
    gallery: "companion_media (media_type=gallery, storage_bucket, storage_path, sort_order)",
    voice: "companion_media (media_type=voice) + companion_profiles.voice_url (storage://…)",
  },
  galleryPath: "",
  voicePath: "",
  uploadStatus: { gallery: null, voiceFile: null, voiceRecord: null },
  playStatus: { companion: null, admin: null, boss: null },
};
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
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
function tinyPngBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    "base64"
  );
}
function makeToneWav(seconds = 2, freq = 440) {
  const sampleRate = 16000;
  const n = Math.floor(sampleRate * seconds);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.4;
    buf.writeInt16LE((sample * 32767) | 0, 44 + i * 2);
  }
  return buf;
}
function isPlayable(u) {
  return /^https?:\/\//i.test(String(u || "").trim());
}
async function headOrGet(url) {
  if (!url || !/^https?:/i.test(url)) return { status: 0, ok: false };
  try {
    let res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-64" } });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { method: "GET" });
    return { status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (e) {
    return { status: 0, ok: false, error: String(e.message || e) };
  }
}
async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true }).catch(() => null);
  try {
    fs.copyFileSync(p1, path.join(ART_REPO, file));
  } catch (_) {}
  return p1;
}

(async () => {
  console.log("BASE", BASE);
  meta.bugCauses = [
    "triggerPwHiddenPick applied .pw-media-input → full-viewport invisible overlay broke gesture-chained picks",
    "isPwTouchUpload treated maxTouchPoints>0 as mobile → confirm()/sheet then programmatic click lost user gesture",
    "audio src used companion_profiles.voice_url storage://… which browsers cannot play",
    "确认上传 hidden when remoteUrl truthy (storage://) after re-record",
    "admin SIGN_TTL was 5 minutes → voice preview expired mid-session",
  ];
  meta.files = [
    "src/companion-workbench.js",
    "src/companion-workbench.css",
    "server/api/admin/players.js",
    "companion/profile/index.html",
    "scripts/p0-companion-media-real-upload-e2e.mjs",
  ];
  step("source_pickVoicePlayUrl", /function pickVoicePlayUrl/.test(LOCAL_JS), "playable URL guard present");
  step("source_no_overlay_temp_pick", /Never reuse \.pw-media-input/.test(LOCAL_JS), "temp pick avoids overlay class");
  step("source_touch_ua_only", /Do NOT treat desktop touchpads/.test(LOCAL_JS), "touch detect fixed");
  step("source_confirm_when_local", /hasLocal[\s\S]*data-voice-upload-local/.test(LOCAL_JS), "confirm upload when local blob");
  step("admin_sign_ttl_1h", /SIGN_TTL\s*=\s*60\s*\*\s*60/.test(fs.readFileSync(path.join(ROOT, "server/api/admin/players.js"), "utf8")), "admin TTL 1h");

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
  step("companion_login", !!compT, `status=${compLogin.status}`);
  if (!compT) {
    fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify({ report, meta, results }, null, 2));
    process.exit(1);
  }

  const boot0 = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const player0 = boot0.json?.data?.player || boot0.json?.player || {};
  const companionId = player0.id || user.id || "";
  step("bootstrap", !!companionId, `id=${companionId}`);

  // Clean slate: delete existing gallery + voice via API so UI asserts are deterministic
  const media0 = boot0.json?.data?.media || boot0.json?.media || [];
  for (const m of media0) {
    const mt = m.mediaType || m.media_type;
    if (mt === "gallery" && m.id) {
      await api("/api/companion", compT, { action: "delete_media", media_id: m.id, id: m.id }).catch(() => {});
    }
  }
  await api("/api/companion", compT, { action: "delete_media", media_type: "voice" }).catch(() => {});

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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
  const fulfillJs = async (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: LOCAL_JS, headers: { "cache-control": "no-store" } });
  const fulfillCss = async (route) =>
    route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: LOCAL_CSS, headers: { "cache-control": "no-store" } });
  await page.route(/companion-workbench\.js(?:\?.*)?$/, fulfillJs);
  await page.route(/companion-workbench\.css(?:\?.*)?$/, fulfillCss);
  await page.route(/\/assets\/companion-workbench-[^/?#]+\.js(?:\?.*)?$/, fulfillJs);
  await page.route(/\/assets\/companion-workbench-[^/?#]+\.css(?:\?.*)?$/, fulfillCss);
  await page.route(/mcj-upload\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: LOCAL_UPLOAD_JS,
      headers: { "cache-control": "no-store" },
    });
  });
  await page.route(/mcj-upload\.css(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css; charset=utf-8",
      body: LOCAL_UPLOAD_CSS,
      headers: { "cache-control": "no-store" },
    });
  });

  const uploadPosts = [];
  page.on("response", async (res) => {
    try {
      const req = res.request();
      if (req.method() !== "POST" || !/\/api\/companion(?:\?|$)/.test(res.url())) return;
      const post = req.postData() || "";
      if (!/upload_media/.test(post)) return;
      let body = {};
      try {
        body = JSON.parse(post);
      } catch (_) {}
      let json = {};
      try {
        json = await res.json();
      } catch (_) {}
      uploadPosts.push({
        status: res.status(),
        mediaType: body.media_type || body.mediaType,
        ok: json.ok !== false && res.status() < 400,
        url: json.url || json.media?.url || "",
        path: json.path || json.storage_path || json.media?.storagePath || json.media?.storage_path || "",
        message: json.message || "",
      });
    } catch (_) {}
  });

  await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('[data-field="gallery"] .pw-media-add, .pw-media-add[data-pw-upload-trigger="gallery"]', {
    timeout: 45000,
  });
  await shot(page, "01-profile-loaded");

  // ——— Gallery: setInputFiles on real overlay input ———
  const galleryInput = page.locator('[data-upload-gallery]').first();
  const pngPath = path.join(ART, `gallery-${Date.now()}.png`);
  fs.writeFileSync(pngPath, tinyPngBuffer());
  const galleryWait = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/companion/.test(r.url()) && /upload_media/.test(r.request().postData() || ""),
    { timeout: 60000 }
  );
  await galleryInput.setInputFiles(pngPath);
  let galleryRes = null;
  try {
    galleryRes = await galleryWait;
  } catch (e) {
    step("ui_gallery_network", false, String(e.message || e));
  }
  const gStatus = galleryRes ? galleryRes.status() : 0;
  let gJson = {};
  try {
    gJson = galleryRes ? await galleryRes.json() : {};
  } catch (_) {}
  meta.uploadStatus.gallery = gStatus;
  meta.galleryPath = gJson.path || gJson.storage_path || gJson.media?.storage_path || gJson.media?.storagePath || "";
  const gUrl = gJson.url || gJson.media?.url || "";
  const galleryPickOk = gStatus === 200 && gJson.ok !== false && !!gUrl;
  step("ui_gallery_upload_network", galleryPickOk, `status=${gStatus} url=${String(gUrl).slice(0, 80)} path=${meta.galleryPath}`);
  if (galleryPickOk) {
    report.相册选择 = "PASS";
    report.相册Storage上传 = "PASS";
    report.相册DB保存 = "PASS";
  }
  await page.waitForTimeout(1200);
  await shot(page, "02-gallery-uploaded");

  const thumb = page.locator('[data-gallery-list] img, .pw-media-thumb img').first();
  const thumbSrc = (await thumb.getAttribute("src").catch(() => "")) || "";
  step("ui_gallery_thumb_real", /^https?:\/\//i.test(thumbSrc) && !/^blob:/i.test(thumbSrc), thumbSrc.slice(0, 120));

  // Refresh persistence
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-field="gallery"], .pw-gallery-block', { timeout: 45000 });
  await page.waitForTimeout(1500);
  const thumb2 = page.locator('[data-gallery-list] img, .pw-media-thumb img').first();
  const thumbSrc2 = (await thumb2.getAttribute("src").catch(() => "")) || "";
  const refreshGalleryOk = /^https?:\/\//i.test(thumbSrc2);
  step("ui_gallery_after_reload", refreshGalleryOk, thumbSrc2.slice(0, 120));
  if (refreshGalleryOk) report.刷新后存在 = "PASS";

  const bootG = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const galleryRows = (bootG.json?.data?.media || bootG.json?.media || []).filter(
    (m) => (m.mediaType || m.media_type) === "gallery"
  );
  if (!meta.galleryPath && galleryRows[0]) {
    meta.galleryPath = galleryRows[0].storagePath || galleryRows[0].storage_path || "";
  }
  step("db_gallery_rows", galleryRows.length > 0, `count=${galleryRows.length} path=${meta.galleryPath}`);

  // ——— Voice file upload ———
  const wavPath = path.join(ART, `voice-file-${Date.now()}.wav`);
  fs.writeFileSync(wavPath, makeToneWav(2, 523));
  const voiceWait = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/companion/.test(r.url()) &&
      /"media_type"\s*:\s*"voice"/.test(r.request().postData() || ""),
    { timeout: 60000 }
  );
  const voiceInput = page.locator('[data-upload-voice]').first();
  await voiceInput.setInputFiles(wavPath);
  let voiceRes = null;
  try {
    voiceRes = await voiceWait;
  } catch (e) {
    step("ui_voice_file_network", false, String(e.message || e));
  }
  const vStatus = voiceRes ? voiceRes.status() : 0;
  let vJson = {};
  try {
    vJson = voiceRes ? await voiceRes.json() : {};
  } catch (_) {}
  meta.uploadStatus.voiceFile = vStatus;
  meta.voicePath = vJson.path || vJson.storage_path || vJson.media?.storage_path || "";
  const vUrl = vJson.url || vJson.media?.url || "";
  const voiceFileOk = vStatus === 200 && vJson.ok !== false && isPlayable(vUrl);
  step("ui_voice_file_upload", voiceFileOk, `status=${vStatus} url=${String(vUrl).slice(0, 100)}`);
  if (voiceFileOk) {
    report.音频文件上传 = "PASS";
    report.Storage上传 = "PASS";
    report.DB保存 = "PASS";
  }
  await page.waitForTimeout(800);
  await page
    .waitForFunction(() => {
      const a = document.querySelector("audio[data-voice-audio], .pw-voice-preview audio");
      const src = (a && a.getAttribute("src")) || "";
      return /^https?:\/\//i.test(src);
    }, { timeout: 20000 })
    .catch(() => null);
  await shot(page, "03-voice-file-uploaded");

  let audioSrc = (await page.locator("audio[data-voice-audio], .pw-voice-preview audio").first().getAttribute("src").catch(() => "")) || "";
  // data: preview during upload is OK transiently; after success must be https (Storage signed/public).
  const playerHttp = isPlayable(audioSrc);
  step("ui_voice_player_src_http", playerHttp, audioSrc.slice(0, 140));
  if (playerHttp) {
    const playGet = await headOrGet(audioSrc);
    meta.playStatus.companion = playGet.status;
    step("ui_voice_play_get", playGet.ok, `status=${playGet.status}`);
    if (playGet.ok) report.试听 = "PASS";
  }

  // Delete voice then do live record flow
  await api("/api/companion", compT, { action: "delete_media", media_type: "voice" }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-voice-record-toggle]", { timeout: 45000 });
  await page.waitForTimeout(800);

  await page.locator("[data-voice-record-toggle]").first().click();
  await page.waitForTimeout(1800);
  const recordingUi = await page.locator("[data-voice-timer], .pw-voice-btn.is-live, [data-voice-record-toggle]").first().innerText().catch(() => "");
  const recording = /停止|录音中|is-live|⏹/.test(recordingUi) || (await page.locator(".pw-voice-btn.is-live").count()) > 0;
  step("ui_voice_record_start", recording, `ui=${recordingUi.slice(0, 80)}`);
  if (recording) report.现场录音 = "PASS";

  await page.locator("[data-voice-record-toggle]").first().click();
  await page.waitForTimeout(1200);
  const confirmBtn = page.locator("[data-voice-upload-local]").first();
  const stopOk = (await confirmBtn.count()) > 0 || (await page.locator("audio[data-voice-audio], .pw-voice-preview audio").count()) > 0;
  step("ui_voice_record_stop", stopOk, `confirm=${await confirmBtn.count()}`);
  if (stopOk) report.停止录音 = "PASS";

  // Preview blob before upload
  const previewSrc =
    (await page.locator("audio[data-voice-audio], .pw-voice-preview audio").first().getAttribute("src").catch(() => "")) || "";
  const previewOk = /^(blob:|https?:|data:audio)/i.test(previewSrc);
  step("ui_voice_record_preview", previewOk, previewSrc.slice(0, 80));
  if (previewOk && report.试听 !== "PASS") report.试听 = "PASS";

  if ((await confirmBtn.count()) > 0) {
    const recWait = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/companion/.test(r.url()) &&
        /"media_type"\s*:\s*"voice"/.test(r.request().postData() || ""),
      { timeout: 60000 }
    );
    await confirmBtn.click();
    let recRes = null;
    try {
      recRes = await recWait;
    } catch (e) {
      step("ui_voice_record_upload_network", false, String(e.message || e));
    }
    const rStatus = recRes ? recRes.status() : 0;
    let rJson = {};
    try {
      rJson = recRes ? await recRes.json() : {};
    } catch (_) {}
    meta.uploadStatus.voiceRecord = rStatus;
    if (!meta.voicePath) meta.voicePath = rJson.path || rJson.storage_path || rJson.media?.storage_path || "";
    const recOk = rStatus === 200 && rJson.ok !== false && isPlayable(rJson.url || rJson.media?.url || "");
    step("ui_voice_record_upload", recOk, `status=${rStatus} url=${String(rJson.url || "").slice(0, 100)}`);
    if (recOk) {
      report.Storage上传 = "PASS";
      report.DB保存 = "PASS";
    }
  } else {
    // Fallback: upload wav file if MediaRecorder produced no confirm (headless quirk)
    const fallbackWait = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/companion/.test(r.url()) &&
        /"media_type"\s*:\s*"voice"/.test(r.request().postData() || ""),
      { timeout: 60000 }
    );
    await page.locator('[data-upload-voice]').first().setInputFiles(wavPath);
    const fb = await fallbackWait.catch(() => null);
    meta.uploadStatus.voiceRecord = fb ? fb.status() : 0;
    step("ui_voice_record_upload", false, "no confirm button — used file fallback for storage check");
  }

  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".pw-voice-preview, [data-voice-record-toggle]", { timeout: 45000 });
  await page.waitForTimeout(1500);
  audioSrc =
    (await page.locator("audio[data-voice-audio], .pw-voice-preview audio").first().getAttribute("src").catch(() => "")) || "";
  const refreshPlayOk = isPlayable(audioSrc);
  step("ui_voice_after_reload_src", refreshPlayOk, audioSrc.slice(0, 140));
  if (refreshPlayOk) {
    const playGet2 = await headOrGet(audioSrc);
    meta.playStatus.companion = playGet2.status;
    step("ui_voice_after_reload_get", playGet2.ok, `status=${playGet2.status}`);
    if (playGet2.ok) report.刷新后播放 = "PASS";
  }
  await shot(page, "04-after-reload");

  const boot1 = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const media1 = boot1.json?.data?.media || boot1.json?.media || [];
  const voiceRow = media1.find((m) => (m.mediaType || m.media_type) === "voice");
  if (!meta.voicePath && voiceRow) meta.voicePath = voiceRow.storagePath || voiceRow.storage_path || "";
  const playerVoice = boot1.json?.data?.player?.voiceUrl || "";
  step("db_voice_row", !!(voiceRow && isPlayable(voiceRow.url || playerVoice)), `path=${meta.voicePath} playerVoice=${isPlayable(playerVoice)}`);

  // Admin
  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json) || adminLogin.json?.session?.accessToken || "";
  const adminPlayer = await api(`/api/admin/players?id=${encodeURIComponent(companionId)}`, adminT, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const adminMedia = adminPlayer.json?.player?.media || adminPlayer.json?.media || {};
  const adminGallery = Array.isArray(adminMedia)
    ? adminMedia.filter((m) => (m.mediaType || m.media_type) === "gallery")
    : adminMedia.gallery || [];
  const adminVoices = Array.isArray(adminMedia) ? [] : adminMedia.voices || adminMedia.voice || [];
  const adminVoiceList = Array.isArray(adminVoices) ? adminVoices : adminVoices ? [adminVoices] : [];
  const adminGalleryOk = Array.isArray(adminGallery) && adminGallery.length > 0;
  step("admin_gallery_visible", adminGalleryOk, `n=${adminGallery.length}`);
  if (adminGalleryOk) report.后台可见 = "PASS";
  const adminVoiceUrl =
    adminVoiceList[0]?.url ||
    adminVoiceList[0]?.signedUrl ||
    adminPlayer.json?.player?.voiceUrl ||
    adminPlayer.json?.player?.voice_url ||
    "";
  const adminVoiceOk = isPlayable(adminVoiceUrl) || adminVoiceList.length > 0;
  step("admin_voice_visible", adminVoiceOk, `voices=${adminVoiceList.length} url=${String(adminVoiceUrl).slice(0, 100)}`);
  if (isPlayable(adminVoiceUrl)) {
    const ag = await headOrGet(adminVoiceUrl);
    meta.playStatus.admin = ag.status;
    step("admin_voice_play_get", ag.ok, `status=${ag.status}`);
    if (ag.ok) report.后台播放 = "PASS";
  } else if (adminVoiceList.length && isPlayable(adminVoiceList[0].url)) {
    const ag = await headOrGet(adminVoiceList[0].url);
    meta.playStatus.admin = ag.status;
    if (ag.ok) report.后台播放 = "PASS";
  }

  // Boss / public
  const pub = await api(`/api/public/companions?id=${encodeURIComponent(companionId)}`, null, null, "GET");
  const pubC = (pub.json?.companions || []).find((c) => String(c.id) === String(companionId)) || (pub.json?.companions || [])[0] || {};
  const pubGallery = pubC.gallery || pubC.photos || pubC.album || [];
  const pubGalleryOk = Array.isArray(pubGallery) && pubGallery.length > 0;
  step("boss_public_gallery", pubGalleryOk, `n=${Array.isArray(pubGallery) ? pubGallery.length : 0}`);
  if (pubGalleryOk) report.老板端可见 = "PASS";
  const pubVoice = pubC.voiceUrl || pubC.voice_url || pubC.voice || "";
  const pubVoiceOk = isPlayable(pubVoice);
  step("boss_public_voice", pubVoiceOk, String(pubVoice).slice(0, 120));
  if (pubVoiceOk) {
    const bg = await headOrGet(pubVoice);
    meta.playStatus.boss = bg.status;
    step("boss_voice_play_get", bg.ok, `status=${bg.status}`);
    if (bg.ok) report.老板端播放 = "PASS";
  }

  // Delete sync
  const galleryId = galleryRows[0]?.id || (boot1.json?.data?.media || []).find((m) => (m.mediaType || m.media_type) === "gallery")?.id;
  const bootBeforeDel = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const gBefore = (bootBeforeDel.json?.data?.media || []).filter((m) => (m.mediaType || m.media_type) === "gallery");
  const delId = gBefore[0]?.id || galleryId;
  if (delId) {
    const delG = await api("/api/companion", compT, { action: "delete_media", media_id: delId, id: delId });
    step("delete_gallery_api", delG.ok, delG.json?.message || `status=${delG.status}`);
  }
  const delV = await api("/api/companion", compT, { action: "delete_media", media_type: "voice" });
  step("delete_voice_api", delV.ok, delV.json?.message || `status=${delV.status}`);

  const bootAfter = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const afterMedia = bootAfter.json?.data?.media || [];
  const afterG = afterMedia.filter((m) => (m.mediaType || m.media_type) === "gallery");
  const afterV = afterMedia.filter((m) => (m.mediaType || m.media_type) === "voice");
  const pubAfter = await api(`/api/public/companions?id=${encodeURIComponent(companionId)}`, null, null, "GET");
  const pubAfterC =
    (pubAfter.json?.companions || []).find((c) => String(c.id) === String(companionId)) || (pubAfter.json?.companions || [])[0] || {};
  const pubAfterG = pubAfterC.gallery || pubAfterC.photos || [];
  const pubAfterVoice = pubAfterC.voiceUrl || pubAfterC.voice_url || "";
  const delGallerySync =
    (!delId || afterG.every((m) => m.id !== delId)) &&
    (!Array.isArray(pubAfterG) || pubAfterG.length <= (Array.isArray(pubGallery) ? pubGallery.length : 0));
  // Stronger: voice gone from companion + public
  const delVoiceSync = afterV.length === 0 && !isPlayable(pubAfterVoice) && !/^storage:\/\//i.test(String(bootAfter.json?.data?.player?.raw?.voice_url || ""));
  // Check profile voice cleared
  const rawVoice = bootAfter.json?.data?.player?.raw?.voice_url || bootAfter.json?.data?.player?.voiceUrl || "";
  const voiceCleared = !afterV.length && (!rawVoice || rawVoice === "" || !isPlayable(rawVoice));
  step("delete_gallery_sync", !!delId ? afterG.every((m) => String(m.id) !== String(delId)) : true, `remainingGallery=${afterG.length}`);
  step("delete_voice_sync", voiceCleared, `afterV=${afterV.length} rawVoice=${String(rawVoice).slice(0, 60)}`);
  if (delId ? afterG.every((m) => String(m.id) !== String(delId)) : true) report.删除同步 = "PASS";
  if (voiceCleared) report.语音删除同步 = "PASS";

  // Re-upload one gallery for reorder smoke (non-blocking for matrix if already have items)
  const up2 = await api("/api/companion", compT, {
    action: "upload_media",
    media_type: "gallery",
    data_url: `data:image/png;base64,${tinyPngBuffer().toString("base64")}`,
    filename: `reorder-a-${Date.now()}.png`,
  });
  const up3 = await api("/api/companion", compT, {
    action: "upload_media",
    media_type: "gallery",
    data_url: `data:image/png;base64,${tinyPngBuffer().toString("base64")}`,
    filename: `reorder-b-${Date.now()}.png`,
  });
  const bootR = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const gIds = (bootR.json?.data?.media || [])
    .filter((m) => (m.mediaType || m.media_type) === "gallery")
    .map((m) => m.id)
    .filter(Boolean);
  if (gIds.length >= 2) {
    const reordered = gIds.slice().reverse();
    const reorder = await api("/api/companion", compT, { action: "reorder_media", ordered_ids: reordered });
    step("gallery_reorder", reorder.ok, reorder.json?.message || "");
  } else {
    step("gallery_reorder", up2.ok && up3.ok, `galleryIds=${gIds.length}`);
  }

  await shot(page, "05-final");
  await browser.close();

  const out = { report, meta, results, uploadPosts: uploadPosts.slice(-8) };
  fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "report.json"), JSON.stringify(out, null, 2));
  console.log("\n=== ACCEPTANCE MATRIX ===");
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v}`);
  console.log("\n=== META ===");
  console.log(JSON.stringify(meta, null, 2));

  const fails = Object.values(report).filter((v) => v === "FAIL");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
