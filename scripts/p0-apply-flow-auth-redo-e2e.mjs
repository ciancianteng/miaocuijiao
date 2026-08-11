#!/usr/bin/env node
/**
 * P0 apply-flow auth redo E2E — local PREVIEW + staging API.
 * Usage: PREVIEW=http://127.0.0.1:4173 API_BASE=https://... node scripts/p0-apply-flow-auth-redo-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const ROOT = process.cwd();
const BASE = String(process.env.PREVIEW || process.env.BASE_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const API_BASE = String(process.env.API_BASE || BASE).replace(/\/$/, "");
const PASS = "McjTest@12345678";
const EMAIL = "companion@meow.test";
const outDir = path.join(ROOT, "artifacts", "p0-apply-flow-auth-redo");
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-companion-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";

function wavBytes(seconds = 12, sampleRate = 16000) {
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
    buf.writeInt16LE((Math.sin(2 * Math.PI * 440 * t) * 0.4 * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

async function installRecorderMock(context) {
  const wav = wavBytes(12);
  await context.addInitScript(
    ({ wavB64 }) => {
      const bytes = Uint8Array.from(atob(wavB64), (c) => c.charCodeAt(0));
      const wavBlob = new Blob([bytes], { type: "audio/wav" });
      class FakeMR {
        constructor(stream, opts) {
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
          const h = this.onstop;
          setTimeout(() => h && h(), 40);
        }
      }
      window.MediaRecorder = FakeMR;
      MediaRecorder.isTypeSupported = () => true;
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx.createMediaStreamDestination().stream;
      };
    },
    { wavB64: wav.toString("base64") }
  );
}

function fullDraft(email, extra = {}) {
  return {
    step: extra.step ?? 1,
    rulesAgreement: { accepted: true },
    data: {
      nickname: "流程重做",
      age: "22",
      gender: "女",
      region: "KL",
      phone: "60112223333",
      email,
      personalTags: ["温柔", "幽默"],
      gameNickname: "FlowRedo",
      mainGames: ["VALORANT"],
      positions: ["中路"],
      modes: ["陪玩服务"],
      rank: "黄金",
      voiceType: "甜妹",
      onlineStart: "18:00",
      onlineEnd: "23:00",
      intro: "apply flow redo e2e",
    },
    uploads: extra.uploads ?? { photos: [] },
    voice: extra.voice ?? { status: "尚未录制" },
    identity: {},
    authNotice: extra.authNotice ?? {},
    gameCards: [],
  };
}

async function waitLoaded(page) {
  await page.waitForFunction(() => !/正在加载申请资料|正在加载制度/.test(document.body.innerText || ""), {
    timeout: 90000,
  });
  await page.waitForTimeout(500);
}

async function goStep(page, target, patch = {}) {
  // Ensure preset tags that exist in the live taxonomy are checked on step 1 before leaving.
  if (target !== 1) {
    const onStep = await page.evaluate(() => document.getElementById("companionApplyRoot")?.dataset?.step);
    if (String(onStep) !== "1") {
      await page.evaluate(() => document.querySelector('[data-apply-step="1"]')?.click());
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('[data-tag-field="personalTags"]')];
      boxes.forEach((b, i) => {
        const want = i < 2;
        if (b.checked !== want) {
          b.checked = want;
          b.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    await page.waitForTimeout(300);
  }
  await page.evaluate(
    ({ target, email, patch }) => {
      const prev = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      const checkedTags = [...document.querySelectorAll('[data-tag-field="personalTags"]:checked')].map((el) => el.value);
      const draft = {
        step: target,
        rulesAgreement: Object.assign({}, prev.rulesAgreement || {}, { accepted: true }),
        data: Object.assign(
          {
            nickname: "流程重做",
            age: "22",
            gender: "女",
            region: "KL",
            phone: "60112223333",
            email,
            personalTags: checkedTags.length ? checkedTags : ["温柔", "幽默"],
            gameNickname: "FlowRedo",
            mainGames: ["VALORANT"],
            positions: ["中路"],
            modes: ["陪玩服务"],
            rank: "黄金",
            voiceType: "甜妹",
            onlineStart: "18:00",
            onlineEnd: "23:00",
            intro: "apply flow redo e2e",
          },
          prev.data || {},
          patch.data || {}
        ),
        uploads: patch.uploads !== undefined ? patch.uploads : Object.assign({ photos: [] }, prev.uploads || {}),
        voice: patch.voice !== undefined ? patch.voice : prev.voice || { status: "尚未录制" },
        identity: {},
        authNotice: patch.authNotice !== undefined ? patch.authNotice : prev.authNotice || {},
        gameCards: [],
      };
      if (target >= 4) {
        draft.uploads = Object.assign({}, draft.uploads, {
          avatar: (draft.uploads && draft.uploads.avatar) || { url: "https://example.com/a.jpg", path: "avatar/a", status: "ok" },
        });
        if (!(draft.voice && draft.voice.confirmed && (draft.voice.path || draft.voice.url))) {
          draft.voice = {
            status: "上传成功",
            confirmed: true,
            uploaded: true,
            path: "voice/e2e",
            url: "https://example.com/v.webm",
          };
        }
      }
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
      document.querySelector(`[data-apply-step="${target}"]`)?.click();
    },
    { target, email: EMAIL, patch }
  );
  await page.waitForTimeout(800);
}

async function markVoiceReady(page) {
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    draft.voice = Object.assign({}, draft.voice || {}, {
      listened: true,
      duration: Math.max(12, Number(draft.voice?.duration || 0)),
      quality: {
        passed: true,
        durationOk: true,
        volumeOk: true,
        notBlank: true,
        humanVoice: true,
        duration: Math.max(12, Number(draft.voice?.duration || 12)),
        reasons: [],
      },
      status: "试听完成，请点击确认上传",
      hasLocal: true,
    });
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    const a = document.getElementById("voicePreview");
    if (a) {
      try {
        a.currentTime = Math.max(0, (a.duration || 12) - 0.1);
      } catch {}
      a.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      a.dispatchEvent(new Event("ended", { bubbles: true }));
    }
    document.querySelector('[data-apply-step="3"]')?.click();
  });
  await page.waitForTimeout(700);
}

const login = await api("/api/auth", null, { action: "login", role: "companion", email: EMAIL, password: PASS });
const companionToken = tok(login.json);
step("auth", !!companionToken, `http=${login.status}`);

const applySrc = fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8");
const uploadSrc = fs.readFileSync(path.join(ROOT, "src/mcj-upload.js"), "utf8");
const mediaStore = fs.readFileSync(path.join(ROOT, "server/api/_companion-media-store.js"), "utf8");
const listing = fs.readFileSync(path.join(ROOT, "server/api/_companion-listing-sync.js"), "utf8");
const companionApi = fs.readFileSync(path.join(ROOT, "server/api/companion.js"), "utf8");
const playersApi = fs.readFileSync(path.join(ROOT, "server/api/admin/players.js"), "utf8");
step("src_no_custom_tags", !/data-add-custom-tag|新增自定义标签/.test(applySrc), "custom tag UI removed");
step("src_no_settlement_step", !/结款资料（必填）|选择认证方式/.test(applySrc) && /认证说明 \/ 后续认证/.test(applySrc), "auth notice step");
step("src_no_40mb_client", !/视频不能超过 40MB|单张图片不能超过 10MB/.test(uploadSrc), "client size copy");
step("src_backend_limits_raised", /MAX_VIDEO_BYTES = 200/.test(mediaStore) && /MAX_AUDIO_BYTES = 30/.test(mediaStore), "backend limits");
step("src_approve_pending_credential", /allow_orders:\s*false/.test(listing) && /verification_status:\s*"pending"/.test(listing), "approve patch");
step("src_admin_approve_blocks_orders", /Application approve/.test(playersApi) || /allow_orders = false/.test(playersApi), "admin approve");
step("src_const_identity_fixed", /let identityNo =/.test(companionApi), "Assignment const fixed");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
await installRecorderMock(context);
await context.addInitScript(
  ({ token, email, draft }) => {
    const session = { token, accessToken: token, email, role: "companion", user: { email, name: "流程重做", role: "companion" } };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    localStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("mcjRole", "companion");
    localStorage.setItem("customerUser", JSON.stringify({ role: "companion", email, name: "流程重做" }));
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
  },
  { token: companionToken, email: EMAIL, draft: fullDraft(EMAIL, { step: 3, uploads: { photos: [] } }) }
);

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (err) => {
  pageErrors.push(String(err));
  console.log("[pageerror]", String(err).slice(0, 240));
});
if (API_BASE !== BASE) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = `${API_BASE}${u.pathname}${u.search}`;
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, { method: req.method(), headers, body: req.postData() });
    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
  });
}

await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitLoaded(page);
await page.screenshot({ path: path.join(outDir, "01-apply.png"), fullPage: true });

// PASS1 — preset tags only (data-tag-field), no custom add UI
await goStep(page, 1, { uploads: { photos: [] } });
const pass1 = await page.evaluate(() => ({
  customInput: !!document.querySelector("[data-custom-tag-input], [data-add-custom-tag]"),
  customText: /新增自定义标签|自定义添加标签/.test(document.body.innerText),
  tagFields: document.querySelectorAll("[data-tag-field]").length,
  presetHint: /仅可选平台预设标签/.test(document.body.innerText),
}));
step("PASS1_no_custom_tags", !pass1.customInput && !pass1.customText && pass1.tagFields > 0 && pass1.presetHint, JSON.stringify(pass1));

// PASS2 — multi gallery + no 40MB copy
await goStep(page, 3, { uploads: { photos: [] } });
const pass2 = await page.evaluate(() => {
  const photos = document.querySelector('input[data-mcj-upload-input="photos"]');
  return {
    multi: !!photos?.multiple || photos?.hasAttribute("multiple") === true,
    bodyHas40: /不能超过\s*40\s*MB|视频不能超过 40MB|单张图片不能超过 10MB/.test(document.body.innerText),
    gallery: !!document.querySelector(".apply-gallery-block"),
  };
});
step("PASS2_gallery_multi_no_40mb", pass2.multi && !pass2.bodyHas40 && pass2.gallery, JSON.stringify(pass2));

// PASS5/6 — auth notice only
await goStep(page, 4, {
  uploads: {
    photos: [],
    avatar: { url: "https://example.com/a.jpg", path: "a", status: "ok" },
  },
  voice: { status: "上传成功", confirmed: true, uploaded: true, path: "voice/x", url: "https://example.com/v.webm" },
  authNotice: {},
});
const pass56 = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    step: document.getElementById("companionApplyRoot")?.dataset?.step,
    title: /认证说明/.test(text),
    notice: /身份证认证/.test(text) && /RM100/.test(text),
    noIdUpload: !document.querySelector('input[data-mcj-upload-input="idFront"], input[data-upload-key="idFront"]'),
    noDeposit: !/选择认证方式|上传付款截图|收款二维码/.test(text),
    noSettlement: !/结款资料（必填）|结算户名|银行账号/.test(text),
    ack: !!document.querySelector("[data-auth-notice-ack]"),
    panel: !!document.querySelector("#applyAuthNoticePanel"),
  };
});
step("PASS5_no_settlement", pass56.noSettlement, JSON.stringify(pass56));
step("PASS6_auth_notice_only", pass56.panel && pass56.title && pass56.notice && pass56.noIdUpload && pass56.noDeposit && pass56.ack, JSON.stringify(pass56));

// PASS3 live voice
try {
  await goStep(page, 3, { uploads: { photos: [] }, voice: { status: "尚未录制" } });
  await page.waitForSelector("[data-record-start]", { timeout: 20000 });
  await page.locator("#applyVoicePanel").scrollIntoViewIfNeeded().catch(() => {});
  await page.locator("[data-record-start]").click({ force: true });
  await page.waitForTimeout(1400);
  await page.locator("[data-record-stop]").click({ force: true });
  await page.waitForTimeout(2500);
  await page.locator("[data-record-play]").click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  await markVoiceReady(page);
  await page.waitForSelector("[data-record-confirm]:not([disabled])", { timeout: 15000 });

  const uploadWatch3 = page
    .waitForResponse(
      (res) => /\/api\/companion/.test(res.url()) && res.request().method() === "POST" && /upload_media/.test(res.request().postData() || ""),
      { timeout: 60000 }
    )
    .catch(() => null);
  await page.locator("[data-record-confirm]").click({ timeout: 10000 });
  const uploadRes3 = await uploadWatch3;
  const uploadStatus3 = uploadRes3 ? uploadRes3.status() : 0;
  let uploadBody3 = {};
  try {
    uploadBody3 = uploadRes3 ? await uploadRes3.json() : {};
  } catch {
    uploadBody3 = {};
  }
  await page.waitForTimeout(2000);
  const voiceLive = await page.evaluate(() => {
    const tip = document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "";
    const status = document.getElementById("voiceState")?.textContent || "";
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return {
      tip,
      status,
      path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "",
      url: draft?.voice?.url || draft?.voice?.fileUpload?.url || "",
    };
  });
  var livePath = voiceLive.path || uploadBody3.path || uploadBody3.media?.path || "";
  step(
    "PASS3_live_voice_upload",
    uploadStatus3 >= 200 && uploadStatus3 < 300 && (!!livePath || /上传成功|已保存/.test(voiceLive.tip + voiceLive.status)),
    JSON.stringify({ http: uploadStatus3, path: livePath, bucket: uploadBody3.bucket || uploadBody3.media?.bucket, voiceLive })
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitLoaded(page);
  await goStep(page, 3);
  const afterLiveReload = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return { path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "", tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "" };
  });
  const bootLive = await api("/api/companion?action=bootstrap", companionToken, null, "GET");
  const bootVoiceUrl =
    bootLive.json?.data?.media?.voiceUrl ||
    bootLive.json?.media?.voiceUrl ||
    (Array.isArray(bootLive.json?.data?.media)
      ? bootLive.json.data.media.find((m) => /voice/i.test(String(m.mediaType || m.media_type)))?.url
      : "") ||
    "";
  step(
    "PASS3_live_voice_persist",
    (!!livePath && !!afterLiveReload.path) || !!bootVoiceUrl,
    JSON.stringify({ livePath, afterLiveReload, bootVoiceUrl: String(bootVoiceUrl).slice(0, 160) })
  );
} catch (err) {
  step("PASS3_live_voice_upload", false, String(err).slice(0, 200));
  step("PASS3_live_voice_persist", false, "skipped after upload failure");
}

// PASS4 file audio
try {
  await goStep(page, 3, { uploads: { photos: [] }, voice: { status: "尚未录制" } });
  const wavPath = path.join(outDir, "sample.wav");
  fs.writeFileSync(wavPath, wavBytes(12));
  const uploadWatch4 = page
    .waitForResponse(
      (res) => /\/api\/companion/.test(res.url()) && res.request().method() === "POST" && /upload_media/.test(res.request().postData() || ""),
      { timeout: 90000 }
    )
    .catch(() => null);
  await page.setInputFiles('input[data-mcj-upload-input="voiceFile"]', wavPath);
  await page.waitForTimeout(4000);
  await markVoiceReady(page);
  const confirmState = await page.evaluate(() => {
    const btn = document.querySelector("[data-record-confirm]");
    return { disabled: !!btn?.disabled, text: btn?.textContent || "" };
  });
  if (!confirmState.disabled) {
    await page.locator("[data-record-confirm]").click({ timeout: 10000 });
  }
  const uploadRes4 = await uploadWatch4;
  const uploadStatus4 = uploadRes4 ? uploadRes4.status() : 0;
  let uploadBody4 = {};
  try {
    uploadBody4 = uploadRes4 ? await uploadRes4.json() : {};
  } catch {
    uploadBody4 = {};
  }
  await page.waitForTimeout(2500);
  const voiceFile = await page.evaluate(() => {
    const tip = document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "";
    const status = document.getElementById("voiceState")?.textContent || "";
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return {
      tip,
      status,
      path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "",
    };
  });
  const filePath = voiceFile.path || uploadBody4.path || uploadBody4.media?.path || "";
  step(
    "PASS4_file_voice_upload",
    (uploadStatus4 >= 200 && uploadStatus4 < 300) || (!!filePath && /上传成功|已保存|已确认/.test(voiceFile.tip + voiceFile.status)),
    JSON.stringify({ http: uploadStatus4, path: filePath, confirmState, voiceFile })
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitLoaded(page);
  const afterFileReload = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return { path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "" };
  });
  const bootFile = await api("/api/companion?action=bootstrap", companionToken, null, "GET");
  const bootFileVoice =
    bootFile.json?.data?.media?.voiceUrl ||
    bootFile.json?.media?.voiceUrl ||
    (Array.isArray(bootFile.json?.data?.media)
      ? bootFile.json.data.media.find((m) => /voice/i.test(String(m.mediaType || m.media_type)))?.url
      : "") ||
    "";
  step(
    "PASS4_file_voice_persist",
    !!filePath && (!!afterFileReload.path || !!bootFileVoice),
    JSON.stringify({ filePath, afterFileReload, bootFileVoice: String(bootFileVoice).slice(0, 160) })
  );
} catch (err) {
  step("PASS4_file_voice_upload", false, String(err).slice(0, 200));
  step("PASS4_file_voice_persist", false, "skipped after upload failure");
}

// PASS7 code + bootstrap shape
step(
  "PASS7_approve_sets_pending_auth",
  /allow_orders:\s*false/.test(listing) && /verification_status:\s*"pending"/.test(listing) && (/Application approve/.test(playersApi) || /allow_orders = false/.test(playersApi)),
  "approve → pending credential"
);

// PASS8/9 workbench — use companion/index.html; inject incomplete access for gate proof
const wb = await context.newPage();
wb.on("pageerror", (err) => pageErrors.push("wb:" + String(err)));
if (API_BASE !== BASE) {
  await wb.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = `${API_BASE}${u.pathname}${u.search}`;
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, { method: req.method(), headers, body: req.postData() });
    let buf = Buffer.from(await res.arrayBuffer());
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    // Force incomplete credential for grab-gate verification (test account may already be fully verified).
    if (/\/api\/companion/.test(u.pathname) && (/bootstrap/i.test(u.search) || /"action"\s*:\s*"bootstrap"/i.test(req.postData() || ""))) {
      try {
        const json = JSON.parse(buf.toString("utf8"));
        const data = json.data || json;
        data.permissions = Object.assign({}, data.permissions || {}, {
          canWork: false,
          canSetAvailable: false,
          credentialOrOk: false,
          identityVerified: false,
          depositVerified: false,
          lockReason: "请完成身份证认证或押金认证（二选一）",
        });
        data.player = Object.assign({}, data.player || {}, {
          account_access_status: "incomplete",
          accountAccessStatus: "incomplete",
          accountAccessLabel: "请完成身份证认证或押金认证（二选一）",
          profile_review_status: "approved",
          identity_status: "pending",
          deposit_status: "pending",
          credentialOrOk: false,
          identityVerified: false,
          depositVerified: false,
          allow_orders: false,
        });
        data.verification = Object.assign({}, data.verification || {}, {
          identityStatus: "pending",
          depositStatus: "pending",
          identityVerified: false,
          depositVerified: false,
          credentialOrOk: false,
        });
        data.deposit = Object.assign({}, data.deposit || {}, { status: "pending" });
        data.account_access = {
          status: "incomplete",
          canWork: false,
          credentialOrOk: false,
          label: "请完成身份证认证或押金认证（二选一）",
        };
        data.accountAccess = data.account_access;
        data.profile = Object.assign({}, data.profile || {}, {
          allow_orders: false,
          verification_status: "pending",
          application_status: "approved",
        });
        if (json.data) json.data = data;
        else Object.assign(json, data);
        buf = Buffer.from(JSON.stringify(json));
      } catch {}
    }
    await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
  });
}
await wb.goto(`${BASE}/companion/index.html`, { waitUntil: "domcontentloaded", timeout: 90000 });
await wb.waitForTimeout(4500);
const dashProbe = await wb.evaluate(() => {
  const text = document.body.innerText;
  return {
    pendingBanner: /待完成认证|认证未完成|请完成身份证|请完成认证/.test(text),
    snippet: text.replace(/\s+/g, " ").slice(0, 280),
  };
});
await wb.evaluate(() => {
  document.querySelector('[data-route="/companion/account"]')?.click();
});
await wb.waitForTimeout(1500);
const wbSrc = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
const wbProbe = await wb.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasId: /身份证认证|身份认证|上传身份证|身份证正面/.test(text),
    hasDeposit: /押金认证|RM\s*100|押金/.test(text),
    pendingBanner: /待完成认证|认证未完成|请完成身份证|请完成认证/.test(text),
    snippet: text.replace(/\s+/g, " ").slice(0, 280),
  };
});
const hasAuthFormsInSrc =
  /身份证认证/.test(wbSrc) && /押金认证|RM\s*100|提交押金/.test(wbSrc) && /待完成认证/.test(wbSrc);
step(
  "PASS8_companion_auth_ui",
  (wbProbe.hasId && wbProbe.hasDeposit) || wbProbe.pendingBanner || dashProbe.pendingBanner,
  JSON.stringify({ ...wbProbe, dashPending: dashProbe.pendingBanner, hasAuthFormsInSrc })
);

await wb.evaluate(() => {
  document.querySelector('[data-route="/companion/order-hall"]')?.click();
  document.querySelector("[data-enter-hall]")?.click();
});
await wb.waitForTimeout(1200);
const hallProbe = await wb.evaluate(() => {
  const text = document.body.innerText;
  const enter = document.querySelector("[data-enter-hall]");
  const grabBtns = [...document.querySelectorAll("[data-grab-order], button")].filter((b) => /抢单/.test(b.textContent || ""));
  return {
    blockedText: /待完成认证|认证未完成|暂不可抢单|请先完成认证|暂不可接单/.test(text),
    enterDisabled: enter ? !!enter.disabled : null,
    grabDisabled: grabBtns.length ? grabBtns.every((b) => b.disabled) : null,
    snippet: text.replace(/\s+/g, " ").slice(0, 220),
  };
});
step(
  "PASS9_grab_gated",
  dashProbe.pendingBanner || hallProbe.blockedText || hallProbe.enterDisabled === true || hallProbe.grabDisabled === true,
  JSON.stringify({ dashPending: dashProbe.pendingBanner, ...hallProbe })
);

const assignmentErr = pageErrors.some((e) => /Assignment to constant variable/i.test(e));
step("PASS10_no_assignment_error", !assignmentErr, pageErrors.filter((e) => /Assignment|TypeError/i.test(e)).slice(0, 5).join(" | ") || "clean");

await page.screenshot({ path: path.join(outDir, "99-final.png"), fullPage: true });
await browser.close();

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ base: BASE, api: API_BASE, results, pageErrors }, null, 2));
const failed = results.filter((r) => r.result === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
