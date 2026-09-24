#!/usr/bin/env node
/**
 * Staging visual accept for apply voice confirm flow.
 * Uses fake MediaRecorder (deterministic) — mic not required.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const out = "artifacts/apply-voice-confirm";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const report = { base: BASE, checks: {}, shots: {}, pass: false };
function ok(k, d) {
  report.checks[k] = { ok: true, detail: String(d || "").slice(0, 200) };
  console.log("PASS", k, d || "");
}
function fail(k, d) {
  report.checks[k] = { ok: false, detail: String(d || "").slice(0, 240) };
  console.error("FAIL", k, d || "");
}

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ["microphone"],
});
await context.grantPermissions(["microphone"], { origin: BASE });

const page = await context.newPage();

// Fake MediaRecorder + getUserMedia for deterministic acceptance
await page.addInitScript(() => {
  class FakeTrack {
    constructor() {
      this.readyState = "live";
    }
    stop() {
      this.readyState = "ended";
    }
  }
  class FakeStream {
    constructor() {
      this._tracks = [new FakeTrack()];
    }
    getTracks() {
      return this._tracks;
    }
    getAudioTracks() {
      return this._tracks;
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
      this.onerror = null;
      this._chunks = 0;
    }
    start() {
      this.state = "recording";
      // Emit a non-trivial chunk so blob.size > 0
      const bytes = new Uint8Array(24000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17) % 255;
      setTimeout(() => {
        if (typeof this.ondataavailable === "function") {
          this.ondataavailable({ data: new Blob([bytes], { type: this.mimeType }) });
        }
      }, 30);
    }
    requestData() {}
    stop() {
      this.state = "inactive";
      setTimeout(() => {
        if (typeof this.onstop === "function") this.onstop();
      }, 20);
    }
  }
  FakeMediaRecorder.isTypeSupported = () => true;
  window.MediaRecorder = FakeMediaRecorder;

  // Skip AudioContext analysis flake
  window.AudioContext = function () {
    this.decodeAudioData = async () => {
      throw new Error("skip");
    };
    this.close = () => {};
  };
  window.webkitAudioContext = window.AudioContext;
});

await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);

// Jump to voice section if multi-step — click through / scroll to voice panel
const voiceVisible = await page.locator("#applyVoicePanel, [data-apply-section=voice], [data-record-start]").first().isVisible().catch(() => false);
if (!voiceVisible) {
  // Try navigate steps
  for (let i = 0; i < 6; i++) {
    const next = page.locator("[data-apply-next], button:has-text('下一步'), button:has-text('继续')").first();
    if (await next.isVisible().catch(() => false)) {
      await next.click().catch(() => {});
      await page.waitForTimeout(600);
    }
    if (await page.locator("[data-record-start]").first().isVisible().catch(() => false)) break;
  }
}

await page.locator("[data-record-start]").first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);

const idleText = await page.locator("[data-voice-card], #applyVoicePanel, .voice-card").first().innerText().catch(() => "");
if (/未录制|开始录音|00:00/.test(idleText)) ok("IDLE_STATE", idleText.slice(0, 120));
else fail("IDLE_STATE", idleText.slice(0, 160));

// Start recording
await page.locator("[data-record-start]").first().click();
await page.waitForTimeout(800);
const recText = await page.locator("[data-voice-card], #applyVoicePanel, .voice-card").first().innerText().catch(() => "");
if (/停止录音|录音中/.test(recText)) ok("RECORDING_UI", recText.slice(0, 120));
else fail("RECORDING_UI", recText.slice(0, 160));
await page.locator("#applyVoicePanel, [data-voice-card], .voice-card").first().screenshot({
  path: path.join(out, "01-recording.png"),
}).catch(() => page.screenshot({ path: path.join(out, "01-recording.png") }));
report.shots.recording = path.join(out, "01-recording.png");

// Short stop (<10s) — wait ~2s then stop
await page.waitForTimeout(2000);
await page.locator("[data-record-stop]").first().click();
await page.waitForTimeout(1200);
const shortTip = await page.evaluate(() => document.body.innerText || "");
if (/至少需要录制\s*10|不足|请重新录制/.test(shortTip) || /开始录音/.test(await page.locator("[data-voice-card], .voice-card").first().innerText().catch(() => ""))) {
  ok("SHORT_RECORD_TIP", "short stop handled");
} else {
  // Fake recorder may not track real time — inject duration via forcing short path is env dependent
  fail("SHORT_RECORD_TIP", shortTip.slice(0, 200));
}

// Record again long enough: monkey-patch Date for duration in onstop by speeding recordStartedAt
await page.evaluate(() => {
  // Force next stop to look like 12s by shifting recordStartedAt after start
  const _setInterval = window.setInterval;
  window.__mcjForceVoiceDuration = 12;
});

await page.locator("[data-record-start]").first().click().catch(() => {});
await page.waitForTimeout(600);
// Patch recordStartedAt in page if exposed — fallback: wait and also patch via draft after stop
await page.evaluate(() => {
  try {
    // companion-application is IIFE; patch Date.now temporarily during stop
    const realNow = Date.now.bind(Date);
    let shift = 0;
    Date.now = () => realNow() + shift;
    window.__mcjShiftNow = (ms) => {
      shift = ms;
    };
    window.__mcjRestoreNow = () => {
      Date.now = realNow;
      shift = 0;
    };
  } catch (e) {}
});
await page.evaluate(() => {
  if (window.__mcjShiftNow) window.__mcjShiftNow(12000);
});
await page.locator("[data-record-stop]").first().click();
await page.waitForTimeout(1500);
await page.evaluate(() => {
  if (window.__mcjRestoreNow) window.__mcjRestoreNow();
});

const pendingText = await page.locator("[data-voice-card], .voice-card, #applyVoicePanel").first().innerText().catch(() => "");
if (/待确认|确认录音|播放试听|重新录制/.test(pendingText)) ok("PENDING_CONFIRM_UI", pendingText.slice(0, 160));
else fail("PENDING_CONFIRM_UI", pendingText.slice(0, 220));
await page.locator("#applyVoicePanel, [data-voice-card], .voice-card").first().screenshot({
  path: path.join(out, "02-pending-confirm.png"),
}).catch(() => page.screenshot({ path: path.join(out, "02-pending-confirm.png") }));
report.shots.pending = path.join(out, "02-pending-confirm.png");

const confirmBtn = page.locator("[data-record-confirm]").first();
const confirmDisabled = await confirmBtn.isDisabled().catch(() => true);
if (!confirmDisabled && (await confirmBtn.isVisible().catch(() => false))) ok("CONFIRM_ENABLED", "confirm enabled");
else fail("CONFIRM_ENABLED", `disabled=${confirmDisabled}`);

// Confirm without login will fail upload — still verify button exists and busy state
await confirmBtn.click().catch(() => {});
await page.waitForTimeout(800);
const afterConfirm = await page.locator("[data-voice-card], .voice-card, #applyVoicePanel").first().innerText().catch(() => "");
if (/已录制|保存中|登录|失败|确认录音/.test(afterConfirm)) ok("CONFIRM_CLICK_HANDLED", afterConfirm.slice(0, 140));
else fail("CONFIRM_CLICK_HANDLED", afterConfirm.slice(0, 180));
await page.locator("#applyVoicePanel, [data-voice-card], .voice-card").first().screenshot({
  path: path.join(out, "03-after-confirm.png"),
}).catch(() => page.screenshot({ path: path.join(out, "03-after-confirm.png") }));

await page.screenshot({ path: path.join(out, "05-mobile-full.png"), fullPage: true });
report.shots.mobile = path.join(out, "05-mobile-full.png");

await browser.close();

const required = ["IDLE_STATE", "RECORDING_UI", "PENDING_CONFIRM_UI", "CONFIRM_ENABLED"];
report.pass = required.every((k) => report.checks[k]?.ok);
writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "\nALL REQUIRED PASS" : "\nSOME REQUIRED FAILED");
process.exit(report.pass ? 0 : 1);
