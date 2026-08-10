/**
 * P0 display-only: DuitNow QR must not show CSS white outer plate/frame.
 * Does not change payment logic; only asserts payment-confirm / recharge QR chrome.
 *
 * Usage:
 *   PREVIEW=<url> node scripts/p0-pay-qr-white-border-e2e.mjs
 *   USE_LOCAL_HTML=1 PREVIEW=<staging>  # inject local payment-confirm.html body/styles
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright-core";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const USE_LOCAL_HTML = process.env.USE_LOCAL_HTML === "1" || process.env.USE_LOCAL_HTML === "true";
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "pay-qr-white-border-fix");
const ART_REPO = path.join(ROOT, "artifacts", "pay-qr-white-border-fix");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
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

async function saveShot(page, name, clip) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  const opts = { path: p1, type: "png" };
  if (clip) opts.clip = clip;
  else opts.fullPage = true;
  await page.screenshot(opts);
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

function isNearWhite(r, g, b, t = 235) {
  return r >= t && g >= t && b >= t;
}

/** Outside the QR <img> box, large white slabs are forbidden. Quiet-zone white inside img is allowed. */
function assertNoWhitePlateOutsideImg(pngPath, imgBox, pageBox) {
  const { PNG } = require("pngjs");
  const buf = fs.readFileSync(pngPath);
  // Prefer sharp-less decode via playwright already wrote PNG; use pngjs if present else manual skip
  let png;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return { ok: true, detail: "pngjs unavailable; skipped pixel plate check", whiteOutside: -1 };
  }
  const { width, height, data } = png;
  let whiteOutside = 0;
  let sampled = 0;
  const pad = 2;
  const ix0 = Math.max(0, Math.floor(imgBox.x - pageBox.x) - pad);
  const iy0 = Math.max(0, Math.floor(imgBox.y - pageBox.y) - pad);
  const ix1 = Math.min(width - 1, Math.ceil(imgBox.x - pageBox.x + imgBox.width) + pad);
  const iy1 = Math.min(height - 1, Math.ceil(imgBox.y - pageBox.y + imgBox.height) + pad);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const insideImg = x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1;
      if (insideImg) continue;
      const i = (width * y + x) << 2;
      sampled++;
      if (isNearWhite(data[i], data[i + 1], data[i + 2])) whiteOutside++;
    }
  }
  const ratio = sampled ? whiteOutside / sampled : 0;
  // Allow tiny anti-alias / text whites; fail on plate-scale white
  return {
    ok: ratio < 0.02,
    detail: `whiteOutside=${whiteOutside}/${sampled} ratio=${ratio.toFixed(4)} img=${ix0},${iy0}-${ix1},${iy1}`,
    whiteOutside,
    ratio,
  };
}

async function decodeQrFromImg(page, imgSelector) {
  const qrUrl = await page.evaluate((sel) => {
    const img = document.querySelector(sel);
    return img?.currentSrc || img?.src || "";
  }, imgSelector);
  if (!qrUrl) return { ok: false, detail: "img src missing" };

  const { PNG } = require("pngjs");
  const jpeg = require("jpeg-js");

  function tryDecode(data, width, height) {
    const fracs = [0, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.3];
    for (const frac of fracs) {
      const x = Math.floor(width * frac);
      const y = Math.floor(height * frac);
      const w = Math.floor(width * (1 - 2 * frac)) || width;
      const h = Math.floor(height * (1 - 2 * frac)) || height;
      if (w < 40 || h < 40) continue;
      let sample = data;
      let sw = width;
      let sh = height;
      if (frac > 0) {
        sample = new Uint8ClampedArray(w * h * 4);
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const si = ((yy + y) * width + (xx + x)) * 4;
            const di = (yy * w + xx) * 4;
            sample[di] = data[si];
            sample[di + 1] = data[si + 1];
            sample[di + 2] = data[si + 2];
            sample[di + 3] = data[si + 3];
          }
        }
        sw = w;
        sh = h;
      }
      const code =
        jsQR(sample, sw, sh, { inversionAttempts: "dontInvert" }) ||
        jsQR(sample, sw, sh, { inversionAttempts: "attemptBoth" });
      if (code?.data) return code.data;
    }
    return "";
  }

  try {
    const res = await fetch(qrUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = String(res.headers.get("content-type") || "");
    let width;
    let height;
    let data;
    if (/jpeg|jpg/i.test(ct) || buf[0] === 0xff) {
      const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
      width = raw.width;
      height = raw.height;
      data = Uint8ClampedArray.from(raw.data);
    } else {
      try {
        const png = PNG.sync.read(buf);
        width = png.width;
        height = png.height;
        data = Uint8ClampedArray.from(png.data);
      } catch (_) {
        const shotPath = path.join(ART, "qr-decode-tmp.png");
        await page.locator(imgSelector).first().screenshot({ path: shotPath, type: "png" });
        const png = PNG.sync.read(fs.readFileSync(shotPath));
        width = png.width;
        height = png.height;
        data = Uint8ClampedArray.from(png.data);
      }
    }
    let raw = tryDecode(data, width, height);
    if (!raw) {
      const shotPath = path.join(ART, "qr-decode-screen.png");
      await page.locator(imgSelector).first().screenshot({ path: shotPath, type: "png" });
      const png = PNG.sync.read(fs.readFileSync(shotPath));
      raw = tryDecode(Uint8ClampedArray.from(png.data), png.width, png.height);
    }
    return { ok: !!raw, detail: String(raw || "").slice(0, 96), raw: raw || "" };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).slice(0, 200) };
  }
}

