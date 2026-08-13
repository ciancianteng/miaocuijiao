/**
 * payment-confirm QR visibility + shared McjPayQrPreview lightbox.
 * Front-end only. Uses local static proxy (BASE) for HTML/JS + staging API.
 *
 * Usage: BASE=http://127.0.0.1:4177 node scripts/p0-pay-qr-confirm-zoom-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || process.env.PREVIEW || "http://127.0.0.1:4177").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "pay-qr-confirm-zoom");
const CHROME =
  process.env.CHROME_PATH ||
  "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail ?? "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function seedAuth(page, token, user) {
  await page.addInitScript(
    ({ token, user }) => {
      const raw = JSON.stringify({ accessToken: token, token, user });
      for (const k of [
        "mcjAuthAccessToken",
        "mcj_auth_access_token",
        "mcjBossAuthAccessToken",
        "mcjCustomerAuthAccessToken",
      ]) {
        try {
          localStorage.setItem(k, token);
          sessionStorage.setItem(k, token);
        } catch {}
      }
      try {
        localStorage.setItem("mcjAuthSession", raw);
        sessionStorage.setItem("mcjAuthSession", raw);
        localStorage.setItem("mcjBossSession", raw);
      } catch {}
    },
    { token, user }
  );
}

async function qrState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-pay-qr]");
    const img = document.querySelector(".pay-qr-frame img, [data-mcj-pay-qr], [data-pay-qr-img]");
    const zoom = document.querySelector("[data-pay-qr-zoom]");
    const lb = document.getElementById("payQrLightbox");
    const lbImg = lb && lb.querySelector("[data-pay-qr-lightbox-img]");
    const box = img ? img.getBoundingClientRect() : null;
    return {
      hasPreviewLib: typeof window.McjPayQrPreview === "object",
      hasQr: panel?.getAttribute("data-pay-has-qr") || "",
      mismatch: panel?.getAttribute("data-pay-qr-mismatch") || "",
      urlLen: panel?.getAttribute("data-pay-qr-url-len") || "",
      load: img?.getAttribute("data-pay-qr-load") || "",
      imgStatus: panel?.getAttribute("data-pay-qr-img-status") || "",
      src: img?.currentSrc || img?.src || "",
      natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      display: img ? getComputedStyle(img).display : "",
      visibility: img ? getComputedStyle(img).visibility : "",
      opacity: img ? getComputedStyle(img).opacity : "",
      cursor: zoom ? getComputedStyle(zoom).cursor : img ? getComputedStyle(img).cursor : "",
      y: box?.y ?? null,
      w: box?.width ?? 0,
      h: box?.height ?? 0,
      vh: window.innerHeight,
      inFirstViewport: !!(box && box.height > 0 && box.y >= 0 && box.y < window.innerHeight),
      lightboxOpen: !!(lb && lb.classList.contains("is-open") && !lb.hasAttribute("hidden")),
      lightboxW: lb ? lb.getBoundingClientRect().width : 0,
      lightboxImgW: lbImg ? lbImg.getBoundingClientRect().width : 0,
      lightboxSrc: lbImg?.currentSrc || lbImg?.src || "",
      errMsg: !!document.querySelector("[data-pay-qr-load-error]"),
    };
  });
}

async function openLightbox(page) {
  const zoom = page.locator("[data-pay-qr-zoom]").first();
  await zoom.scrollIntoViewIfNeeded();
  await zoom.click({ timeout: 8000 });
  await page.waitForTimeout(350);
  let st = await qrState(page);
  if (!st.lightboxOpen) {
    // Fallback: programmatic open proves module wiring; then try click again.
    await page.evaluate(() => {
      const img = document.querySelector(".pay-qr-frame img, [data-mcj-pay-qr]");
      const src = img && (img.currentSrc || img.src);
      if (src && window.McjPayQrPreview) window.McjPayQrPreview.open(src);
    });
    await page.waitForTimeout(200);
    st = await qrState(page);
    st._openedViaApi = true;
  }
  return st;
}

async function closeLightbox(page) {
  // Prefer close button; also accept Esc / API.
  const btn = page.locator("#payQrLightbox [data-pay-qr-close]");
  if (await btn.count()) {
    try {
      await btn.click({ timeout: 4000, force: true });
    } catch {
      await page.keyboard.press("Escape");
    }
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(250);
  let st = await qrState(page);
  if (st.lightboxOpen) {
    await page.evaluate(() => window.McjPayQrPreview && window.McjPayQrPreview.close());
    await page.waitForTimeout(150);
    st = await qrState(page);
    st._closedViaApi = true;
  }
  return st;
}

async function runViewport(browser, label, viewportOrDevice, token, user, orderId) {
  const context = await browser.newContext(
    typeof viewportOrDevice === "object" && viewportOrDevice.viewport
      ? viewportOrDevice
      : { viewport: viewportOrDevice }
  );
  const page = await context.newPage();
  await seedAuth(page, token, user);
  const url = `${BASE}/payment-confirm.html?order=${encodeURIComponent(orderId)}&t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-pay-qr]", { timeout: 45000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-mcj-pay-qr], [data-pay-qr-img]");
    return img && (img.getAttribute("data-pay-qr-load") === "ok" || img.naturalWidth > 0);
  }, { timeout: 30000 }).catch(() => {});

  let st = await qrState(page);
  step(`${label}_img_in_first_viewport`, st.inFirstViewport === true, JSON.stringify(st));
  step(
    `${label}_img_visible`,
    st.hasQr === "1" && st.w >= 160 && st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0,
    JSON.stringify({ hasQr: st.hasQr, load: st.load, w: st.w, h: st.h, display: st.display, cursor: st.cursor, natural: st.natural })
  );
  step(`${label}_cursor_zoom`, /zoom-in/i.test(st.cursor || ""), st.cursor || "");
  step(`${label}_preview_lib`, st.hasPreviewLib === true, String(st.hasPreviewLib));

  await page.screenshot({ path: path.join(ART, `${label}-page.png`), fullPage: true });

  // Click open — require click path (not API fallback) for PASS of open step.
  const zoom = page.locator("[data-pay-qr-zoom]").first();
  await zoom.scrollIntoViewIfNeeded();
  await zoom.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  st = await qrState(page);
  const openOk = st.lightboxOpen && st.lightboxImgW > 100;
  step(`${label}_lightbox_open`, openOk, JSON.stringify({ open: st.lightboxOpen, w: st.lightboxImgW, src: st.lightboxSrc }));
  if (openOk) await page.screenshot({ path: path.join(ART, `${label}-lightbox.png`) });

  if (!openOk) {
    // Diagnose then force-open for close test.
    const diag = await page.evaluate(() => ({
      installed: !!document.getElementById("payQrLightbox"),
      zoomCount: document.querySelectorAll("[data-pay-qr-zoom]").length,
      api: typeof window.McjPayQrPreview,
    }));
    step(`${label}_lightbox_open_diag`, false, JSON.stringify(diag));
    await page.evaluate(() => {
      const img = document.querySelector(".pay-qr-frame img, [data-mcj-pay-qr]");
      const src = img && (img.currentSrc || img.src);
      if (src && window.McjPayQrPreview) window.McjPayQrPreview.open(src);
    });
    await page.waitForTimeout(200);
  }

  st = await closeLightbox(page);
  step(`${label}_lightbox_close`, st.lightboxOpen === false, st._closedViaApi ? "closed_via_api" : "closed");

  // Error path: break src, keep slot visible.
  await page.evaluate(() => {
    const img = document.querySelector("[data-mcj-pay-qr], [data-pay-qr-img]");
    if (!img) return;
    img.setAttribute("src", "https://invalid.example/missing-qr-" + Date.now() + ".png");
  });
  await page.waitForTimeout(800);
  st = await qrState(page);
  step(
    `${label}_error_keeps_visible`,
    st.load === "error" && st.display !== "none" && st.w > 0 && st.errMsg === true,
    JSON.stringify({ load: st.load, display: st.display, w: st.w, errMsg: st.errMsg })
  );
  await page.screenshot({ path: path.join(ART, `${label}-error.png`), fullPage: true });

  await context.close();
}

(async () => {
  console.log("BASE", BASE);

  const html = await fetch(`${BASE}/payment-confirm.html?cb=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  step(
    "html_has_preview_assets",
    /pay-qr-preview\.js/.test(html) && /pay-qr-preview\.css/.test(html) && html.length > 500,
    `len=${html.length}`
  );

  const login = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossToken = tok(login.json);
  const bossUser = login.json?.session?.user || login.json?.user || { role: "boss", email: BOSS };
  step("boss_login", !!bossToken, BOSS);

  const companions = await api("/api/public/companions", null, null, "GET");
  const list = companions.json?.companions || [];
  const comp =
    list.find((c) => c.canOrderNow === true && Number(c.priceValue || c.price || 0) > 0) ||
    list.find((c) => Number(c.priceValue || c.price || 0) > 0) ||
    list[0];
  step("pick_companion", !!comp?.id, `${comp?.id || ""} ${comp?.name || ""}`);

  const unit = Number(comp?.priceValue || comp?.price || 15) || 15;
  const place = await api("/api/orders", bossToken, {
    action: "place_order",
    companionId: comp?.id,
    companionName: comp?.name || "陪玩",
    serviceType: "陪玩",
    service: "陪玩",
    game: "VALORANT",
    unitPrice: unit,
    hours: 1,
    quantity: 1,
    totalAmount: unit,
    gameId: "PAY-QR-ZOOM-" + Date.now(),
    paymentMethod: "duitnow",
    notes: "pay qr confirm zoom e2e",
    idempotencyKey: "pay-qr-zoom-" + Date.now(),
  });
  const order = place.json?.order || {};
  const orderId = order.id;
  step(
    "place_order",
    !!(place.json?.ok && orderId && order.status === "awaiting_payment"),
    `${orderId || ""} ${place.json?.message || ""}`
  );

  const getOrder = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const payInfo = getOrder.json?.platformPayInfo || {};
  step(
    "api_platformPayInfo",
    !!(payInfo.qrUrl && payInfo.enabled !== false),
    JSON.stringify({
      enabled: payInfo.enabled,
      unavailable: payInfo.unavailable,
      channelId: payInfo.channelId,
      qrLen: String(payInfo.qrUrl || "").length,
      qrHead: String(payInfo.qrUrl || "").slice(0, 96),
    })
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  await runViewport(browser, "desktop", { width: 1440, height: 800 }, bossToken, bossUser, orderId);
  await runViewport(browser, "mobile", devices["iPhone 13"], bossToken, bossUser, orderId);

  await browser.close();

  fs.writeFileSync(path.join(ART, "results-v3.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nDone. ${results.length - failed.length}/${results.length} PASS. artifacts=${ART}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
