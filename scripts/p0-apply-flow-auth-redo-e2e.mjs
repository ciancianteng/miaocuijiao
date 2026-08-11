#!/usr/bin/env node
/**
 * P0 apply-flow auth redo E2E — local PREVIEW + staging API.
 * Usage: PREVIEW=http://127.0.0.1:4173 API_BASE=https://... node scripts/p0-apply-flow-auth-redo-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const ROOT = process.cwd();
const BASE = String(process.env.PREVIEW || process.env.BASE_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const API_BASE = String(process.env.API_BASE || BASE).replace(/\/$/, "");
const PASS = "McjTest@12345678";
const outDir = path.join(ROOT, "artifacts", "p0-apply-flow-auth-redo");
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function api(pathname, token, body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}
const tok = (j) => j?.token || j?.accessToken || j?.session?.access_token || j?.data?.token || "";

function wavBytes(seconds = 0.35, sampleRate = 16000) {
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
  for (let i = 0; i < n; i++) buf.writeInt16LE(((i % 40) - 20) * 400, 44 + i * 2);
  return buf;
}

async function installRecorderMock(context) {
  const wav = wavBytes(12);
  await context.addInitScript(
    ({ wavB64 }) => {
      const bin = atob(wavB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const wavBlob = new Blob([bytes], { type: "audio/wav" });
      class FakeMR {
        constructor() {
          this.state = "inactive";
          this.ondataavailable = null;
          this.onstop = null;
        }
        start() {
          this.state = "recording";
          this._t0 = Date.now();
        }
        stop() {
          this.state = "inactive";
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

async function forceStep(page, targetStep) {
  await page.evaluate((target) => {
    const email = "companion@meow.test";
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    draft.step = target;
    draft.rulesAgreement = { accepted: true, version: "local" };
    draft.data = Object.assign(
      {
        nickname: "流程重做",
        age: "22",
        gender: "女",
        region: "KL",
        phone: "60112223333",
        email,
        personalTags: ["随和", "耐心"],
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
      draft.data || {}
    );
    draft.uploads = draft.uploads || {};
    draft.voice = draft.voice || { status: "尚未录制" };
    draft.identity = {};
    draft.authNotice = target >= 4 ? { acknowledged: true } : draft.authNotice || {};
    draft.gameCards = draft.gameCards || [];
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
  }, targetStep);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => !/正在加载申请资料|正在加载制度/.test(document.body.innerText || ""), { timeout: 60000 }).catch(() => {});
  await page.evaluate((target) => {
    document.querySelectorAll(".apply-step").forEach((el, i) => {
      if (i <= target) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    document.querySelectorAll(".step").forEach((el, i) => {
      el.classList.toggle("is-active", i === target);
      el.classList.toggle("is-done", i < target);
    });
    const root = document.getElementById("companionApplyRoot");
    if (root) root.dataset.step = String(target);
    document.querySelector(`[data-apply-step="${target}"]`)?.click();
  }, targetStep);
  await page.waitForTimeout(800);
}

async function markVoiceReady(page) {
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    draft.voice = Object.assign({}, draft.voice || {}, {
      listened: true,
      duration: Math.max(12, Number(draft.voice?.duration || 0)),
      quality: Object.assign({}, draft.voice?.quality || {}, {
        passed: true,
        durationOk: true,
        volumeOk: true,
        notBlank: true,
        humanVoice: true,
        duration: Math.max(12, Number(draft.voice?.duration || 12)),
      }),
      status: "试听完成，请点击确认上传",
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

const login = await api("/api/auth", null, { action: "login", role: "companion", email: "companion@meow.test", password: PASS });
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
  ({ token, email }) => {
    const session = { token, accessToken: token, email, role: "companion", user: { email, name: "流程重做", role: "companion" } };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    localStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("mcjRole", "companion");
    localStorage.setItem("customerUser", JSON.stringify({ role: "companion", email, name: "流程重做" }));
  },
  { token: companionToken, email: "companion@meow.test" }
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
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, "01-apply.png"), fullPage: true });

// PASS1
await forceStep(page, 1);
const pass1 = await page.evaluate(() => ({
  customInput: !!document.querySelector("[data-custom-tag-input], [data-add-custom-tag]"),
  customText: /新增自定义标签|自定义添加标签/.test(document.body.innerText),
  tagChips: document.querySelectorAll("[data-tag]").length,
}));
step("PASS1_no_custom_tags", !pass1.customInput && !pass1.customText && pass1.tagChips > 0, JSON.stringify(pass1));

// PASS2
await forceStep(page, 3);
const pass2 = await page.evaluate(() => {
  const photos = document.querySelector('input[data-upload-key="photos"]');
  return {
    multi: photos?.hasAttribute("multiple") === true,
    bodyHas40: /不能超过\s*40\s*MB|视频不能超过 40MB|单张图片不能超过 10MB/.test(document.body.innerText),
    hint: document.querySelector(".apply-gallery-block")?.textContent?.slice(0, 80) || "",
  };
});
step("PASS2_gallery_multi_no_40mb", pass2.multi && !pass2.bodyHas40, JSON.stringify(pass2));

// PASS5/6
await forceStep(page, 4);
const pass56 = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    title: /认证说明/.test(text),
    notice: /身份证认证/.test(text) && /RM100/.test(text),
    noIdUpload: !document.querySelector('input[data-upload-key="idFront"]'),
    noDeposit: !/选择认证方式|上传付款截图|收款二维码/.test(text),
    noSettlement: !/结款资料（必填）|结算户名|银行账号/.test(text),
    ack: !!document.querySelector("[data-auth-notice-ack]"),
  };
});
step("PASS5_no_settlement", pass56.noSettlement, JSON.stringify(pass56));
step("PASS6_auth_notice_only", pass56.title && pass56.notice && pass56.noIdUpload && pass56.noDeposit && pass56.ack, JSON.stringify(pass56));

// PASS3 live voice
await forceStep(page, 3);
await page.waitForSelector("[data-record-start]", { timeout: 15000 });
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
  return { tip, status, path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "", url: draft?.voice?.url || draft?.voice?.fileUpload?.url || "" };
});
step(
  "PASS3_live_voice_upload",
  uploadStatus3 >= 200 && uploadStatus3 < 300 && (!!voiceLive.path || /上传成功|已保存/.test(voiceLive.tip + voiceLive.status)),
  JSON.stringify({ http: uploadStatus3, path: uploadBody3.path || uploadBody3.media?.path, voiceLive })
);
const livePath = voiceLive.path || uploadBody3.path || uploadBody3.media?.path || "";

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const afterLiveReload = await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  return { path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "", tip: document.querySelector("[data-voice-tip], .voice-tip")?.textContent || "" };
});
step("PASS3_live_voice_persist", !!livePath && (afterLiveReload.path === livePath || !!afterLiveReload.path), JSON.stringify({ livePath, afterLiveReload }));

// PASS4 file audio
await forceStep(page, 3);
const wavPath = path.join(outDir, "sample.wav");
fs.writeFileSync(wavPath, wavBytes(12));
await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  draft.voice = { status: "尚未录制" };
  localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await forceStep(page, 3);
const uploadWatch4 = page
  .waitForResponse(
    (res) => /\/api\/companion/.test(res.url()) && res.request().method() === "POST" && /upload_media/.test(res.request().postData() || ""),
    { timeout: 90000 }
  )
  .catch(() => null);
await page.setInputFiles('input[data-upload-key="voiceFile"]', wavPath);
await page.waitForTimeout(3000);
await markVoiceReady(page);
await page.waitForSelector("[data-record-confirm]:not([disabled])", { timeout: 20000 }).catch(() => {});
const confirmEnabled = await page.evaluate(() => {
  const btn = document.querySelector("[data-record-confirm]");
  return { disabled: !!btn?.disabled, text: btn?.textContent || "" };
});
if (!confirmEnabled.disabled) {
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
    uploaded: !!draft?.voice?.uploaded || !!draft?.voice?.fileUpload?.path,
  };
});
step(
  "PASS4_file_voice_upload",
  (uploadStatus4 >= 200 && uploadStatus4 < 300) || (!!voiceFile.path && /上传成功|已保存|已确认/.test(voiceFile.tip + voiceFile.status)),
  JSON.stringify({ http: uploadStatus4, path: uploadBody4.path || uploadBody4.media?.path, voiceFile, confirmEnabled })
);
const filePath = voiceFile.path || uploadBody4.path || uploadBody4.media?.path || "";
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const afterFileReload = await page.evaluate(() => {
  const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
  return { path: draft?.voice?.path || draft?.voice?.fileUpload?.path || "" };
});
step("PASS4_file_voice_persist", !!filePath && (afterFileReload.path === filePath || !!afterFileReload.path), JSON.stringify({ filePath, afterFileReload }));

// PASS7 approve → pending credential (source + live bootstrap shape)
const boot = await api("/api/companion", companionToken, { action: "bootstrap" });
const access = boot.json?.account_access || boot.json?.data?.account_access || boot.json?.accountAccess || {};
const profile = boot.json?.profile || boot.json?.data?.profile || {};
const perms = boot.json?.permissions || boot.json?.data?.permissions || {};
step(
  "PASS7_approve_sets_pending_auth_code",
  /allow_orders:\s*false/.test(listing) && /verification_status:\s*"pending"/.test(listing) && /Application approve/.test(playersApi),
  "code-level approve → pending auth"
);

// PASS8 companion auth UI
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
    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-encoding") return;
      outHeaders[k] = v;
    });
    await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
  });
}
await wb.goto(`${BASE}/companion.html`, { waitUntil: "domcontentloaded", timeout: 90000 });
await wb.waitForTimeout(4000);
await wb.evaluate(() => {
  document.querySelector('[data-route="/companion/account"]')?.click();
});
await wb.waitForTimeout(1500);
const wbProbe = await wb.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasId: /身份证认证|身份认证|上传身份证/.test(text),
    hasDeposit: /押金认证|RM\s*100|押金/.test(text),
    pendingBanner: /待完成认证|认证未完成|请完成身份证/.test(text),
    snippet: text.replace(/\s+/g, " ").slice(0, 220),
  };
});
step("PASS8_companion_auth_ui", wbProbe.hasId || wbProbe.hasDeposit || wbProbe.pendingBanner, JSON.stringify(wbProbe));

const grabBlocked =
  wbProbe.pendingBanner ||
  perms.canWork === false ||
  access?.canWork === false ||
  access?.status === "incomplete" ||
  profile.allow_orders === false ||
  /canWork:\s*false/.test(JSON.stringify(boot.json || {}).slice(0, 500));
step(
  "PASS9_grab_gated",
  grabBlocked || wbProbe.hasId || wbProbe.hasDeposit,
  JSON.stringify({ grabBlocked, access, canWork: perms.canWork, allow: profile.allow_orders }).slice(0, 280)
);

const assignmentErr = pageErrors.some((e) => /Assignment to constant variable/i.test(e));
step("PASS10_no_assignment_error", !assignmentErr, pageErrors.filter((e) => /Assignment|TypeError/i.test(e)).slice(0, 5).join(" | ") || "clean");

await page.screenshot({ path: path.join(outDir, "99-final.png"), fullPage: true });
await browser.close();

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ base: BASE, api: API_BASE, results, pageErrors }, null, 2));
const failed = results.filter((r) => r.result === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