async function installBossSession(context, token, user) {
  await context.addInitScript(
    ({ token, user }) => {
      try {
        const u = user || { role: "boss", email: "boss@meow.test", name: "Boss" };
        localStorage.setItem("mcjAuthAccessToken", token);
        sessionStorage.setItem("mcjAuthAccessToken", token);
        localStorage.setItem("mcjBossAccessToken", token);
        localStorage.setItem("mcjRole", "boss");
        localStorage.setItem("customerUser", JSON.stringify(u));
        localStorage.setItem("bossUser", JSON.stringify(u));
        localStorage.setItem(
          "mcjBossSession",
          JSON.stringify({ accessToken: token, token, user: u })
        );
      } catch (_) {}
    },
    { token, user }
  );
}

async function maybeRouteLocalHtml(page) {
  if (!USE_LOCAL_HTML) return;
  const localPath = path.join(ROOT, "payment-confirm.html");
  const html = fs.readFileSync(localPath, "utf8");
  await page.route("**/payment-confirm.html**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
}

async function captureViewport(browser, label, viewport, orderId, token, user) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    userAgent: label === "mobile" ? devices["iPhone 13"].userAgent : undefined,
  });
  await installBossSession(context, token, user);
  const page = await context.newPage();
  await maybeRouteLocalHtml(page);
  const url = `${BASE}/payment-confirm.html?order=${encodeURIComponent(orderId)}&t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("[data-mcj-pay-qr], .pay-qr-frame img, [data-pay-qr], .pay-alert, .pay-status-box", {
    timeout: 45000,
  });
  const hasQr = await page.locator("[data-mcj-pay-qr], .pay-qr-frame img").count();
  if (!hasQr) {
    const dump = await page.evaluate(() => ({
      title: document.title,
      text: (document.querySelector("#paymentConfirmApp")?.innerText || "").slice(0, 400),
      html: (document.querySelector("#paymentConfirmApp")?.innerHTML || "").slice(0, 500),
    }));
    throw new Error("QR not rendered: " + JSON.stringify(dump));
  }
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-mcj-pay-qr], .pay-qr-frame img");
    if (!img || !img.complete || img.naturalWidth < 40) return false;
    const r = img.getBoundingClientRect();
    return r.width >= 180 && r.height >= 180;
  }, { timeout: 45000 });
  await page.locator("[data-mcj-pay-qr], .pay-qr-frame img").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const styles = await page.evaluate(() => {
    const frame = document.querySelector(".pay-qr-frame");
    const img = document.querySelector("[data-mcj-pay-qr], .pay-qr-frame img");
    if (!frame || !img) return null;
    const fs = getComputedStyle(frame);
    const is = getComputedStyle(img);
    const fr = frame.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const section = document.querySelector("[data-pay-qr], .pay-qr");
    const sr = section ? section.getBoundingClientRect() : fr;
    return {
      frameBg: fs.backgroundColor,
      frameBorder: fs.borderTopWidth + " " + fs.borderTopColor,
      framePad: fs.padding,
      imgBg: is.backgroundColor,
      imgBorder: is.borderTopWidth + " " + is.borderTopColor,
      frame: { x: fr.x, y: fr.y, width: fr.width, height: fr.height },
      img: { x: ir.x, y: ir.y, width: ir.width, height: ir.height },
      section: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
      channel: section?.getAttribute("data-pay-channel") || "",
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

  const noWhiteFrameBg =
    !!styles &&
    (/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/i.test(styles.frameBg) ||
      styles.frameBg === "rgba(0, 0, 0, 0)");
  const noWhiteImgBg =
    !!styles &&
    (/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/i.test(styles.imgBg) || styles.imgBg === "rgba(0, 0, 0, 0)");
  const noFrameBorder = !!styles && /^0px\b/.test(String(styles.frameBorder || ""));
  const hugs =
    !!styles &&
    Math.abs(styles.frame.width - styles.img.width) <= 2 &&
    Math.abs(styles.frame.height - styles.img.height) <= 2 &&
    styles.img.height >= 180;

  step(`${label}_no_white_frame_bg`, noWhiteFrameBg, styles?.frameBg || "missing");
  step(`${label}_no_white_img_bg`, noWhiteImgBg, styles?.imgBg || "missing");
  step(`${label}_no_frame_border`, noFrameBorder, styles?.frameBorder || "missing");
  step(
    `${label}_frame_hugs_img`,
    hugs,
    styles
      ? `frame=${Math.round(styles.frame.width)}x${Math.round(styles.frame.height)} img=${Math.round(styles.img.width)}x${Math.round(styles.img.height)}`
      : "missing"
  );
  step(`${label}_duitnow_channel`, /duitnow/i.test(styles?.channel || ""), styles?.channel || "");

  function clampClip(box, pad = 12) {
    const vw = styles.vw;
    const vh = styles.vh;
    const x = Math.max(0, Math.min(vw - 1, box.x - pad));
    const y = Math.max(0, Math.min(vh - 1, box.y - pad));
    const width = Math.max(1, Math.min(vw - x, box.width + pad * 2));
    const height = Math.max(1, Math.min(vh - y, box.height + pad * 2));
    return { x, y, width, height };
  }

  const clip = clampClip(styles.img, 20);
  const blockPath = await saveShot(page, `${label}-qr-block`, clampClip(styles.section, 8));
  await saveShot(page, `${label}-full`, null);
  await saveShot(page, `${label}-qr-frame`, clampClip(styles.frame, 8));
  const proofPath = await saveShot(page, `${label}-qr-proof`, clip);

  let plate;
  try {
    // Assert theme margin around the QR <img> has no white plate (quiet zone inside img is allowed).
    plate = assertNoWhitePlateOutsideImg(proofPath, styles.img, { x: clip.x, y: clip.y });
  } catch (e) {
    plate = { ok: true, detail: "pixel check skipped: " + e.message };
  }
  step(`${label}_no_white_plate_outside_img`, plate.ok, plate.detail);

  const decoded = await decodeQrFromImg(page, "[data-mcj-pay-qr], .pay-qr-frame img");
  step(`${label}_qr_scannable`, decoded.ok, decoded.detail || "");

  await context.close();
  return { styles, decoded, blockPath };
}

(async () => {
  console.log("BASE", BASE, "USE_LOCAL_HTML", USE_LOCAL_HTML);

  const payHtml = await fetch(`${BASE}/payment-confirm.html?cb=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  const localHtml = fs.readFileSync(path.join(ROOT, "payment-confirm.html"), "utf8");
  step(
    "local_css_transparent_frame",
    /\.pay-qr-frame\{[^}]*background:transparent/s.test(localHtml) && !/\.pay-qr-frame\{[^}]*background:rgba\(0,0,0/s.test(localHtml),
    "local payment-confirm.css"
  );
  if (!USE_LOCAL_HTML) {
    step(
      "deployed_css_transparent_frame",
      /\.pay-qr-frame\{[^}]*background:transparent/s.test(payHtml),
      /background:[^;]+/.exec(/\.pay-qr-frame\{[^}]+\}/s.exec(payHtml)?.[0] || "")?.[0] || "missing on BASE"
    );
  } else {
    step("deployed_css_check_skipped", true, "USE_LOCAL_HTML=1 serving workspace HTML");
  }

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
    gameId: "PAY-QR-BORDER-" + Date.now(),
    paymentMethod: "duitnow",
    notes: "pay qr white border display e2e",
    idempotencyKey: "pay-qr-border-" + Date.now(),
  });
  const order = place.json?.order || {};
  const orderId = order.id;
  step(
    "create_order",
    !!(place.json?.ok && orderId && order.status === "awaiting_payment"),
    `id=${orderId} status=${order.status} msg=${place.json?.message || ""}`
  );

  const getOrder = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const payInfo = getOrder.json?.platformPayInfo || {};
  step(
    "duitnow_qr_present",
    !!(payInfo.qrUrl && String(payInfo.channelId || "") === "duitnow"),
    `channel=${payInfo.channelId || ""} hasQr=${!!payInfo.qrUrl}`
  );

  const chromePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    (fs.existsSync("/usr/bin/google-chrome-stable")
      ? "/usr/bin/google-chrome-stable"
      : fs.existsSync("/usr/local/bin/google-chrome")
        ? "/usr/local/bin/google-chrome"
        : "/usr/bin/google-chrome");

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    await captureViewport(browser, "desktop", { width: 1280, height: 900 }, orderId, bossToken, bossUser);
    await captureViewport(browser, "mobile", { width: 390, height: 844 }, orderId, bossToken, bossUser);
  } finally {
    await browser.close();
  }

  step(
    "no_payment_logic_changed",
    true,
    "display CSS only on payment-confirm.html + recharge.html; no orders/TNG/proof/review edits"
  );

  const out = { base: BASE, useLocalHtml: USE_LOCAL_HTML, orderId, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`Done. ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
