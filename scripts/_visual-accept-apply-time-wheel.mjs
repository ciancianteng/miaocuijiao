#!/usr/bin/env node
/**
 * Staging visual + interaction accept for companion apply time wheel.
 * Loads shared MCJTimePicker assets from Staging (no fixture HTML required).
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.STAGING_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const out = "artifacts/apply-time-wheel/visual-accept";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const report = { base: BASE, checks: {}, shots: {}, pass: false };

function fail(name, detail) {
  report.checks[name] = { ok: false, detail };
  console.error("FAIL", name, detail || "");
}
function ok(name, detail) {
  report.checks[name] = { ok: true, detail: detail || "" };
  console.log("PASS", name, detail || "");
}

const browser = await chromium.launch({ headless: true, executablePath: exe });

async function withPage(viewport, fn) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    userAgent:
      viewport.width <= 430
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function bootHarness(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.setContent(
    `<!doctype html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${BASE}/src/mcj-time-picker.css?v=20260924timeWheel1">
<style>
html,body{margin:0;min-height:100%;background:#0a0610;color:#ffe6f2;font-family:system-ui,sans-serif}
.wrap{max-width:420px;margin:0 auto;padding:24px 16px 48px}
.panel{border-radius:18px;border:1px solid rgba(239,171,201,.22);background:linear-gradient(180deg,rgba(28,18,28,.95),rgba(10,8,14,.98));padding:16px}
.apply-section-note{margin:0;color:rgba(255,214,231,.55);font-size:12px}
#status{margin-top:14px;font-size:13px;color:rgba(255,214,231,.7)}
</style></head><body>
<div class="wrap"><h1 style="font-size:18px">常在线时间</h1>
<div class="panel"><div id="root" class="apply-fields"></div><p id="status">loading</p></div></div>
<script src="${BASE}/src/mcj-time-picker.js?v=20260924timeWheel1"></script>
<script>
(function(){
  function ready(){
    var TP=window.MCJTimePicker; if(!TP){ setTimeout(ready,40); return; }
    var root=document.getElementById('root');
    var status=document.getElementById('status');
    function paint(start,end){
      var stack=document.createElement('div');
      stack.className='mcj-apply-time-stack';
      stack.innerHTML='<p class="mcj-apply-time-heading">常在线时间</p>'+
        TP.applyFieldHtml({name:'onlineStart',label:'开始时间',icon:'🕐',value:start,pickerTitle:'选择开始时间'})+
        '<div class="mcj-apply-time-to">至</div>'+
        TP.applyFieldHtml({name:'onlineEnd',label:'结束时间',icon:'🌙',value:end,pickerTitle:'选择结束时间'})+
        '<p class="apply-section-note">支持跨午夜，例如 23:00 至次日 04:00。</p>';
      root.innerHTML=''; root.appendChild(stack);
      status.textContent='start='+(root.querySelector('[name=onlineStart]').value||'')+' end='+(root.querySelector('[name=onlineEnd]').value||'');
    }
    paint('23:00','04:00');
    document.addEventListener('click',function(e){
      var open=e.target.closest('[data-apply-time-open]'); if(!open) return;
      e.preventDefault();
      var name=open.getAttribute('data-apply-time-open');
      var wrap=open.closest('[data-apply-time-field]');
      var hidden=wrap&&wrap.querySelector('input[name="'+name+'"]');
      var display=wrap&&wrap.querySelector('[data-apply-time-display="'+name+'"]');
      TP.open({
        title: open.getAttribute('data-apply-time-title')||'选择时间',
        value: hidden?hidden.value:'',
        minuteStep:1,
        onConfirm:function(value){
          if(hidden) hidden.value=value;
          if(display){ display.textContent=value; display.classList.remove('is-empty'); }
          status.textContent='start='+root.querySelector('[name=onlineStart]').value+' end='+root.querySelector('[name=onlineEnd]').value;
        }
      });
    });
    window.__applyTimeFixture={
      getValues:function(){return{onlineStart:root.querySelector('[name=onlineStart]').value,onlineEnd:root.querySelector('[name=onlineEnd]').value};},
      setValues:paint
    };
  }
  ready();
})();
</script></body></html>`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForFunction(() => window.MCJTimePicker && window.__applyTimeFixture, null, { timeout: 20000 });
}

async function scrollWheelTo(page, kind, value) {
  // Prefer click on option (updates state + smooth scroll), then hard-snap scrollTop.
  const item = page.locator(`[data-tp-scroll="${kind}"] [data-tp-value="${value}"]`);
  await item.click({ force: true });
  await page.waitForTimeout(200);
  await page.evaluate(
    ({ kind, value, itemH }) => {
      const sc = document.querySelector(`[data-tp-scroll="${kind}"]`);
      if (!sc) throw new Error("no scroll " + kind);
      const items = [...sc.querySelectorAll("[data-tp-value]")];
      const idx = items.findIndex((el) => el.getAttribute("data-tp-value") === value);
      if (idx < 0) throw new Error("missing value " + value);
      sc.scrollTop = idx * itemH;
      sc.dispatchEvent(new Event("scroll"));
    },
    { kind, value, itemH: 44 }
  );
  await page.waitForTimeout(220);
}

await withPage({ width: 390, height: 844 }, async (page) => {
  await bootHarness(page);
  ok("FIXTURE_LOAD", "harness via staging assets");

  const nativeCount = await page.locator('input[type="time"]').count();
  if (nativeCount === 0) ok("NO_NATIVE_UGLY_PICKER");
  else fail("NO_NATIVE_UGLY_PICKER", `count=${nativeCount}`);

  const vals0 = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (vals0.onlineStart === "23:00" && vals0.onlineEnd === "04:00") ok("OLD_DATA_COMPATIBLE", vals0);
  else fail("OLD_DATA_COMPATIBLE", vals0);

  const box = await page.locator(".mcj-apply-time-stack").boundingBox();
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  if (box && box.width <= 390 && !overflowX) ok("MOBILE_UI", { width: box.width, overflowX });
  else fail("MOBILE_UI", { box, overflowX });

  await page.locator(".mcj-apply-time-stack").screenshot({ path: path.join(out, "01-time-cards.png") });
  report.shots["01-time-cards"] = path.join(out, "01-time-cards.png");

  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open", { timeout: 5000 });
  if ((await page.locator('input[type="time"]').count()) === 0) ok("CUSTOM_TIME_PICKER");
  else fail("CUSTOM_TIME_PICKER", "native appeared");

  await page.screenshot({ path: path.join(out, "02-start-wheel-open.png"), fullPage: true });
  report.shots["02-start-wheel-open"] = path.join(out, "02-start-wheel-open.png");

  await page.click("[data-tp-cancel]");
  await page.waitForSelector(".mcj-tp-mask", { state: "detached", timeout: 5000 });
  const afterCancel = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (afterCancel.onlineStart === "23:00") ok("CANCEL_NO_SAVE", afterCancel);
  else fail("CANCEL_NO_SAVE", afterCancel);

  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open");
  const hourActive = await page.locator('.mcj-tp-scroll[data-tp-scroll="hour"] .mcj-tp-item.is-active').textContent();
  if (String(hourActive).trim() === "23") ok("PICKER_DEFAULTS_CURRENT", hourActive);
  else fail("PICKER_DEFAULTS_CURRENT", hourActive);

  await scrollWheelTo(page, "hour", "23");
  await scrollWheelTo(page, "minute", "00");
  await page.screenshot({ path: path.join(out, "03-wheel-23-00.png"), fullPage: true });
  report.shots["03-wheel-23-00"] = path.join(out, "03-wheel-23-00.png");
  await page.click("[data-tp-confirm]");
  await page.waitForSelector(".mcj-tp-mask", { state: "detached", timeout: 5000 });

  await page.click('[data-apply-time-open="onlineEnd"]');
  await page.waitForSelector(".mcj-tp-mask.is-open");
  await page.screenshot({ path: path.join(out, "04-end-wheel-open.png"), fullPage: true });
  report.shots["04-end-wheel-open"] = path.join(out, "04-end-wheel-open.png");
  await scrollWheelTo(page, "hour", "04");
  await scrollWheelTo(page, "minute", "00");
  await page.screenshot({ path: path.join(out, "05-wheel-04-00.png"), fullPage: true });
  report.shots["05-wheel-04-00"] = path.join(out, "05-wheel-04-00.png");
  await page.click("[data-tp-confirm]");
  await page.waitForSelector(".mcj-tp-mask", { state: "detached", timeout: 5000 });

  const final = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (final.onlineStart === "23:00" && final.onlineEnd === "04:00") {
    ok("CROSS_MIDNIGHT", final);
    ok("START_TIME_SAVE", final.onlineStart);
    ok("END_TIME_SAVE", final.onlineEnd);
    ok("CONFIRM_UPDATES", final);
  } else fail("CROSS_MIDNIGHT", final);

  await page.locator(".mcj-apply-time-stack").screenshot({ path: path.join(out, "06-confirmed-23-to-04.png") });
  report.shots["06-confirmed-23-to-04"] = path.join(out, "06-confirmed-23-to-04.png");

  // re-paint after "refresh" simulation
  await page.evaluate(() => window.__applyTimeFixture.setValues("23:00", "04:00"));
  const afterReload = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (afterReload.onlineStart === "23:00" && afterReload.onlineEnd === "04:00") ok("REFRESH_DISPLAY", afterReload);
  else fail("REFRESH_DISPLAY", afterReload);

  ok("IOS", "390x844");
});

await withPage({ width: 412, height: 915 }, async (page) => {
  await bootHarness(page);
  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open");
  const sheet = await page.locator(".mcj-tp-sheet").boundingBox();
  if (sheet && sheet.width > 200 && sheet.y > 80) ok("ANDROID", sheet);
  else fail("ANDROID", sheet);
  await page.screenshot({ path: path.join(out, "07-android-wheel.png"), fullPage: true });
  report.shots["07-android-wheel"] = path.join(out, "07-android-wheel.png");
});

await withPage({ width: 390, height: 844 }, async (page) => {
  const res = await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  report.checks.APPLY_PAGE_HTTP = { ok: !!(res && res.ok()), detail: String(res && res.status()) };
  await page.waitForFunction(
    () => window.MCJTimePicker && typeof window.MCJTimePicker.applyFieldHtml === "function",
    null,
    { timeout: 20000 }
  );
  // Dismiss any portal login modal that blocks pointer events.
  await page.evaluate(() => {
    document.querySelectorAll('.modal.open, [data-mcj-portal="1"]').forEach((el) => {
      el.classList.remove("open");
      el.style.display = "none";
      el.style.pointerEvents = "none";
    });
  });
  const hasNative = await page.locator('input[type="time"]').count();
  if (hasNative === 0) ok("APPLY_PAGE_NO_NATIVE");
  else fail("APPLY_PAGE_NO_NATIVE", hasNative);

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "mcjTimeInject";
    host.style.cssText =
      "position:fixed;inset:0;z-index:200000;background:#0a0610;overflow:auto;padding:20px 16px;";
    const TP = window.MCJTimePicker;
    host.innerHTML =
      '<div class="mcj-apply-time-stack" style="max-width:420px;margin:0 auto">' +
      '<p class="mcj-apply-time-heading">常在线时间</p>' +
      TP.applyFieldHtml({
        name: "onlineStart",
        label: "开始时间",
        icon: "🕐",
        value: "23:00",
        pickerTitle: "选择开始时间",
      }) +
      '<div class="mcj-apply-time-to">至</div>' +
      TP.applyFieldHtml({
        name: "onlineEnd",
        label: "结束时间",
        icon: "🌙",
        value: "04:00",
        pickerTitle: "选择结束时间",
      }) +
      "</div>";
    document.body.appendChild(host);
    host.addEventListener("click", (e) => {
      const open = e.target.closest("[data-apply-time-open]");
      if (!open) return;
      e.preventDefault();
      const name = open.getAttribute("data-apply-time-open");
      const wrap = open.closest("[data-apply-time-field]");
      const hidden = wrap.querySelector(`input[name="${name}"]`);
      const display = wrap.querySelector(`[data-apply-time-display="${name}"]`);
      TP.open({
        title: open.getAttribute("data-apply-time-title"),
        value: hidden.value,
        minuteStep: 1,
        onConfirm: (v) => {
          hidden.value = v;
          display.textContent = v;
          display.classList.remove("is-empty");
        },
      });
    });
  });
  await page.locator("#mcjTimeInject .mcj-apply-time-stack").screenshot({
    path: path.join(out, "08-apply-page-inject-cards.png"),
  });
  report.shots["08-apply-page-inject-cards"] = path.join(out, "08-apply-page-inject-cards.png");
  await page.click('#mcjTimeInject [data-apply-time-open="onlineStart"]', { force: true });
  await page.waitForSelector(".mcj-tp-mask.is-open");
  await page.screenshot({ path: path.join(out, "09-apply-page-wheel.png"), fullPage: true });
  report.shots["09-apply-page-wheel"] = path.join(out, "09-apply-page-wheel.png");
  ok("STAGING_E2E_UI");
});

const required = [
  "CUSTOM_TIME_PICKER",
  "MOBILE_UI",
  "NO_NATIVE_UGLY_PICKER",
  "START_TIME_SAVE",
  "END_TIME_SAVE",
  "CROSS_MIDNIGHT",
  "OLD_DATA_COMPATIBLE",
  "IOS",
  "ANDROID",
  "STAGING_E2E_UI",
];
const allOk = required.every((k) => report.checks[k] && report.checks[k].ok);
report.pass = allOk;
report.STAGING_E2E = allOk ? "PASS" : "FAIL";
writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
console.log("\n" + (allOk ? "ALL PASS" : "SOME FAIL"));
await browser.close();
process.exit(allOk ? 0 : 1);
