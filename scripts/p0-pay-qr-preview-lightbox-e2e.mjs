/**
 * Local e2e: QR preview lightbox on payment-confirm + recharge markup.
 * Runs desktop + mobile viewports against the local Vite/dev server.
 *
 * Usage: BASE=http://127.0.0.1:5173 node scripts/p0-pay-qr-preview-lightbox-e2e.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, devices } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = String(process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");
const ART = path.join(ROOT, "artifacts", "pay-qr-preview-lightbox-e2e");
fs.mkdirSync(ART, { recursive: true });

const SAMPLE_QR =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <rect width="240" height="240" fill="#fff"/>
      <rect x="20" y="20" width="60" height="60" fill="#111"/>
      <rect x="160" y="20" width="60" height="60" fill="#111"/>
      <rect x="20" y="160" width="60" height="60" fill="#111"/>
      <rect x="100" y="100" width="40" height="40" fill="#111"/>
      <text x="120" y="230" text-anchor="middle" font-size="12">QR</text>
    </svg>`
  );

const results = [];
function step(name, pass, detail) {
  results.push({ name, result: pass ? "PASS" : "FAIL", detail: detail || "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function injectPayPage(page, label) {
  await page.goto(`${BASE}/payment-confirm.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.McjPayQrPreview, null, { timeout: 10000 });
  await page.evaluate((qr) => {
    const root = document.getElementById("paymentConfirmApp");
    root.innerHTML =
      '<section class="pay-card"><h1>支付确认（测试）</h1>' +
      '<div class="pay-qr" data-pay-qr data-pay-channel="duitnow">' +
      "<h2>DuitNow QR</h2>" +
      '<p class="pay-hint">请扫描下方收款二维码完成付款。</p>' +
      (window.McjPayQrPreview.frameHtml(qr, "DuitNow 收款二维码") || "") +
      '<div class="pay-qr-meta"><div class="pay-row"><span>收款人</span><strong>测试</strong></div></div>' +
      "</div>" +
      '<div class="pay-proof"><h2>上传付款截图</h2><button type="button" class="pay-btn" data-proof-pick="test">选择截图</button></div>' +
      "</section>";
  }, SAMPLE_QR);
  await page.waitForSelector("[data-pay-qr-zoom] img[data-mcj-pay-qr]", { timeout: 5000 });
  step(`${label}_module_loaded`, true, "McjPayQrPreview + QR frame");
}

async function runViewport(browser, name, viewport, isMobile) {
  const context = await browser.newContext({
    viewport,
    isMobile: !!isMobile,
    hasTouch: !!isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));

  try {
    await injectPayPage(page, name);

    const thumb = page.locator("[data-pay-qr-zoom], [data-mcj-pay-qr]").first();
    if (isMobile) {
      await thumb.tap();
    } else {
      await thumb.click();
    }
    await page.waitForTimeout(350);

    const openState = await page.evaluate(() => {
      const box = document.getElementById("payQrLightbox");
      const img = box && box.querySelector("[data-pay-qr-lightbox-img]");
      const close = box && box.querySelector("[data-pay-qr-close]");
      const ib = img && img.getBoundingClientRect();
      const vb = { w: window.innerWidth, h: window.innerHeight };
      return {
        apiOpen: !!(window.McjPayQrPreview && window.McjPayQrPreview.isOpen()),
        classOpen: !!(box && box.classList.contains("is-open")),
        hasClose: !!close,
        srcOk: !!(img && img.src && img.src.indexOf("data:image") === 0),
        w: ib ? Math.round(ib.width) : 0,
        h: ib ? Math.round(ib.height) : 0,
        clipped:
          ib &&
          (ib.left < -2 ||
            ib.top < -2 ||
            ib.right > vb.w + 2 ||
            ib.bottom > vb.h + 2),
        objectFit: img ? getComputedStyle(img).objectFit : "",
      };
    });
    await page.screenshot({ path: path.join(ART, `${name}-open.png`), fullPage: true });
    step(
      `${name}_open_enlarge`,
      openState.apiOpen &&
        openState.classOpen &&
        openState.hasClose &&
        openState.srcOk &&
        openState.w >= 180 &&
        openState.objectFit === "contain" &&
        !openState.clipped,
      JSON.stringify(openState)
    );

    // Close via close button
    if (isMobile) {
      await page.locator("[data-pay-qr-close]").tap();
    } else {
      await page.locator("[data-pay-qr-close]").click();
    }
    await page.waitForTimeout(250);
    const closed = await page.evaluate(() => {
      const box = document.getElementById("payQrLightbox");
      const stillPay = !!document.querySelector("[data-mcj-pay-qr], .pay-proof");
      return {
        open: !!(box && box.classList.contains("is-open")),
        apiOpen: !!(window.McjPayQrPreview && window.McjPayQrPreview.isOpen()),
        stillPay,
      };
    });
    await page.screenshot({ path: path.join(ART, `${name}-closed.png`), fullPage: true });
    step(`${name}_close_return`, !closed.open && !closed.apiOpen && closed.stillPay, JSON.stringify(closed));

    // Re-open and close via backdrop
    if (isMobile) await thumb.tap();
    else await thumb.click();
    await page.waitForTimeout(250);
    await page.locator("#payQrLightbox").click({ position: { x: 6, y: 6 }, force: true });
    await page.waitForTimeout(250);
    const closed2 = await page.evaluate(() => !(window.McjPayQrPreview && window.McjPayQrPreview.isOpen()));
    step(`${name}_backdrop_close`, closed2, "");

    // Bank-transfer style channel also uses same frameHtml
    await page.evaluate((qr) => {
      document.querySelector("[data-pay-qr]").setAttribute("data-pay-channel", "bank-my");
      document.querySelector(".pay-qr h2").textContent = "银行转账";
      const frame = document.querySelector("[data-pay-qr-zoom]");
      if (frame) frame.outerHTML = window.McjPayQrPreview.frameHtml(qr, "银行转账收款二维码");
    }, SAMPLE_QR);
    if (isMobile) await page.locator("[data-pay-qr-zoom]").first().tap();
    else await page.locator("[data-pay-qr-zoom]").first().click();
    await page.waitForTimeout(250);
    const bankOpen = await page.evaluate(() => !!(window.McjPayQrPreview && window.McjPayQrPreview.isOpen()));
    step(`${name}_bank_channel_open`, bankOpen, "");
    await page.evaluate(() => window.McjPayQrPreview && window.McjPayQrPreview.close());

    step(`${name}_no_pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "ok");
  } finally {
    await context.close();
  }
}

async function main() {
  // Smoke: assets reachable
  for (const p of ["/src/pay-qr-preview.js", "/src/pay-qr-preview.css", "/payment-confirm.html", "/recharge.html"]) {
    const res = await fetch(`${BASE}${p}`, { cache: "no-store" });
    step(`asset_${p.replace(/\W+/g, "_")}`, res.ok, `status=${res.status}`);
  }
  const payHtml = await fetch(`${BASE}/payment-confirm.html`, { cache: "no-store" }).then((r) => r.text());
  step("payment_confirm_includes_preview_js", /pay-qr-preview\.js/.test(payHtml), "");
  step("payment_confirm_includes_preview_css", /pay-qr-preview\.css/.test(payHtml), "");
  const rechHtml = await fetch(`${BASE}/recharge.html`, { cache: "no-store" }).then((r) => r.text());
  step("recharge_includes_preview_js", /pay-qr-preview\.js/.test(rechHtml), "");

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  await runViewport(browser, "pc", { width: 1280, height: 800 }, false);
  await runViewport(browser, "mobile", { width: 390, height: 844 }, true);

  await browser.close();

  const failed = results.filter((r) => r.result === "FAIL");
  const out = { overall: failed.length ? "FAIL" : "PASS", failed: failed.length, base: BASE, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  console.log("\nOVERALL", out.overall, "failed=", failed.length);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
