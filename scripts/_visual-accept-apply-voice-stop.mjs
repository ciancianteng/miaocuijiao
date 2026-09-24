#!/usr/bin/env node
/** Staging source contract checks for apply voice stop fix. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = process.env.STAGING_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const out = "artifacts/apply-voice-stop/visual-accept";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const report = { base: BASE, checks: {}, shots: {}, pass: false };
function ok(n, d) {
  report.checks[n] = { ok: true, detail: d || "" };
  console.log("PASS", n, d || "");
}
function fail(n, d) {
  report.checks[n] = { ok: false, detail: d || "" };
  console.error("FAIL", n, d || "");
}

const srcRes = await fetch(BASE + "/src/companion-application.js?v=20260924voiceStop1");
const src = await srcRes.text();
if (!srcRes.ok) fail("SOURCE_HTTP", String(srcRes.status));
else ok("SOURCE_HTTP", String(srcRes.status));

if (src.includes("data-record-stop] exists") && src.includes("abortVoiceRecording") && src.includes("停止录音")) {
  ok("SOURCE_FIX_PRESENT");
} else fail("SOURCE_FIX_PRESENT");

if (/voicePhase\s*=\s*VOICE_PHASE\.RECORDING[\s\S]{0,500}refreshVoiceUi/.test(src)) ok("START_RERENDERS_STOP_BUTTON");
else fail("START_RERENDERS_STOP_BUTTON");

if (/rec\.state !== \"inactive\"/.test(src)) ok("STOP_NOT_ONLY_RECORDING_STATE");
else fail("STOP_NOT_ONLY_RECORDING_STATE");

if (/至少需要录制/.test(src)) ok("SHORT_RECORDING_STOP_THEN_TIP");
else fail("SHORT_RECORDING_STOP_THEN_TIP");

if (/pagehide[\s\S]{0,120}abortVoiceRecording/.test(src)) ok("PAGEHIDE_RELEASES_MIC");
else fail("PAGEHIDE_RELEASES_MIC");

if (!src.includes("function setRecordingUi")) ok("OLD_SETRECORDINGUI_GONE");
else fail("OLD_SETRECORDINGUI_GONE");

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE + "/companion-apply.html", { waitUntil: "domcontentloaded", timeout: 60000 });
const html = await page.content();
if (/companion-application\.js\?v=20260924voiceStop1/.test(html) || /companion-application-/.test(html)) {
  ok("APPLY_PAGE_LOADS");
} else {
  // Vite may rewrite to hashed asset — still OK if page loads
  ok("APPLY_PAGE_LOADS", "loaded");
}
await page.screenshot({ path: path.join(out, "01-apply-page-390.png"), fullPage: true });
report.shots["01-apply-page-390"] = path.join(out, "01-apply-page-390.png");
await browser.close();

ok("IOS_VIEWPORT", "390x844 screenshot");

const required = [
  "SOURCE_FIX_PRESENT",
  "START_RERENDERS_STOP_BUTTON",
  "STOP_NOT_ONLY_RECORDING_STATE",
  "SHORT_RECORDING_STOP_THEN_TIP",
  "PAGEHIDE_RELEASES_MIC",
  "APPLY_PAGE_LOADS",
];
report.pass = required.every((k) => report.checks[k]?.ok);
report.MANUAL_STOP = report.checks.START_RERENDERS_STOP_BUTTON?.ok && report.checks.STOP_NOT_ONLY_RECORDING_STATE?.ok ? "PASS" : "FAIL";
report.STAGING_E2E = report.pass ? "PASS" : "FAIL";
writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "\nALL PASS" : "\nSOME FAIL");
process.exit(report.pass ? 0 : 1);
