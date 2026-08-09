/**
 * P0: Boss support message-center conversation switch lag.
 * Injects the locally built /assets/support-*.js bundle (Vite production)
 * while using staging APIs.
 *
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-boss-msg-center-lag-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const SRC_JS = fs.readFileSync(path.join(ROOT, "src/support-chat.js"), "utf8");
const DIST_SUPPORT = (() => {
  const dir = path.join(ROOT, "dist/assets");
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => /^support-[^.]+\.js$/.test(f));
  return hit ? fs.readFileSync(path.join(dir, hit), "utf8") : null;
})();
const ART = path.join("/opt/cursor/artifacts", "boss-msg-center-lag-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-msg-center-lag-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
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

async function runViewport(label, deviceOpts, { injectFix }) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext(deviceOpts || { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));

  let injectedHits = 0;
  if (injectFix && DIST_SUPPORT) {
    await page.route(/\/assets\/support-[^/?#]+\.js(?:\?.*)?$/, async (route) => {
      injectedHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: DIST_SUPPORT,
        headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
      });
    });
  }

  const chatGets = [];
  const chatPosts = [];
  const orderGets = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/orders")) orderGets.push({ t: Date.now(), u });
    if (!u.includes("/api/chat")) return;
    if (req.method() === "GET") chatGets.push({ t: Date.now(), u });
    if (req.method() === "POST") chatPosts.push({ t: Date.now(), u, post: req.postData() || "" });
  });

  const login = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const token = tok(login.json);
  step(`${label}_login`, !!token, `tok=${!!token}`);
  if (!token) {
    await browser.close();
    return null;
  }

  await context.addInitScript((t) => {
    try {
      localStorage.setItem("mcjAuthAccessToken", t);
      sessionStorage.setItem("mcjAuthAccessToken", t);
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerAuthToken", t);
    } catch (_) {}
  }, token);

  const listApi = await api("/api/chat?action=conversations", token, null, "GET");
  const convs = listApi.json?.conversations || [];
  step(`${label}_has_conversations`, convs.length >= 2, `count=${convs.length}`);
  if (convs.length < 2) {
    await browser.close();
    return null;
  }

  await page.goto(`${BASE}/support.html?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".support-session[data-select-conversation]", { timeout: 30000 });
  const lagfix = await page.evaluate(() => String(window.__MCJ_SUPPORT_CHAT_LAGFIX || ""));
  if (injectFix) {
    step(`${label}_fix_injected`, injectedHits >= 1 && lagfix === "20260809bossMsgLag1", `hits=${injectedHits} flag=${lagfix || "(none)"}`);
  } else {
    step(`${label}_baseline_no_fix_flag`, lagfix !== "20260809bossMsgLag1", `flag=${lagFix || "(none)"}`);
  }

  const isMobile = /mobile/.test(label);

  async function ensureListVisible() {
    if (!isMobile) return;
    const listVisible = await page.locator(".support-session[data-select-conversation]").first().isVisible().catch(() => false);
    if (listVisible) return;
    const back = page.locator("[data-back-list]").first();
    if (await back.count()) {
      await back.click({ timeout: 3000 }).catch(() => null);
      await page.waitForSelector(".support-session[data-select-conversation]", { timeout: 8000 });
    }
  }

  async function clickSession(index, { waitMessages } = {}) {
    await ensureListVisible();
    const cards = page.locator(".support-session[data-select-conversation]");
    const count = await cards.count();
    const i = index % count;
    const card = cards.nth(i);
    const cid = await card.getAttribute("data-select-conversation");
    const t0 = Date.now();
    await card.click({ timeout: 5000 });
    if (isMobile) {
      await page.waitForSelector(".support-main-head, .support-messages", { timeout: 2500 });
      await page.waitForFunction(() => {
        const layout = document.querySelector(".support-layout");
        return !!(layout && layout.classList.contains("mobile-detail"));
      }, null, { timeout: 2500 });
    } else {
      await page.waitForFunction(
        (id) => {
          const active = document.querySelector(".support-session.active");
          const main = document.querySelector(".support-main-head, .support-messages, .support-main");
          return !!(active && active.getAttribute("data-select-conversation") === id && main);
        },
        cid,
        { timeout: 2500 }
      );
    }
    const uiMs = Date.now() - t0;
    let msgMs = null;
    if (waitMessages) {
      await page.waitForSelector(".support-messages", { timeout: 8000 });
      // Messages pane exists immediately; wait until either real msgs or empty placeholder after paint.
      await page.waitForFunction(() => {
        const box = document.querySelector(".support-messages");
        if (!box) return false;
        return box.querySelector(".support-msg, .support-list-empty") != null;
      }, null, { timeout: 8000 });
      msgMs = Date.now() - t0;
    }
    return { cid, uiMs, msgMs };
  }

  // Measure: UI + message pane ready (should not wait on orders)
  chatGets.length = 0;
  orderGets.length = 0;
  const open1 = await clickSession(0, { waitMessages: true });
  // Observe whether orders request continues after messages already shown
  await page.waitForTimeout(1500);
  const ordersAfter = orderGets.length;
  step(
    `${label}_first_switch_ui_ms`,
    open1.uiMs <= 800,
    `uiMs=${open1.uiMs} msgMs=${open1.msgMs} cid=${open1.cid} ordersAfter=${ordersAfter}`
  );
  await shot(page, `${label}-01-first`);

  // Rapid 10 switches — UI only (no waiting for network)
  const switchMs = [];
  chatGets.length = 0;
  chatPosts.length = 0;
  orderGets.length = 0;
  const tRapid0 = Date.now();
  for (let i = 0; i < 10; i++) {
    const r = await clickSession(i + 1);
    switchMs.push(r.uiMs);
    await page.waitForTimeout(40);
  }
  const rapidWall = Date.now() - tRapid0;
  const maxUi = Math.max(...switchMs);
  const avgUi = Math.round(switchMs.reduce((a, b) => a + b, 0) / switchMs.length);
  const last3 = switchMs.slice(-3);
  const first3 = switchMs.slice(0, 3);
  const avgFirst = first3.reduce((a, b) => a + b, 0) / first3.length;
  const avgLast = last3.reduce((a, b) => a + b, 0) / last3.length;
  step(
    `${label}_rapid10_ui_responsive`,
    maxUi <= 1000 && avgUi <= 650,
    `max=${maxUi}ms avg=${avgUi}ms wall=${rapidWall}ms samples=${switchMs.join(",")}`
  );
  step(
    `${label}_rapid10_no_slowdown`,
    avgLast <= avgFirst * 2.5 + 150,
    `avgFirst=${Math.round(avgFirst)} avgLast=${Math.round(avgLast)}`
  );

  await page.waitForTimeout(2500);
  const threadGets = chatGets.filter((g) => /conversation_id=/.test(g.u));
  const markReads = chatPosts.filter((p) => /mark_read/.test(p.post));
  step(
    `${label}_thread_get_not_exploding`,
    threadGets.length <= 22,
    `threadGets=${threadGets.length} markReads=${markReads.length} orderGets=${orderGets.length} allGets=${chatGets.length}`
  );

  // Cache revisit
  await ensureListVisible();
  await clickSession(0);
  await page.waitForTimeout(900);
  await clickSession(1);
  await page.waitForTimeout(900);
  chatGets.length = 0;
  const tCache0 = Date.now();
  const cacheOpen = await clickSession(0, { waitMessages: true });
  const cacheUi = Date.now() - tCache0;
  const msgCount = await page.locator(".support-messages .support-msg, .support-messages .support-list-empty").count();
  step(
    `${label}_cache_revisit_instant`,
    cacheUi <= 900 && cacheOpen.uiMs <= 800 && msgCount >= 1,
    `uiMs=${cacheUi} clickUi=${cacheOpen.uiMs} msgMs=${cacheOpen.msgMs} msgsOrEmpty=${msgCount}`
  );
  await page.waitForTimeout(800);
  const revisitThreadGets = chatGets.filter((g) => /conversation_id=/.test(g.u)).length;
  step(`${label}_cache_revisit_single_refresh`, revisitThreadGets <= 2, `threadGets=${revisitThreadGets}`);
  step(`${label}_no_pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "ok");
  await shot(page, `${label}-02-after-rapid`);

  const summary = {
    label,
    injectFix,
    lagFix: lagFixFlag,
    avgUi,
    maxUi,
    firstUi: open1.uiMs,
    firstMsg: open1.msgMs,
    rapidWall,
    threadGets: threadGets.length,
  };
  await browser.close();
  return summary;
}

(async () => {
  console.log("BASE", BASE);
  step("local_fix_markers", /selectConversationInstant|threadCache|threadLoadSeq/.test(SRC_JS), "support-chat.js contains lag-fix symbols");
  step("dist_bundle_ready", !!(DIST_SUPPORT && /__MCJ_SUPPORT_CHAT_LAGFIX/.test(DIST_SUPPORT)), `bytes=${DIST_SUPPORT ? DIST_SUPPORT.length : 0}`);
  if (!DIST_SUPPORT) {
    console.error("Missing dist/assets/support-*.js — run npm run build first");
    process.exit(1);
  }

  // Optional baseline (old staging bundle) for comparison — does not fail the run.
  const baselineDesktop = await runViewport("baseline_desktop", { viewport: { width: 1440, height: 900 } }, { injectFix: false });
  const mobile = await runViewport("mobile", devices["iPhone 13"], { injectFix: true });
  const desktop = await runViewport("desktop", { viewport: { width: 1440, height: 900 } }, { injectFix: true });

  if (baselineDesktop && desktop) {
    step(
      "fix_vs_baseline_ui",
      desktop.avgUi <= baselineDesktop.avgUi + 80,
      `baselineAvg=${baselineDesktop.avgUi} fixedAvg=${desktop.avgUi} baselineMax=${baselineDesktop.maxUi} fixedMax=${desktop.maxUi}`
    );
  }

  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    overall: failed.length ? "FAIL" : "PASS",
    failed: failed.length,
    results,
    base: BASE,
    summaries: { baselineDesktop, mobile, desktop },
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log("OVERALL", out.overall, `failed=${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
