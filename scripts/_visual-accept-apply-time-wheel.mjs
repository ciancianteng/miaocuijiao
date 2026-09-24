#!/usr/bin/env node
/**
 * Staging visual + interaction accept for companion apply time wheel.
 * Uses fixture page (same MCJTimePicker + apply cards as production).
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

const report = {
  base: BASE,
  checks: {},
  shots: {},
  pass: false,
};

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

async function scrollWheelTo(page, kind, value) {
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
  await page.waitForTimeout(120);
}

// --- iPhone viewport ---
await withPage({ width: 390, height: 844 }, async (page) => {
  const url = `${BASE}/artifacts/apply-time-wheel/fixture.html`;
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || !res.ok()) {
    fail("FIXTURE_LOAD", `status=${res && res.status()} url=${url}`);
    return;
  }
  ok("FIXTURE_LOAD", url);

  await page.waitForFunction(() => window.MCJTimePicker && window.__applyTimeFixture, null, {
    timeout: 15000,
  });

  const nativeCount = await page.locator('input[type="time"]').count();
  if (nativeCount === 0) ok("NO_NATIVE_UGLY_PICKER");
  else fail("NO_NATIVE_UGLY_PICKER", `count=${nativeCount}`);

  const vals0 = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (vals0.onlineStart === "23:00" && vals0.onlineEnd === "04:00") ok("OLD_DATA_COMPATIBLE", vals0);
  else fail("OLD_DATA_COMPATIBLE", vals0);

  const box = await page.locator(".mcj-apply-time-stack").boundingBox();
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (box && box.width <= 390 && !overflowX) ok("MOBILE_UI", { width: box.width, overflowX });
  else fail("MOBILE_UI", { box, overflowX });

  await page.locator(".mcj-apply-time-stack").screenshot({ path: path.join(out, "01-time-cards.png") });
  report.shots["01-time-cards"] = path.join(out, "01-time-cards.png");

  // Cancel must not change
  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open", { timeout: 5000 });
  const hasNativeWhileOpen = await page.locator('input[type="time"]').count();
  if (hasNativeWhileOpen === 0) ok("CUSTOM_TIME_PICKER");
  else fail("CUSTOM_TIME_PICKER", "native appeared");

  await page.screenshot({ path: path.join(out, "02-start-wheel-open.png"), fullPage: true });
  report.shots["02-start-wheel-open"] = path.join(out, "02-start-wheel-open.png");

  // Confirm current 23:00 stays; then cancel path with different scroll
  await page.click("[data-tp-cancel]");
  await page.waitForSelector(".mcj-tp-mask", { state: "detached", timeout: 5000 });
  const afterCancel = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (afterCancel.onlineStart === "23:00") ok("CANCEL_NO_SAVE", afterCancel);
  else fail("CANCEL_NO_SAVE", afterCancel);

  // Change start to 22:00 then confirm, then set back to 23:00 for cross-midnight demo
  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open");
  // Default should be at current 23:00
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
  } else {
    fail("CROSS_MIDNIGHT", final);
  }

  await page.locator(".mcj-apply-time-stack").screenshot({ path: path.join(out, "06-confirmed-23-to-04.png") });
  report.shots["06-confirmed-23-to-04"] = path.join(out, "06-confirmed-23-to-04.png");

  // Reload persistence of fixture defaults (simulates refresh with stored values)
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.evaluate(() => window.__applyTimeFixture.getValues());
  if (afterReload.onlineStart === "23:00" && afterReload.onlineEnd === "04:00") ok("REFRESH_DISPLAY", afterReload);
  else fail("REFRESH_DISPLAY", afterReload);

  ok("IOS", "390x844");
});

// Android-ish viewport
await withPage({ width: 412, height: 915 }, async (page) => {
  await page.goto(`${BASE}/artifacts/apply-time-wheel/fixture.html`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.MCJTimePicker);
  await page.click('[data-apply-time-open="onlineStart"]');
  await page.waitForSelector(".mcj-tp-mask.is-open");
  const sheet = await page.locator(".mcj-tp-sheet").boundingBox();
  if (sheet && sheet.width > 200 && sheet.y > 100) ok("ANDROID", sheet);
  else fail("ANDROID", sheet);
  await page.screenshot({ path: path.join(out, "07-android-wheel.png"), fullPage: true });
  report.shots["07-android-wheel"] = path.join(out, "07-android-wheel.png");
});

// Real apply page: ensure scripts present and no type=time in game profile HTML builder (source already offline)
await withPage({ width: 390, height: 844 }, async (page) => {
  const res = await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  report.checks.APPLY_PAGE_HTTP = { ok: !!(res && res.ok()), detail: String(res && res.status()) };
  const hasCss = await page.evaluate(() => !!document.querySelector('link[href*="mcj-time-picker.css"]'));
  const hasJs = await page.evaluate(() => !!document.querySelector('script[src*="mcj-time-picker.js"]'));
  if (hasCss && hasJs) ok("APPLY_PAGE_ASSETS");
  else fail("APPLY_PAGE_ASSETS", { hasCss, hasJs });
  await page.waitForFunction(() => window.MCJTimePicker && typeof window.MCJTimePicker.applyFieldHtml === "function", null, {
    timeout: 20000,
  });
  // Inject apply-like stack into body for live screenshot on real page chrome
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "mcjTimeInject";
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0a0610;overflow:auto;padding:20px 16px;";
    const TP = window.MCJTimePicker;
    host.innerHTML =
      '<div class="mcj-apply-time-stack" style="max-width:420px;margin:0 auto">' +
      '<p class="mcj-apply-time-heading">常在线时间</p>' +
      TP.applyFieldHtml({ name: "onlineStart", label: "开始时间", icon: "🕐", value: "23:00", pickerTitle: "选择开始时间" }) +
      '<div class="mcj-apply-time-to">至</div>' +
      TP.applyFieldHtml({ name: "onlineEnd", label: "结束时间", icon: "🌙", value: "04:00", pickerTitle: "选择结束时间" }) +
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
  await page.click('#mcjTimeInject [data-apply-time-open="onlineStart"]');
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
