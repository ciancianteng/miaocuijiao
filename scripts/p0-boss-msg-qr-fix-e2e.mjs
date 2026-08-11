/**
 * Acceptance: boss message center layout/composer + recharge QR enlarge.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-boss-msg-qr-fix-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const ART = path.join("/opt/cursor/artifacts", "boss-msg-qr-fix-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-msg-qr-fix-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
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
async function shot(page, name) {
  const p1 = path.join(ART, `${name}.png`);
  await page.screenshot({ path: p1, fullPage: false }).catch(() => null);
  try {
    fs.copyFileSync(p1, path.join(ART_REPO, `${name}.png`));
  } catch (_) {}
}

async function waitDeploy(maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const html = await (await fetch(`${BASE}/support.html?cb=${Date.now()}`, { cache: "no-store" })).text();
      const reh = await (await fetch(`${BASE}/recharge.html?cb=${Date.now()}`, { cache: "no-store" })).text();
      const assetMatch = html.match(/\/assets\/support-[^"'?]+\.js/);
      let okSupport = /20260811bossMsgQr4/.test(html);
      if (!okSupport && assetMatch) {
        const js = await (await fetch(`${BASE}${assetMatch[0]}?cb=${Date.now()}`, { cache: "no-store" })).text();
        okSupport = /20260811bossMsgQr4/.test(js) && /support-session-name/.test(js) && /订单客服/.test(js);
      }
      const okRecharge = (/20260811bossMsgQr1/.test(reh) || /pay-qr-lightbox/.test(reh)) && /width:320px/.test(reh);
      if (okSupport && okRecharge) {
        step("deploy_ready", true, `elapsed=${Date.now() - t0}ms asset=${assetMatch ? assetMatch[0] : "inline"}`);
        return true;
      }
      console.log(`[wait] deploy not ready yet support=${okSupport} recharge=${okRecharge}`);
    } catch (e) {
      console.log(`[wait] fetch error ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  step("deploy_ready", false, "timeout waiting for cache-bust 20260811bossMsgQr1");
  return false;
}

async function main() {
  step("base", true, BASE);
  const ready = await waitDeploy();
  if (!ready) {
    fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify({ overall: "FAIL", results }, null, 2));
    process.exit(1);
  }

  const chromePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable";
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));

  const login = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  let token = tok(login.json);
  if (!token) {
    const alt = await api("/api/auth", null, {
      action: "login",
      email: "boss.final.1785714993009@meow.test",
      password: PASS,
      loginPortal: "boss",
    });
    token = tok(alt.json);
  }
  step("boss_login", !!token, `tok=${!!token}`);
  if (!token) {
    await browser.close();
    process.exit(1);
  }

  await context.addInitScript((t) => {
    try {
      localStorage.setItem("mcjAuthAccessToken", t);
      sessionStorage.setItem("mcjAuthAccessToken", t);
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", t);
    } catch (_) {}
  }, token);

  // ========== TEST 1: list hierarchy ==========
  await page.goto(`${BASE}/support.html?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".support-session, .support-list-empty, .support-login-panel", { timeout: 60000 });
  await page.waitForTimeout(1500);
  const listInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".support-session")];
    const sample = items.slice(0, 8).map((el) => {
      const name = el.querySelector(".support-session-name");
      const sub = el.querySelector(".support-session-sub");
      const preview = el.querySelector(".support-session-preview");
      const aside = el.querySelector(".support-session-aside");
      const r = el.getBoundingClientRect();
      const nameCs = name && getComputedStyle(name);
      const previewCs = preview && getComputedStyle(preview);
      const ellipsisOk =
        !!(nameCs && nameCs.textOverflow === "ellipsis" && nameCs.whiteSpace === "nowrap") &&
        !!(previewCs && previewCs.textOverflow === "ellipsis" && previewCs.whiteSpace === "nowrap");
      const n = (name && name.textContent.trim()) || "";
      const s = (sub && sub.textContent.trim()) || "";
      return {
        name: n,
        sub: s,
        preview: (preview && preview.textContent.trim()) || "",
        hasName: !!n,
        hasSub: !!s,
        hasPreview: !!(preview && preview.textContent.trim()),
        hasAside: !!aside,
        duplicateNameSub: !!(n && s && n === s),
        ellipsisOk,
        h: Math.round(r.height),
        active: el.classList.contains("active"),
        hasPinkInset: getComputedStyle(el).boxShadow.includes("rgb"),
      };
    });
    const list = document.querySelector(".support-session-list");
    return {
      count: items.length,
      sample,
      listOverflowY: list ? getComputedStyle(list).overflowY : "",
      lagFix: window.__MCJ_SUPPORT_CHAT_LAGFIX || "",
    };
  });
  await shot(page, "01-support-list");
  const hierarchyOk =
    listInfo.count >= 1 &&
    listInfo.sample.every((s) => s.hasName && s.hasSub && s.hasPreview && s.hasAside && s.ellipsisOk && !s.duplicateNameSub && s.h >= 60 && s.h <= 120) &&
    /auto|scroll/.test(listInfo.listOverflowY);
  step(
    "TEST1_list_hierarchy",
    hierarchyOk,
    JSON.stringify({
      count: listInfo.count,
      lagFix: listInfo.lagFix,
      listOverflowY: listInfo.listOverflowY,
      sample: listInfo.sample.slice(0, 3),
    })
  );

  // ========== TEST 2: switch 5 sessions ==========
  const switches = [];
  const buttons = page.locator(".support-session");
  const n = Math.min(5, await buttons.count());
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    await buttons.nth(i).click();
    await page.waitForSelector(".support-messages, .support-empty-panel", { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(80);
    const uiMs = Date.now() - t0;
    const active = await page.evaluate(() => {
      const a = document.querySelector(".support-session.active");
      const footer = document.querySelector("[data-support-footer], .support-composer, .support-ended-panel");
      const footerBox = footer && footer.getBoundingClientRect();
      return {
        active: !!(a && a.classList.contains("active")),
        footerVisible: !!(footerBox && footerBox.height > 40 && footerBox.bottom <= window.innerHeight + 2),
      };
    });
    switches.push({ i, uiMs, ...active });
  }
  await shot(page, "02-after-switch");
  const maxUi = Math.max(...switches.map((s) => s.uiMs), 0);
  const avgUi = switches.length ? Math.round(switches.reduce((a, s) => a + s.uiMs, 0) / switches.length) : 0;
  step(
    "TEST2_switch_5",
    switches.length >= Math.min(5, listInfo.count) && maxUi < 3000 && switches.every((s) => s.active),
    JSON.stringify({ maxUi, avgUi, switches })
  );

  // ========== TEST 3/4: composer visible + send ==========
  // Prefer an open (non-ended) conversation for send test.
  const openIdx = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".support-session")];
    for (let i = 0; i < items.length; i++) {
      const preview = (items[i].querySelector(".support-session-preview")?.textContent || "").trim();
      if (!/会话已结束/.test(preview)) return i;
    }
    return 0;
  });
  await buttons.nth(openIdx).click();
  await page.waitForTimeout(1200);
  const composerGeom = await page.evaluate(() => {
    const footer = document.querySelector("[data-support-footer]");
    const ta = document.querySelector(".support-composer textarea, [data-send] [name=content]");
    const send = document.querySelector(".support-send-btn, [data-send-btn]");
    const img = document.querySelector("[data-chat-image-btn]");
    const messages = document.querySelector("[data-messages]");
    const fb = footer && footer.getBoundingClientRect();
    const tb = ta && ta.getBoundingClientRect();
    const sb = send && send.getBoundingClientRect();
    const ib = img && img.getBoundingClientRect();
    const inView = (b) => !!(b && b.width > 8 && b.height > 8 && b.top >= 0 && b.bottom <= window.innerHeight + 1);
    if (messages) messages.scrollTop = messages.scrollHeight;
    return {
      vh: window.innerHeight,
      footer: fb && { top: fb.top, bottom: fb.bottom, h: fb.height },
      ta: tb && { top: tb.top, bottom: tb.bottom, h: tb.height },
      send: sb && { top: sb.top, bottom: sb.bottom, h: sb.height },
      img: ib && { top: ib.top, bottom: ib.bottom, h: ib.height },
      footerInView: inView(fb),
      taInView: inView(tb),
      sendInView: inView(sb),
      imgInView: !img || inView(ib),
      sticky: footer ? getComputedStyle(footer).position : "",
      activeSelected: !!document.querySelector(".support-session.active"),
    };
  });
  await shot(page, "03-composer");
  step(
    "TEST3_composer_visible",
    !!(composerGeom.footerInView && composerGeom.taInView && composerGeom.sendInView && composerGeom.imgInView && composerGeom.activeSelected),
    JSON.stringify(composerGeom)
  );

  let sendOk = false;
  const ta = page.locator(".support-composer textarea, [data-send] [name=content]");
  if (await ta.count()) {
    const marker = `E2E消息中心 ${Date.now()}`;
    await ta.click();
    await page.keyboard.type(marker, { delay: 5 });
    const sendWait = page.waitForResponse(
      (res) => {
        if (!res.url().includes("/api/chat") || res.request().method() !== "POST") return false;
        const body = res.request().postData() || "";
        return /"action"\s*:\s*"send"/.test(body);
      },
      { timeout: 15000 }
    ).catch(() => null);
    await page.locator(".support-send-btn, [data-send-btn]").click();
    const sendRes = await sendWait;
    await page.waitForTimeout(1200);
    sendOk = await page.evaluate((m) => {
      const texts = [...document.querySelectorAll(".support-msg")].map((el) => el.textContent || "");
      return texts.some((t) => t.includes(m));
    }, marker);
    const status = sendRes ? sendRes.status() : 0;
    step("TEST4_send_message", sendOk, `markerVisible=${sendOk} status=${status}`);
  } else {
    const ended = await page.locator(".support-ended-panel, [data-reopen-chat]").count();
    step("TEST4_send_message", ended > 0 && composerGeom.footerInView, `closed_session ended=${ended}`);
  }

  // ========== TEST 5-7: recharge QR ==========
  const methods = await api("/api/recharge", token, null, "GET");
  const campaigns = methods.json?.campaigns || [];
  const methodList = methods.json?.methods || [];
  const duitnow =
    methodList.find((m) => /duitnow/i.test(String(m.code || m.id || m.method || m.name || ""))) || methodList[0];
  const methodCode = String(duitnow?.code || "duitnow");
  let paymentNo = "";
  // Prefer existing pending payment so we do not depend on first-recharge campaigns.
  const existing = (methods.json?.records || []).find((r) => /pending/i.test(String(r.status || "")));
  paymentNo = existing?.paymentNo || "";
  if (!paymentNo) {
    const camp =
      campaigns.find((c) => !c.firstRechargeOnly && !c.first_recharge_only) ||
      campaigns.find((c) => Number(c.amount || c.payAmountRm || 0) > 0) ||
      campaigns[0];
    if (camp) {
      const created = await api("/api/recharge", token, {
        campaignId: camp.id || camp.campaignId,
        paymentMethod: methodCode,
      });
      paymentNo = created.json?.paymentOrder?.paymentNo || created.json?.paymentNo || "";
      step(
        "create_payment",
        !!paymentNo,
        `paymentNo=${paymentNo} status=${created.status} msg=${created.json?.message || ""} method=${methodCode}`
      );
    }
  } else {
    step("create_payment", true, `reuse existing pending=${paymentNo}`);
  }

  if (paymentNo) {
    await page.goto(`${BASE}/recharge.html?paymentNo=${encodeURIComponent(paymentNo)}&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForSelector("[data-mcj-pay-qr], .pay-qr-frame img, .pay-hint", { timeout: 60000 });
    await page.waitForTimeout(800);
    const qrInfo = await page.evaluate(() => {
      const img = document.querySelector("[data-mcj-pay-qr], .pay-qr-frame img");
      const box = img && img.getBoundingClientRect();
      const cs = img && getComputedStyle(img);
      const meta = {
        hasReceiver: !!document.querySelector(".pay-qr-meta"),
        hasProof: !!document.querySelector(".pay-proof-block, [data-proof-file]"),
        receiverText: (document.querySelector(".pay-qr-meta") || {}).textContent || "",
      };
      return {
        present: !!img,
        w: box ? Math.round(box.width) : 0,
        h: box ? Math.round(box.height) : 0,
        cssWidth: cs ? cs.width : "",
        naturalW: img ? img.naturalWidth : 0,
        naturalH: img ? img.naturalHeight : 0,
        src: img ? img.currentSrc || img.src : "",
        objectFit: cs ? cs.objectFit : "",
        meta,
      };
    });
    await shot(page, "05-qr-default");
    step(
      "TEST5_qr_size",
      qrInfo.present && qrInfo.w >= 300 && qrInfo.objectFit === "contain",
      JSON.stringify(qrInfo)
    );

    await page.locator("[data-pay-qr-zoom], [data-mcj-pay-qr], .pay-qr-frame img").first().click();
    await page.waitForTimeout(400);
    const light = await page.evaluate(() => {
      const box = document.getElementById("payQrLightbox");
      const img = box && box.querySelector("[data-pay-qr-lightbox-img]");
      const close = box && box.querySelector("[data-pay-qr-close]");
      const ib = img && img.getBoundingClientRect();
      return {
        open: !!(box && box.classList.contains("is-open")),
        hasClose: !!close,
        src: img ? img.src : "",
        w: ib ? Math.round(ib.width) : 0,
        h: ib ? Math.round(ib.height) : 0,
        naturalW: img ? img.naturalWidth : 0,
      };
    });
    await shot(page, "06-qr-lightbox");
    step(
      "TEST6_lightbox_open",
      light.open && light.hasClose && light.w >= 300 && light.naturalW > 0,
      JSON.stringify(light)
    );

    // Close via backdrop
    await page.locator("#payQrLightbox").click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => {
      const box = document.getElementById("payQrLightbox");
      const proof = document.querySelector(".pay-proof-block, [data-proof-file]");
      const img = document.querySelector("[data-mcj-pay-qr]");
      return {
        open: !!(box && box.classList.contains("is-open")),
        stillPay: !!(proof && img),
        stepText: (document.querySelector(".pay-step-panel h2, .page-head h1") || {}).textContent || "",
      };
    });
    await shot(page, "07-qr-closed");
    step("TEST7_close_stay_pay", !closed.open && closed.stillPay, JSON.stringify(closed));
  } else {
    step("TEST5_qr_size", false, "no paymentNo");
    step("TEST6_lightbox_open", false, "skipped");
    step("TEST7_close_stay_pay", false, "skipped");
  }

  step("no_pageerror", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "ok");

  await browser.close();
  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    overall: failed.length ? "FAIL" : "PASS",
    failed: failed.length,
    base: BASE,
    results,
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log("\nALL_PASS", failed.length === 0);
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
