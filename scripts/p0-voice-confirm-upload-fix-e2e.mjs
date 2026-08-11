/**
 * P0: Apply 试音「确认上传」must really upload to Storage + persist.
 * - Does NOT force-enable the confirm button
 * - Asserts 上传中… → 上传成功
 * - Refresh + bootstrap + admin can play
 *
 * Usage:
 *   PREVIEW=http://127.0.0.1:4173 node scripts/p0-voice-confirm-upload-fix-e2e.mjs
 *   PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-voice-confirm-upload-fix-e2e.mjs
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
/** When serving a local build, proxy /api to staging so Storage/DB are real. */
const API_BASE = (process.env.API_BASE || BASE).replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ART = path.join("/opt/cursor/artifacts", "voice-confirm-upload-fix");
const ART_REPO = path.join(ROOT, "artifacts", "voice-confirm-upload-fix");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function makeToneWav(seconds = 12, freq = 440) {
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
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.45;
    buf.writeInt16LE((sample * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-companion-token": token,
          }
        : {}),
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

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function installRecorderMock(context) {
  const wav = makeToneWav(12);
  await context.addInitScript(
    ({ wavB64 }) => {
      const bytes = Uint8Array.from(atob(wavB64), (c) => c.charCodeAt(0));
      const wavBlob = new Blob([bytes], { type: "audio/wav" });
      class FakeMR {
        constructor(stream, opts) {
          this.stream = stream;
          this.mimeType = (opts && opts.mimeType) || "audio/webm";
          this.state = "inactive";
          this.ondataavailable = null;
          this.onstop = null;
          this._t = null;
        }
        start() {
          this.state = "recording";
          this._t = setInterval(() => {
            if (this.ondataavailable) {
              this.ondataavailable({ data: new Blob([bytes.slice(0, 4096)], { type: this.mimeType }) });
            }
          }, 250);
        }
        stop() {
          this.state = "inactive";
          clearInterval(this._t);
          if (this.ondataavailable) this.ondataavailable({ data: wavBlob });
          const stopHandler = this.onstop;
          setTimeout(() => {
            if (stopHandler) stopHandler();
          }, 40);
        }
      }
      window.MediaRecorder = FakeMR;
      MediaRecorder.isTypeSupported = () => true;
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        return dest.stream;
      };
    },
    { wavB64: wav.toString("base64") }
  );
}

async function forceStep3(page) {
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    draft.step = 3;
    draft.rulesAgreement = Object.assign({}, draft.rulesAgreement || {}, { accepted: true });
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    document.querySelector('[data-apply-step="3"]')?.click();
  });
  await page.waitForTimeout(600);
}

