#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import path from "node:path";

const js = readFileSync("src/companion-application.js", "utf8");
const css = readFileSync("src/companion-application.css", "utf8");
const html = readFileSync("companion-apply.html", "utf8");

const checks = [
  ["play label span", js.includes("data-voice-play-label")],
  ["setVoicePlayUi", js.includes("function setVoicePlayUi")],
  ["暂停试听", js.includes("暂停试听")],
  ["继续试听", js.includes("继续试听")],
  ["播放试听", js.includes("播放试听")],
  ["markVoiceListenedQuiet", js.includes("function markVoiceListenedQuiet")],
  ["revoke after refreshVoiceUi", /refreshVoiceUi\(\);\s*liveVoiceBlob = null/.test(js)],
  ["prefer liveVoiceObjectUrl", /var playSrc =\s*\n\s*liveVoiceObjectUrl/.test(js)],
  ["no 40px player grid", !/voice-card-player\{[^}]*grid-template-columns:\s*40px/.test(css.replace(/\s+/g, ""))],
  ["play-cta nowrap", /voice-card-play-cta[\s\S]{0,500}white-space:\s*nowrap/.test(css)],
  ["play-cta row", /voice-card-play-cta[\s\S]{0,300}flex-direction:\s*row/.test(css)],
  ["cache bust", /voiceConfirmUx2/.test(html)],
];

let fail = 0;
for (const [n, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", n);
  if (!ok) fail++;
}

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : "";
if (!exe) {
  console.log("SKIP layout-browser");
  process.exit(fail ? 1 : 0);
}

mkdirSync("artifacts/apply-voice-confirm", { recursive: true });
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0610;color:#fff;font-family:"Segoe UI","PingFang SC",sans-serif}
#companionApplyRoot{padding:16px;max-width:390px}
${css}
</style></head><body class="companion-apply-page"><div id="companionApplyRoot">
<section class="apply-section apply-voice-card" id="applyVoicePanel">
  <div class="apply-section-head"><h3>语音介绍</h3>
  <p class="apply-section-hint">录一段简单的自我介绍 · 必填，同步后台审核</p></div>
  <div class="apply-section-body"><div class="voice-card" data-voice-phase="ready">
    <div class="voice-card-main"><div class="voice-card-row">
      <div class="voice-card-icon">🎙</div>
      <div class="voice-card-meta"><strong>00:12</strong></div>
      <span class="voice-card-status is-muted">待确认</span>
    </div>
    <div class="voice-card-player" data-voice-player>
      <button type="button" class="apply-btn apply-btn-ghost-soft voice-card-play-cta" data-record-play aria-label="播放试听">
        <span data-voice-play-icon>▶</span><span data-voice-play-label>播放试听</span>
      </button>
    </div>
    <div class="voice-card-actions">
      <button class="apply-btn apply-btn-ghost-soft" type="button">重新录制</button>
      <button class="apply-btn primary" type="button">确认录音</button>
    </div>
  </div></div></div>
</section>
</div></body></html>`;

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.setContent(fixture, { waitUntil: "load" });
const metrics = await page.evaluate(() => {
  const btn = document.querySelector("[data-record-play]");
  const label = document.querySelector("[data-voice-play-label]");
  const icon = document.querySelector("[data-voice-play-icon]");
  const br = btn.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  const cs = getComputedStyle(btn);
  return {
    btnW: br.width,
    btnH: br.height,
    labelW: lr.width,
    labelH: lr.height,
    whiteSpace: cs.whiteSpace,
    flexDir: cs.flexDirection,
    writingMode: cs.writingMode,
    text: (icon.textContent + label.textContent).replace(/\s+/g, ""),
  };
});
await page.locator("#applyVoicePanel").screenshot({
  path: path.join("artifacts/apply-voice-confirm", "02-pending-confirm.png"),
});
await browser.close();
console.log("METRICS", JSON.stringify(metrics));
const layoutOk =
  metrics.btnW > 100 &&
  metrics.btnH < 56 &&
  metrics.labelH < 28 &&
  metrics.labelW > 48 &&
  metrics.whiteSpace === "nowrap" &&
  metrics.flexDir === "row" &&
  metrics.text === "▶播放试听";
console.log(layoutOk ? "PASS" : "FAIL", "layout horizontal play CTA");
if (!layoutOk) fail++;
process.exit(fail ? 1 : 0);
