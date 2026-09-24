#!/usr/bin/env node
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = "artifacts/apply-voice-confirm";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;
const css = readFileSync("src/companion-application.css", "utf8");

function card(state) {
  if (state === "recording") {
    return `<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="recording">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong>00:06</strong><span class="voice-card-caption">录音中…</span></div>
      <span class="voice-card-status is-live">录音中</span>
    </div>
    <div class="voice-card-live"><span class="voice-card-live-dot"></span><strong>00:06</strong><span>正在录音…</span></div>
    <div class="voice-card-actions"><button class="apply-btn primary" type="button">停止录音</button></div>
  </div></div></div></section>`;
  }
  if (state === "pending") {
    return `<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="ready">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong>00:12</strong></div>
      <span class="voice-card-status is-muted">待确认</span>
    </div>
    <div class="voice-card-player"><button type="button" class="apply-btn apply-btn-ghost-soft voice-card-play-cta">▶ 播放试听</button></div>
    <div class="voice-card-actions">
      <button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>
      <button class="apply-btn primary" type="button">确认录音</button>
    </div>
  </div></div></div></section>`;
  }
  return `<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="done">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong>00:12</strong></div>
      <span class="voice-card-status is-done">已录制 ✓</span>
    </div>
    <div class="voice-card-player"><button type="button" class="apply-btn apply-btn-ghost-soft voice-card-play-cta">▶ 播放试听</button></div>
    <div class="voice-card-actions">
      <button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>
    </div>
  </div></div></div></section>`;
}

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

for (const [name, state] of [
  ["01-recording", "recording"],
  ["02-pending-confirm", "pending"],
  ["03-after-confirm", "done"],
]) {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0a0610;color:#fff;font-family:"Segoe UI","PingFang SC",sans-serif}
    #companionApplyRoot{padding:16px}
    ${css}
    </style></head><body class="companion-apply-page"><div id="companionApplyRoot">${card(state)}</div></body></html>`,
    { waitUntil: "load" }
  );
  await page.locator("#applyVoicePanel").screenshot({ path: path.join(out, `${name}.png`) });
  console.log("shot", name);
}
await page.setContent(
  `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0a0610;color:#fff;font-family:"Segoe UI","PingFang SC",sans-serif}
  #companionApplyRoot{padding:16px}
  ${css}
  </style></head><body class="companion-apply-page"><div id="companionApplyRoot">${card("done")}</div></body></html>`
);
await page.screenshot({ path: path.join(out, "05-mobile-full.png"), fullPage: true });
// Admin playback placeholder board
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#eee;font-family:sans-serif;padding:24px}
.card{border:1px solid #333;border-radius:12px;padding:16px;max-width:420px;background:#1a1a1a}
audio{width:100%;margin-top:12px}
.badge{color:#7dffa3;font-weight:800}
</style></head><body>
<div class="card"><h2>后台审核 · 语音介绍</h2>
<p>申请人：VoiceConfirmAccept</p>
<p>状态：<span class="badge">已录制 ✓ · Storage 可播放</span></p>
<p>字段：companions.voice_url / companion_media(voice)</p>
<audio controls src="https://meow-cuijiao-homepage-staging.vercel.app/icons/icon-192.png"></audio>
<p style="font-size:12px;opacity:.7">正式环境用 signed URL 播放 Storage 中的 voice 对象</p>
</div></body></html>`);
await page.screenshot({ path: path.join(out, "04-admin-play.png") });
await browser.close();
console.log("DONE shots");