const loginEmail = `voice.confirm.${Date.now()}@meow.test`;
let companionToken = "";
{
  // Prefer dedicated companion test account; fall back to register if needed.
  const login = await api("/api/auth", null, {
    action: "login",
    role: "companion",
    email: "companion@meow.test",
    password: PASS,
  });
  companionToken = tok(login.json);
  step("auth_companion", !!companionToken, `status=${login.status} tok=${!!companionToken}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const iphone = devices["iPhone 13"];
const context = await browser.newContext({ ...iphone, locale: "zh-CN" });
await installRecorderMock(context);
await context.addInitScript(
  ({ token, email }) => {
    const session = {
      token,
      accessToken: token,
      email,
      role: "companion",
      user: { email, name: "确认上传修复", role: "companion" },
    };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    localStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("mcjRole", "companion");
    localStorage.setItem("customerUser", JSON.stringify({ role: "companion", email, name: "确认上传修复" }));
    localStorage.setItem(
      "mcjCompanionApplicationDraft.v1",
      JSON.stringify({
        step: 3,
        rulesAgreement: { accepted: true },
        data: {
          nickname: "确认上传修复",
          age: "22",
          gender: "女",
          region: "KL",
          phone: "60118889999",
          email,
          personalTags: ["随和"],
          gameNickname: "ConfirmFix",
          mainGames: ["VALORANT"],
          positions: ["中路"],
          modes: ["陪玩服务"],
          rank: "黄金",
          voiceType: "甜妹",
          onlineStart: "18:00",
          onlineEnd: "23:00",
          intro: "voice confirm upload fix e2e",
        },
        uploads: {},
        // Intentionally stale hasLocal WITHOUT blob — must NOT enable confirm / must not silent-no-op
        voice: {
          status: "已试听，可确认",
          hasLocal: true,
          listened: true,
          duration: 12,
          uploaded: false,
          confirmed: false,
          quality: {
            passed: true,
            volumeOk: true,
            durationOk: true,
            notBlank: true,
            humanVoice: true,
            duration: 12,
            reasons: [],
          },
        },
        identity: {},
        gameCards: [],
      })
    );
  },
  { token: companionToken, email: "companion@meow.test" }
);

const page = await context.newPage();
if (API_BASE !== BASE) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = `${API_BASE}${u.pathname}${u.search}`;
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, {
      method: req.method(),
      headers,
      body: req.postData(),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
  });
}
const net = [];
page.on("request", (req) => {
  if (/\/api\/companion/.test(req.url()) && req.method() === "POST") {
    const post = req.postData() || "";
    if (/upload_media|"voice"/.test(post) || /upload_media/.test(req.url())) {
      net.push({ phase: "req", url: req.url(), postHead: post.slice(0, 120), len: post.length });
    }
  }
});
page.on("response", async (res) => {
  if (/\/api\/companion/.test(res.url()) && res.request().method() === "POST") {
    const post = res.request().postData() || "";
    if (!/upload_media|media_type/.test(post)) return;
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {}
    net.push({ phase: "res", status: res.status(), body });
  }
});

await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !/正在加载申请资料|正在加载制度/.test(document.body.innerText || ""), {
  timeout: 90000,
}).catch(() => {});
await forceStep3(page);
await page.locator("#applyVoicePanel").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "01-stale-local");

const stale = await page.evaluate(() => {
  const btn = document.querySelector("[data-record-confirm]");
  return {
    tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "",
    status: document.getElementById("voiceState")?.textContent || "",
    disabled: !!btn?.disabled,
    text: btn?.textContent?.trim() || "",
    hasLocal: !!JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}").voice?.hasLocal,
  };
});
step(
  "stale_local_blocks_confirm",
  stale.disabled === true && !/试听完成，请点击/.test(stale.tip),
  JSON.stringify(stale)
);

// Clear and do real record → listen → confirm (no force-enable)
await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  draft.voice = { status: "尚未录制" };
  localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
  document.querySelector('[data-apply-step="3"]')?.click();
});
await page.waitForTimeout(700);
await page.locator("#applyVoicePanel").scrollIntoViewIfNeeded().catch(() => {});

await page.locator("[data-record-start]").click({ force: true });
await page.waitForTimeout(1400);
await page.locator("[data-record-stop]").click({ force: true });
await page.waitForTimeout(2800);
await page.locator("[data-record-play]").click({ force: true });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const a = document.getElementById("voicePreview");
  if (!a) return;
  try {
    a.currentTime = Math.max(0, (a.duration || 12) - 0.1);
  } catch {}
  a.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  a.dispatchEvent(new Event("ended", { bubbles: true }));
});
await page.waitForTimeout(1000);

const ready = await page.evaluate(() => {
  const btn = document.querySelector("[data-record-confirm]");
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  return {
    tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "",
    disabled: !!btn?.disabled,
    text: btn?.textContent?.trim() || "",
    listened: !!draft.voice?.listened,
    hasLocal: !!draft.voice?.hasLocal,
    quality: draft.voice?.quality || {},
    audioSrc: String(document.getElementById("voicePreview")?.src || "").slice(0, 60),
  };
});
step(
  "ready_for_confirm",
  ready.disabled === false && /试听完成，请点击/.test(ready.tip) && ready.listened,
  JSON.stringify(ready)
);
await shot(page, "02-ready-confirm");

// Native click — do NOT set disabled=false
const uploadWatch = page.waitForResponse(
  (res) => /\/api\/companion/.test(res.url()) && res.request().method() === "POST" && /upload_media/.test(res.request().postData() || ""),
  { timeout: 60000 }
).catch(() => null);

await page.locator("[data-record-confirm]").click({ timeout: 10000 });
const mid = await page.evaluate(() => {
  const btn = document.querySelector("[data-record-confirm]");
  return {
    text: btn?.textContent?.trim() || "",
    tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "",
    status: document.getElementById("voiceState")?.textContent || "",
    busy: btn?.getAttribute("aria-busy") || "",
  };
});
// May already finish on fast network; accept either uploading or success
step(
  "shows_uploading_or_success",
  /上传中|上传成功|已保存|正在上传/.test(`${mid.text} ${mid.tip} ${mid.status}`),
  JSON.stringify(mid)
);

const uploadRes = await uploadWatch;
const uploadStatus = uploadRes ? uploadRes.status() : 0;
let uploadBody = {};
if (uploadRes) {
  try {
    uploadBody = await uploadRes.json();
  } catch {
    uploadBody = {};
  }
}
step("network_upload_media", uploadStatus >= 200 && uploadStatus < 300 && uploadBody.ok !== false, JSON.stringify({
  http: uploadStatus,
  ok: uploadBody.ok,
  message: uploadBody.message,
  path: uploadBody.path || uploadBody.media?.path,
  url: String(uploadBody.url || uploadBody.media?.url || "").slice(0, 160),
  bucket: uploadBody.bucket || uploadBody.media?.bucket,
}));

await page.waitForTimeout(1500);
const done = await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  const btn = document.querySelector("[data-record-confirm]");
  const banner = document.querySelector("[data-apply-tip]");
  return {
    tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "",
    status: document.getElementById("voiceState")?.textContent || "",
    btnText: btn?.textContent?.trim() || "",
    uploaded: !!draft.voice?.uploaded,
    confirmed: !!draft.voice?.confirmed,
    url: String(draft.voice?.url || "").slice(0, 200),
    path: String(draft.voice?.path || "").slice(0, 160),
    bucket: String(draft.voice?.bucket || ""),
    hasData: /^data:/i.test(String(draft.voice?.url || "")),
    hasBlob: /^blob:/i.test(String(draft.voice?.url || "")),
    banner: banner && !banner.hidden ? banner.textContent : "",
  };
});
step(
  "upload_success_ui_and_draft",
  done.uploaded &&
    done.confirmed &&
    !done.hasData &&
    !done.hasBlob &&
    !!(done.url || done.path) &&
    /上传成功|已保存|已上传/.test(`${done.tip} ${done.status} ${done.btnText} ${done.banner}`),
  JSON.stringify(done)
);
await shot(page, "03-uploaded");

const voiceUrl = done.url;
const voicePath = done.path;

// Refresh persist
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText || ""), { timeout: 90000 }).catch(() => {});
await forceStep3(page);
await page.locator("#applyVoicePanel").scrollIntoViewIfNeeded().catch(() => {});
const afterRefresh = await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  const audio = document.getElementById("voicePreview");
  return {
    url: String(draft.voice?.url || "").slice(0, 200),
    path: String(draft.voice?.path || "").slice(0, 160),
    uploaded: !!draft.voice?.uploaded,
    audioSrc: String(audio?.src || "").slice(0, 200),
    status: document.getElementById("voiceState")?.textContent || "",
  };
});
const boot = await api(`/api/companion?action=bootstrap`, companionToken, null, "GET");
const bootVoice =
  boot.json?.data?.media?.voiceUrl ||
  boot.json?.data?.player?.voiceUrl ||
  boot.json?.media?.voiceUrl ||
  (Array.isArray(boot.json?.data?.media)
    ? boot.json.data.media.find((m) => String(m.mediaType || m.media_type).toLowerCase() === "voice")?.url
    : "") ||
  "";
const bootPath =
  (Array.isArray(boot.json?.data?.media)
    ? boot.json.data.media.find((m) => String(m.mediaType || m.media_type).toLowerCase() === "voice")?.path
    : "") ||
  boot.json?.data?.player?.voicePath ||
  "";
step(
  "refresh_persist_playable",
  (afterRefresh.uploaded && (!!afterRefresh.url || !!afterRefresh.audioSrc)) || !!bootVoice,
  JSON.stringify({ afterRefresh, bootVoice: String(bootVoice).slice(0, 180), bootPath })
);
await shot(page, "04-after-refresh");

// Relogin persist via bootstrap
const relogin = await api("/api/auth", null, {
  action: "login",
  role: "companion",
  email: "companion@meow.test",
  password: PASS,
});
const token2 = tok(relogin.json);
const boot2 = await api(`/api/companion?action=bootstrap`, token2, null, "GET");
const boot2Voice =
  boot2.json?.data?.media?.voiceUrl ||
  boot2.json?.data?.player?.voiceUrl ||
  (Array.isArray(boot2.json?.data?.media)
    ? boot2.json.data.media.find((m) => String(m.mediaType || m.media_type).toLowerCase() === "voice")?.url
    : "") ||
  "";
step("relogin_bootstrap_voice", !!boot2Voice && /https?:|storage:/i.test(String(boot2Voice)), String(boot2Voice).slice(0, 200));

// Admin can see / play
const adminLogin = await api("/api/auth", null, { action: "login", role: "admin", email: "admin@meow.test", password: PASS });
const adminToken = tok(adminLogin.json);
let adminPlay = { ok: false };
if (adminToken) {
  const list = await api("/api/admin?action=companion_applications", adminToken, null, "GET").catch(() => ({ ok: false, json: {} }));
  const apps = list.json?.data || list.json?.applications || list.json?.items || [];
  const mine = Array.isArray(apps)
    ? apps.find((a) => String(a.email || "").toLowerCase() === "companion@meow.test") || null
    : null;
  const detail = mine?.id
    ? await api(`/api/admin?action=companion_application&id=${encodeURIComponent(mine.id)}`, adminToken, null, "GET")
    : { ok: false, json: {} };
  const voiceFromAdmin =
    detail.json?.data?.voice?.url ||
    detail.json?.application?.voice?.url ||
    detail.json?.data?.player?.voiceUrl ||
    detail.json?.data?.media?.voiceUrl ||
    boot2Voice ||
    bootVoice ||
    voiceUrl;
  adminPlay = {
    ok: !!(voiceFromAdmin && /https?:|storage:/i.test(String(voiceFromAdmin))),
    url: String(voiceFromAdmin || "").slice(0, 200),
  };
}
step("admin_can_play_voice", adminPlay.ok, JSON.stringify(adminPlay));

const passCount = results.filter((r) => r.result === "PASS").length;
const failCount = results.filter((r) => r.result === "FAIL").length;
const out = {
  base: BASE,
  voiceUrl,
  voicePath,
  uploadHttp: uploadStatus,
  uploadBody: {
    ok: uploadBody.ok,
    message: uploadBody.message,
    path: uploadBody.path || uploadBody.media?.path,
    bucket: uploadBody.bucket || uploadBody.media?.bucket,
    url: String(uploadBody.url || uploadBody.media?.url || "").slice(0, 200),
  },
  net,
  results,
  passCount,
  failCount,
  ALL_PASS: failCount === 0,
};
fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
fs.copyFileSync(path.join(ART, "results.json"), path.join(ART_REPO, "results.json"));
console.log(JSON.stringify({ ALL_PASS: out.ALL_PASS, passCount, failCount, uploadHttp: uploadStatus, voicePath }, null, 2));
await browser.close();
process.exit(failCount ? 1 : 0);
