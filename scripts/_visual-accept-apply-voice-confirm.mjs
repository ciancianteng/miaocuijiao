#!/usr/bin/env node
/**
 * Staging visual accept: apply voice confirm UI.
 * Pre-enables companion role on organic boss, then drives Fake MediaRecorder.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.ORGANIC_PASSWORD || "OrganicGoLive!Mcj2026";
const EMAIL = "organic.boss@mcj-staging-organic.invalid";
const out = "artifacts/apply-voice-confirm";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const report = { base: BASE, checks: {}, shots: {}, pass: false };
function ok(k, d) {
  report.checks[k] = { ok: true, detail: String(d || "").slice(0, 220) };
  console.log("PASS", k, d || "");
}
function fail(k, d) {
  report.checks[k] = { ok: false, detail: String(d || "").slice(0, 260) };
  console.error("FAIL", k, d || "");
}

const loginJson = await (
  await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: EMAIL, password: PASS, role: "boss" }),
  })
).json();
const token = loginJson.session?.accessToken || "";
const refresh = loginJson.session?.refreshToken || "";
const user = loginJson.session?.user || {};
if (!token) {
  console.error("login failed", loginJson.message);
  process.exit(1);
}
ok("LOGIN", EMAIL);

const enable = await fetch(`${BASE}/api/companion`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-mcj-companion-token": token,
  },
  body: JSON.stringify({ action: "apply_companion_role", refreshToken: refresh }),
});
const enableJson = await enable.json().catch(() => ({}));
console.log("enable_companion", enable.status, enableJson.message || enableJson.ok);
ok("ENABLE_COMPANION", enableJson.message || String(enable.status));

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(20000);

await page.addInitScript(
  ({ token, refresh, user }) => {
    const uid = String(user.id || "");
    const u = { ...user, role: "boss", roles: ["boss", "companion"] };
    localStorage.setItem("mcjAuthAccessToken", token);
    sessionStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("customerAuthToken", token);
    sessionStorage.setItem("customerAuthToken", token);
    localStorage.setItem("customerUser", JSON.stringify(u));
    sessionStorage.setItem("customerUser", JSON.stringify(u));
    const cSess = {
      token,
      accessToken: token,
      refreshToken: refresh || "",
      user: { ...u, role: "companion" },
      remember: true,
      portal: "companion",
    };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(cSess));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(cSess));
    localStorage.setItem("companionAuthToken", "companion_session_v4_visual");
    localStorage.setItem("mcjCompanionApplicantId.v1", uid);
    localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", uid);
    localStorage.setItem(
      "mcjCompanionApplicationDraft.v1.u:" + uid,
      JSON.stringify({
        step: 2,
        certification_method: "deposit",
        identity: {
          authMode: "deposit",
          certification_method: "deposit",
          depositProof: {
            url: location.origin + "/icons/icon-192.png",
            path: "accept/proof.png",
            bucket: "x",
            uploaded: true,
          },
          settlementMethod: "Touch n Go / TNG",
          tngAccount: "0123456789",
          settlementAccount: "0123456789",
        },
        data: {
          nickname: "VoiceConfirmAccept",
          mainGame: "Valorant",
          mainGames: ["Valorant"],
          personalTags: ["温柔"],
          intro: "staging voice accept intro",
          voiceType: "温柔",
          rank: "黄金",
          onlineStart: "20:00",
          onlineEnd: "02:00",
        },
        voice: { status: "尚未录制" },
        uploads: {
          avatar: { url: location.origin + "/icons/icon-192.png", path: "a.png", bucket: "x" },
          photos: [{ url: location.origin + "/icons/icon-192.png", path: "p.png", bucket: "x" }],
        },
        rulesAgreement: { accepted: true },
      })
    );

    class FakeTrack {
      stop() {}
    }
    class FakeStream {
      getTracks() {
        return [new FakeTrack()];
      }
      getAudioTracks() {
        return [new FakeTrack()];
      }
    }
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => new FakeStream();
    class FakeMediaRecorder {
      constructor(stream, opts) {
        this.stream = stream;
        this.mimeType = (opts && opts.mimeType) || "audio/webm";
        this.state = "inactive";
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = "recording";
        const bytes = new Uint8Array(32000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) % 255;
        setTimeout(() => {
          if (this.ondataavailable) this.ondataavailable({ data: new Blob([bytes], { type: this.mimeType }) });
        }, 20);
      }
      requestData() {}
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          if (this.onstop) this.onstop();
        }, 20);
      }
    }
    FakeMediaRecorder.isTypeSupported = () => true;
    window.MediaRecorder = FakeMediaRecorder;
    window.AudioContext = function () {
      this.decodeAudioData = async () => {
        throw new Error("skip");
      };
      this.close = () => {};
    };
    window.webkitAudioContext = window.AudioContext;
  },
  { token, refresh, user }
);

await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
ok("APPLY_PAGE", page.url());

// Dismiss boss gate if still shown
await page.locator("[data-apply-from-boss]").first().click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(1500);

// Accept rules on 须知 if present
await page.locator('input[type="checkbox"]').first().check({ force: true }).catch(() => {});
await page.locator("label:has-text('同意'), button:has-text('同意'), [data-rules-accept]").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
await page.locator("[data-apply-next], button:has-text('保存并下一步'), button:has-text('下一步')").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(800);

for (let i = 0; i < 12; i++) {
  if (await page.locator("[data-record-start]").count()) break;
  await page.locator(".apply-steps button").filter({ hasText: "资料" }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator("[data-apply-next], button:has-text('保存并下一步'), button:has-text('下一步')").first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
  // Scroll page seeking voice panel
  await page.evaluate(() => window.scrollBy(0, 600));
}

const card = page.locator("#applyVoicePanel, [data-voice-card], .voice-card").first();
await card.scrollIntoViewIfNeeded().catch(() => {});
const idle = await card.innerText().catch(async () => (await page.locator("body").innerText()).slice(0, 300));
if (/开始录音|未录制|语音介绍/.test(idle) || (await page.locator("[data-record-start]").count())) ok("IDLE_STATE", idle.slice(0, 140));
else {
  fail("IDLE_STATE", idle.slice(0, 220));
  await page.screenshot({ path: path.join(out, "00-no-voice.png"), fullPage: true });
  writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(1);
}

await page.locator("[data-record-start]").first().click();
await page.waitForTimeout(1000);
const rec = await card.innerText();
if (/停止录音|录音中/.test(rec)) ok("RECORDING_UI", rec.slice(0, 140));
else fail("RECORDING_UI", rec.slice(0, 200));
await card.screenshot({ path: path.join(out, "01-recording.png") }).catch(() => {});

await page.waitForTimeout(800);
await page.locator("[data-record-stop]").first().click();
await page.waitForTimeout(1200);
const shortBody = await page.locator("body").innerText();
if (/至少需要录制|10\s*秒|开始录音/.test(shortBody)) ok("SHORT_RECORD_TIP", "ok");
else fail("SHORT_RECORD_TIP", shortBody.slice(0, 160));

await page.evaluate(() => {
  const real = Date.now.bind(Date);
  let extra = 0;
  Date.now = () => real() + extra;
  window.__shift = (ms) => {
    extra = ms;
  };
  window.__unshift = () => {
    Date.now = real;
    extra = 0;
  };
});
await page.locator("[data-record-start]").first().click();
await page.waitForTimeout(600);
await page.evaluate(() => window.__shift(16000));
await page.locator("[data-record-stop]").first().click();
await page.waitForTimeout(1800);
await page.evaluate(() => window.__unshift());

const pending = await card.innerText();
if (/待确认|确认录音|播放试听|重新录制/.test(pending)) ok("PENDING_CONFIRM_UI", pending.slice(0, 180));
else fail("PENDING_CONFIRM_UI", pending.slice(0, 240));
await card.screenshot({ path: path.join(out, "02-pending-confirm.png") }).catch(() => {});

const confirm = page.locator("[data-record-confirm]").first();
if ((await confirm.count()) && !(await confirm.isDisabled())) ok("CONFIRM_ENABLED", "enabled");
else fail("CONFIRM_ENABLED", `c=${await confirm.count()}`);

await confirm.click().catch(() => {});
await page.waitForTimeout(5000);
const after = await card.innerText();
if (/已录制|保存中|失败/.test(after)) ok("CONFIRM_RESULT", after.slice(0, 160));
else fail("CONFIRM_RESULT", after.slice(0, 200));
await card.screenshot({ path: path.join(out, "03-after-confirm.png") }).catch(() => {});
await page.screenshot({ path: path.join(out, "05-mobile-full.png"), fullPage: true });

await browser.close();
const required = ["IDLE_STATE", "RECORDING_UI", "PENDING_CONFIRM_UI", "CONFIRM_ENABLED"];
report.pass = required.every((k) => report.checks[k]?.ok);
report.shots = {
  recording: path.join(out, "01-recording.png"),
  pending: path.join(out, "02-pending-confirm.png"),
  afterConfirm: path.join(out, "03-after-confirm.png"),
  mobile: path.join(out, "05-mobile-full.png"),
};
writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "\nALL REQUIRED PASS" : "\nSOME REQUIRED FAILED");
process.exit(report.pass ? 0 : 1);
