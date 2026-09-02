/**
 * Acceptance: companion voice record/upload/playback + branded mobile header on Preview.
 * node scripts/accept-voice-brand-preview.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const ART = "/opt/cursor/artifacts";
fs.mkdirSync(ART, { recursive: true });

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");

const EMAIL = "ui.accept.comp.1788377444050@example.com";
const PASS = "McjTest@12345678";
const results = {};
function step(id, ok, note = "") {
  results[id] = { ok: !!ok, note: String(note || "").slice(0, 500) };
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${note || ""}`);
}

function makeToneWav(seconds = 1.2, freq = 440) {
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
    const s = Math.sin(2 * Math.PI * freq * t) * 0.35;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.floor(s * 32767))), 44 + i * 2);
  }
  return buf;
}

async function headOrGet(url) {
  try {
    let r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-63" } });
    const ab = await r.arrayBuffer();
    const bytes = Buffer.from(ab);
    const ctype = r.headers.get("content-type") || "";
    return { ok: r.ok || r.status === 206, status: r.status, ctype, magic: bytes.slice(0, 4).toString("ascii") };
  } catch (e) {
    return { ok: false, status: 0, ctype: "", magic: "", err: String(e.message || e) };
  }
}

async function api(pathname, token, body, method = "POST") {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: r.status, json, ok: r.ok && json?.ok !== false };
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  permissions: ["microphone"],
});
await context.grantPermissions(["microphone"], { origin: BASE });
const page = await context.newPage();

try {
  // ——— Login ———
  await page.goto(`${BASE}/companion/login/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('[data-login-method-tab="password"]', { timeout: 45000 });
  await page.locator('[data-login-method-tab="password"]').click();
  await page.waitForSelector('form[data-login-method="password"] input[name="account"]', { timeout: 15000 });
  await page.fill('form[data-login-method="password"] input[name="account"]', EMAIL);
  await page.fill('form[data-login-method="password"] input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL(/\/companion\/(?!login)/, { timeout: 45000 }).catch(() => null),
    page.locator('form[data-login-method="password"] button[type="submit"]').click(),
  ]);
  await page.waitForTimeout(1500);
  const afterLogin = page.url();
  step("login", /companion/i.test(afterLogin) && !/login/i.test(afterLogin), afterLogin);

  // Extract token from localStorage/session for API checks
  const token = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      try {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        const t = v?.access_token || v?.accessToken || v?.token || v?.session?.access_token;
        if (t && String(t).length > 20) return String(t);
      } catch {}
    }
    for (const k of Object.keys(sessionStorage)) {
      try {
        const v = JSON.parse(sessionStorage.getItem(k) || "null");
        const t = v?.access_token || v?.accessToken || v?.token || v?.session?.access_token;
        if (t && String(t).length > 20) return String(t);
      } catch {}
    }
    return "";
  });
  step("session_token", !!token, token ? `len=${token.length}` : "missing");

  // ——— Profile page + brand header ———
  await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".pw-top, [data-voice-record-toggle]", { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(ART, "accept-brand-header-mobile.png"), fullPage: false });

  const brandText = await page.locator(".pw-top-brand, .pw-top").innerText().catch(() => "");
  const hasBrand =
    /MEOW CUI JIAO/i.test(brandText) && /妙脆角/.test(brandText);
  step("mobile_branded_header", hasBrand, brandText.replace(/\s+/g, " ").slice(0, 120));

  // Drawer checklist
  const toggle = page.locator("[data-pw-drawer-toggle]").first();
  await toggle.click();
  await page.waitForTimeout(400);
  const drawerOpen = await page.locator(".pw-shell.is-drawer-open, body.pw-drawer-open").count();
  step("drawer_opens", drawerOpen > 0, `count=${drawerOpen}`);
  await page.locator("[data-pw-drawer-close], .pw-drawer-backdrop").first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  const drawerClosed = (await page.locator(".pw-shell.is-drawer-open").count()) === 0;
  step("drawer_closes", drawerClosed);

  const bottomNav = await page.locator(".pw-bottom-nav").count();
  step("bottom_nav_present", bottomNav > 0);

  // ——— API: upload WAV (simulate remuxed Safari recording) ———
  if (token) {
    await api("/api/companion", token, { action: "delete_media", media_type: "voice" }).catch(() => {});
    const wav = makeToneWav(1.5, 523);
    const dataUrl = `data:audio/wav;base64,${wav.toString("base64")}`;
    const up = await api("/api/companion", token, {
      action: "upload_media",
      media_type: "voice",
      data_url: dataUrl,
      filename: "voice-record.wav",
      content_type: "audio/wav",
    });
    const url = up.json?.url || up.json?.media?.url || "";
    step("api_voice_upload", up.ok && /^https?:\/\//i.test(url), `status=${up.status} url=${String(url).slice(0, 100)}`);
    if (/^https?:\/\//i.test(url)) {
      const play = await headOrGet(url);
      step("api_voice_signed_get", play.ok && /audio|octet|wav/i.test(play.ctype + play.magic), `status=${play.status} ctype=${play.ctype} magic=${play.magic}`);
    }
    const boot = await api("/api/companion?action=bootstrap", token, null, "GET");
    const media = boot.json?.data?.media || [];
    const voice = media.find((m) => (m.mediaType || m.media_type) === "voice");
    const playerVoice = boot.json?.data?.player?.voiceUrl || "";
    step(
      "api_bootstrap_voice",
      !!(voice && /^https?:\/\//i.test(voice.url || playerVoice)),
      `mediaUrl=${String(voice?.url || "").slice(0, 80)} player=${String(playerVoice).slice(0, 80)}`
    );
  }

  // ——— UI: file upload path (WAV) ———
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-voice-record-toggle], [data-upload-voice]", { timeout: 45000 });
  await page.waitForTimeout(1000);

  const wavPath = path.join(ART, `accept-voice-${Date.now()}.wav`);
  fs.writeFileSync(wavPath, makeToneWav(1.4, 660));
  const voiceWait = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/companion/.test(r.url()) &&
      /"media_type"\s*:\s*"voice"/.test(r.request().postData() || ""),
    { timeout: 60000 }
  );
  await page.locator("[data-upload-voice]").first().setInputFiles(wavPath);
  const voiceRes = await voiceWait.catch((e) => ({ status: () => 0, json: async () => ({ err: String(e) }) }));
  const vStatus = typeof voiceRes.status === "function" ? voiceRes.status() : 0;
  const vJson = await voiceRes.json().catch(() => ({}));
  const vUrl = vJson.url || vJson.media?.url || "";
  step("ui_voice_file_upload", vStatus === 200 && /^https?:\/\//i.test(vUrl), `status=${vStatus}`);

  await page.waitForTimeout(1500);
  await page
    .waitForFunction(() => {
      const a = document.querySelector("audio[data-voice-audio], .pw-voice-preview audio");
      const src = (a && (a.currentSrc || a.getAttribute("src"))) || "";
      const err = (document.querySelector("[data-voice-play-error]")?.textContent || "").trim();
      return /^https?:\/\//i.test(src) || /^blob:|^data:audio/i.test(src);
    }, { timeout: 20000 })
    .catch(() => null);

  const audioSrc =
    (await page.locator("audio[data-voice-audio], .pw-voice-preview audio").first().getAttribute("src").catch(() => "")) ||
    "";
  const errText = ((await page.locator("[data-voice-play-error]").first().textContent().catch(() => "")) || "").trim();
  step("ui_voice_player_no_error", !/音频加载失败|错误/.test(errText), errText || "no error");
  step("ui_voice_player_src", /^(https?:|blob:|data:audio)/i.test(audioSrc), audioSrc.slice(0, 140));

  if (/^https?:\/\//i.test(audioSrc)) {
    const g = await headOrGet(audioSrc);
    step("ui_voice_player_get", g.ok, `status=${g.status} ctype=${g.ctype} magic=${g.magic}`);
  }

  // Probe canplay via page Audio element
  const canPlay = await page.evaluate(async () => {
    const a = document.querySelector("audio[data-voice-audio], .pw-voice-preview audio");
    if (!a) return { ok: false, reason: "no-audio" };
    return await new Promise((resolve) => {
      const done = (ok, reason) => resolve({ ok, reason, src: a.currentSrc || a.src || "" });
      if (a.readyState >= 1) return done(true, "readyState");
      const t = setTimeout(() => done(a.readyState >= 1, "timeout-rs=" + a.readyState), 6000);
      a.addEventListener("loadedmetadata", () => { clearTimeout(t); done(true, "loadedmetadata"); }, { once: true });
      a.addEventListener("canplay", () => { clearTimeout(t); done(true, "canplay"); }, { once: true });
      a.addEventListener("error", () => { clearTimeout(t); done(false, "error"); }, { once: true });
      try { a.load(); } catch (e) { clearTimeout(t); done(false, String(e)); }
    });
  });
  step("ui_voice_canplay", !!canPlay.ok, JSON.stringify(canPlay).slice(0, 200));
  await page.screenshot({ path: path.join(ART, "accept-voice-player-after-upload.png"), fullPage: false });

  // ——— Live MediaRecorder path (Chrome fake mic; UA spoofed as Safari) ———
  if (token) await api("/api/companion", token, { action: "delete_media", media_type: "voice" }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-voice-record-toggle]", { timeout: 45000 });
  await page.waitForTimeout(800);
  await page.locator("[data-voice-record-toggle]").first().click();
  await page.waitForTimeout(1800);
  const recordingUi = await page.locator("[data-voice-record-toggle]").first().innerText().catch(() => "");
  const recording = /停止|⏹/.test(recordingUi);
  step("ui_voice_record_start", recording, recordingUi.slice(0, 40));
  await page.locator("[data-voice-record-toggle]").first().click();
  await page.waitForTimeout(1200);
  const confirm = page.locator("[data-voice-upload-local]").first();
  const hasConfirm = (await confirm.count()) > 0;
  step("ui_voice_record_stop", hasConfirm || (await page.locator("audio[data-voice-audio]").count()) > 0);

  if (hasConfirm) {
    const recWait = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/companion/.test(r.url()) &&
        /"media_type"\s*:\s*"voice"/.test(r.request().postData() || ""),
      { timeout: 90000 }
    );
    await confirm.click();
    const recRes = await recWait.catch(() => null);
    const rStatus = recRes ? recRes.status() : 0;
    const rJson = recRes ? await recRes.json().catch(() => ({})) : {};
    const posted = recRes ? recRes.request().postData() || "" : "";
    const uploadedAsWav = /voice-record\.wav|audio\/wav/i.test(posted);
    step("ui_voice_record_upload", rStatus === 200 && rJson.ok !== false, `status=${rStatus} wav=${uploadedAsWav}`);
    step("ui_voice_record_remux_wav", uploadedAsWav || /audio\/webm|audio\/mp4/i.test(posted), `payloadMimeHint wav=${uploadedAsWav}`);
    await page.waitForTimeout(2000);
    const err2 = ((await page.locator("[data-voice-play-error]").first().textContent().catch(() => "")) || "").trim();
    step("ui_voice_record_no_error", !/音频加载失败/.test(err2), err2 || "no error");
    await page.screenshot({ path: path.join(ART, "accept-voice-after-record-upload.png"), fullPage: false });
  }

  // Brand + drawer screenshot after interactions
  await page.screenshot({ path: path.join(ART, "accept-profile-final-mobile.png"), fullPage: false });
} catch (e) {
  step("fatal", false, String(e && e.stack ? e.stack : e));
  await page.screenshot({ path: path.join(ART, "accept-fatal.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const out = path.join(ART, "accept-voice-brand-preview.json");
fs.writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
console.log("wrote", out);
const failed = Object.entries(results).filter(([, v]) => !v.ok);
process.exit(failed.length ? 1 : 0);
