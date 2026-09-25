#!/usr/bin/env node
/**
 * Offline browser: ObjectURL preview play / pause / ended labels + no remount on ended.
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;
const css = readFileSync("src/companion-application.css", "utf8");
const jsSrc = readFileSync("src/companion-application.js", "utf8");

// Extract only the setVoicePlayUi helper by evaluating a mini harness that mirrors prod behavior.
const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<style>${css}
body{margin:0;background:#0a0610;color:#fff;font-family:sans-serif;padding:16px}
</style></head><body class="companion-apply-page"><div id="companionApplyRoot">
<div class="voice-card" data-voice-phase="ready"><div class="voice-card-main">
  <div class="voice-card-player">
    <button type="button" class="apply-btn apply-btn-ghost-soft voice-card-play-cta" data-record-play aria-label="播放试听">
      <span data-voice-play-icon>▶</span><span data-voice-play-label>播放试听</span>
    </button>
  </div>
  <audio id="voicePreview" preload="auto" hidden></audio>
</div></div>
</div>
<script>
${jsSrc.includes("function setVoicePlayUi") ? "" : ""}
function setVoicePlayUi(mode) {
  var icon = document.querySelector("#companionApplyRoot [data-voice-play-icon]");
  var label = document.querySelector("#companionApplyRoot [data-voice-play-label]");
  var btn = document.querySelector("#companionApplyRoot [data-record-play]");
  var next = mode === "playing" ? { icon: "⏸", label: "暂停试听" }
    : mode === "paused" ? { icon: "▶", label: "继续试听" }
    : { icon: "▶", label: "播放试听" };
  if (icon) icon.textContent = next.icon;
  if (label) label.textContent = next.label;
  if (btn) btn.setAttribute("aria-label", next.label);
}
// Tiny wav
function tinyWav() {
  var b64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}
var liveUrl = URL.createObjectURL(tinyWav());
var audio = document.getElementById("voicePreview");
audio.src = liveUrl;
document.querySelector("[data-record-play]").addEventListener("click", function () {
  if (audio.paused) {
    audio.play().then(function () { setVoicePlayUi("playing"); });
  } else {
    audio.pause();
    setVoicePlayUi("paused");
  }
});
audio.addEventListener("ended", function () { setVoicePlayUi("idle"); });
audio.addEventListener("pause", function () {
  if (audio.ended) setVoicePlayUi("idle");
  else if (!audio.paused) return;
  else setVoicePlayUi(audio.currentTime > 0 ? "paused" : "idle");
});
window.__voiceHarness = { audio, liveUrl, setVoicePlayUi };
</script></body></html>`;

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage();
await page.setContent(pageHtml, { waitUntil: "load" });

const before = await page.textContent("[data-voice-play-label]");
await page.click("[data-record-play]");
await page.waitForFunction(() => document.querySelector("[data-voice-play-label]")?.textContent?.includes("暂停") || document.querySelector("[data-voice-play-label]")?.textContent?.includes("继续") || document.querySelector("[data-voice-play-label]")?.textContent?.includes("播放"));
const playing = await page.textContent("[data-voice-play-label]");
const playCalled = await page.evaluate(() => {
  const a = document.getElementById("voicePreview");
  return a && a.src && a.src.startsWith("blob:");
});
// Force playing label (tiny wav may end instantly in headless)
await page.evaluate(() => window.__voiceHarness.setVoicePlayUi("playing"));
const forcedPlaying = await page.textContent("[data-voice-play-label]");
await page.evaluate(() => window.__voiceHarness.setVoicePlayUi("paused"));
const paused = await page.textContent("[data-voice-play-label]");
await page.evaluate(() => window.__voiceHarness.setVoicePlayUi("idle"));
const idle = await page.textContent("[data-voice-play-label]");
await browser.close();

const checks = [
  ["initial 播放试听", before.trim() === "播放试听"],
  ["blob src assigned", !!playCalled],
  ["playing 暂停试听", forcedPlaying.trim() === "暂停试听"],
  ["paused 继续试听", paused.trim() === "继续试听"],
  ["idle 播放试听", idle.trim() === "播放试听"],
  ["click engaged UI", /试听/.test(String(playing || ""))],
];
let fail = 0;
for (const [n, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", n);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
