#!/usr/bin/env node
/**
 * Real-CSS visual states for voice play layout (390px).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = "artifacts/apply-voice-confirm";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;
const css = readFileSync("src/companion-application.css", "utf8");

function shell(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0610;color:#fff;font-family:"Segoe UI","PingFang SC",sans-serif}
#companionApplyRoot{padding:16px;max-width:390px;margin:0 auto}
${css}
</style></head><body class="companion-apply-page"><div id="companionApplyRoot">${inner}</div></body></html>`;
}

function voiceCard({ phase, timer, statusClass, statusText, playLabel, playIcon, actions }) {
  return `<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="${phase}">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong id="voiceState">${timer}</strong>
      ${phase === "recording" ? '<span class="voice-card-caption">录音中…</span>' : ""}
      </div>
      <span class="voice-card-status ${statusClass}">${statusText}</span>
    </div>
    ${
      phase === "recording"
        ? `<div class="voice-card-live"><span class="voice-card-live-dot"></span><strong>${timer}</strong><span>正在录音…</span></div>`
        : `<div class="voice-card-player" data-voice-player>
            <button type="button" class="apply-btn apply-btn-ghost-soft voice-card-play-cta" data-record-play aria-label="${playLabel}">
              <span data-voice-play-icon>${playIcon}</span><span data-voice-play-label>${playLabel}</span>
            </button>
          </div>`
    }
    <div class="voice-card-actions">${actions}</div>
  </div></div></div></section>`;
}

const states = {
  "01-recording": voiceCard({
    phase: "recording",
    timer: "00:06",
    statusClass: "is-live",
    statusText: "录音中",
    actions: '<button class="apply-btn primary" type="button">停止录音</button>',
  }),
  "01b-too-short": `<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="too_short">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong id="voiceState">00:06</strong>
      <span class="voice-card-caption">至少需要 10 秒</span>
      </div>
      <span class="voice-card-status is-warn">不足10秒</span>
    </div>
    <div class="voice-card-idle voice-card-too-short" role="alert"><p><strong>语音介绍至少需要录制 10 秒</strong></p><p>刚才录了 00:06，请重新录制。</p></div>
    <div class="voice-card-actions"><button class="apply-btn primary" type="button">重新录制</button></div>
    <div class="voice-card-quality"><span class="bad">语音介绍至少需要录制 10 秒</span></div>
  </div></div></div></section>`,
  "02-pending-confirm": voiceCard({
    phase: "ready",
    timer: "00:12",
    statusClass: "is-muted",
    statusText: "待确认",
    playIcon: "▶",
    playLabel: "播放试听",
    actions:
      '<button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>' +
      '<button class="apply-btn primary" type="button">确认录音</button>',
  }),
  "03-playing": voiceCard({
    phase: "ready",
    timer: "00:12",
    statusClass: "is-muted",
    statusText: "待确认",
    playIcon: "⏸",
    playLabel: "暂停试听",
    actions:
      '<button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>' +
      '<button class="apply-btn primary" type="button">确认录音</button>',
  }),
  "04-after-confirm": voiceCard({
    phase: "done",
    timer: "00:12",
    statusClass: "is-done",
    statusText: "已录制 ✓",
    playIcon: "▶",
    playLabel: "播放试听",
    actions: '<button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>',
  }),
};

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const report = { shots: {}, layout: {} };

for (const [name, html] of Object.entries(states)) {
  await page.setContent(shell(html), { waitUntil: "load" });
  const file = path.join(out, `${name}.png`);
  await page.locator("#applyVoicePanel").screenshot({ path: file });
  report.shots[name] = file;
  if (name === "02-pending-confirm" || name === "03-playing") {
    report.layout[name] = await page.evaluate(() => {
      const btn = document.querySelector("[data-record-play]");
      const label = document.querySelector("[data-voice-play-label]");
      const br = btn.getBoundingClientRect();
      const lr = label.getBoundingClientRect();
      return {
        btnW: Math.round(br.width),
        btnH: Math.round(br.height),
        labelW: Math.round(lr.width),
        labelH: Math.round(lr.height),
        text: label.textContent.trim(),
        whiteSpace: getComputedStyle(btn).whiteSpace,
        flexDir: getComputedStyle(btn).flexDirection,
      };
    });
  }
  console.log("shot", name);
}

await page.setContent(shell(states["02-pending-confirm"]), { waitUntil: "load" });
await page.screenshot({ path: path.join(out, "06-mobile.png"), fullPage: true });
report.shots["06-mobile"] = path.join(out, "06-mobile.png");

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#eee;font-family:"Segoe UI","PingFang SC",sans-serif;padding:24px}
.card{border:1px solid #333;border-radius:12px;padding:16px;max-width:420px;background:#1a1a1a}
.badge{color:#7dffa3;font-weight:800}
audio{width:100%;margin-top:12px}
</style></head><body>
<div class="card"><h2>后台审核 · 语音介绍</h2>
<p>状态：<span class="badge">已录制 ✓</span></p>
<p>播放控件（与申请页同一 voice_url）</p>
<audio controls id="adminVoice" src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="></audio>
<button id="playBtn" style="margin-top:12px;padding:8px 14px">▶ 播放</button>
</div></body></html>`);
await page.screenshot({ path: path.join(out, "05-admin-play.png") });
report.shots["05-admin-play"] = path.join(out, "05-admin-play.png");

await browser.close();
writeFileSync(path.join(out, "LAYOUT_REPORT.json"), JSON.stringify(report, null, 2));
console.log("DONE", JSON.stringify(report.layout));
const pending = report.layout["02-pending-confirm"];
if (!(pending && pending.btnW > 100 && pending.btnH < 56 && pending.labelH < 28 && pending.whiteSpace === "nowrap")) {
  console.error("FAIL layout metrics", pending);
  process.exit(1);
}
console.log("PASS layout metrics");
