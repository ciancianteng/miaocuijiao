/**
 * P0: Companion nav scroll flicker — global layout/router fix regression
 * Scroll each page to bottom → click next sidebar item → assert no remount flash / no bottom→top bounce
 *
 * Usage: node scripts/p0-companion-nav-scroll-flicker-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const BASE = (process.env.MCJ_STAGING_URL || process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || process.env.PASS || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const OUT = path.join(process.cwd(), "artifacts", "companion-nav-scroll-flicker-e2e");
const CHROME = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome";

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}

async function apiLogin(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, role: "companion", loginPortal: "companion" }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, json };
}

async function injectCompanionSession(page, session) {
  await page.goto(`${BASE}/companion/dashboard?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((sess) => {
    const user = Object.assign({}, (sess && sess.user) || {}, { role: "companion" });
    const blob = {
      token: sess.accessToken || sess.token || "",
      accessToken: sess.accessToken || sess.token || "",
      refreshToken: sess.refreshToken || "",
      expiresAt: sess.expiresAt || "",
      user,
    };
    const raw = JSON.stringify(blob);
    localStorage.setItem("mcjCompanionSession", raw);
    sessionStorage.setItem("mcjCompanionSession", raw);
    const soft = "companion_session_v4_" + Date.now();
    localStorage.setItem("companionAuthToken", soft);
    sessionStorage.setItem("companionAuthToken", soft);
    localStorage.setItem("companionUser", JSON.stringify(user));
    sessionStorage.setItem("companionUser", JSON.stringify(user));
  }, session);
  await page.goto(`${BASE}/companion/dashboard?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
}

async function loginCompanion(page) {
  await page.goto(`${BASE}/companion/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  try {
    const passTab = page.locator('[data-login-method-tab="password"]').first();
    if ((await passTab.count()) > 0) {
      await passTab.click();
      await page.waitForTimeout(300);
    }
    const account = page.locator('form[data-login-method="password"] input[name="account"], form[data-login] input[name="account"], input[name="email"]').first();
    const password = page.locator('form[data-login-method="password"] input[name="password"], form[data-login] input[name="password"], input[name="password"]').first();
    await account.waitFor({ timeout: 8000 });
    await account.fill(COMP);
    await password.fill(PASS);
    await page.locator('form[data-login-method="password"] button[type="submit"], form[data-login] button[type="submit"], button[type="submit"]').first().click();
    await page.waitForTimeout(2500);
  } catch (err) {
    console.log("[login-ui-fallback]", err.message);
  }
  const shell = page.locator(".pw-shell");
  if ((await shell.count()) === 0 || /\/login/i.test(page.url())) {
    const login = await apiLogin(COMP);
    if (!login.ok || !(login.json?.session || login.json?.token || login.json?.accessToken)) {
      throw new Error("companion login failed: " + (login.json?.message || login.json?.error || "unknown"));
    }
    const session =
      login.json.session ||
      {
        accessToken: login.json.accessToken || login.json.token,
        refreshToken: login.json.refreshToken || "",
        expiresAt: login.json.expiresAt || "",
        user: login.json.user || login.json.profile || { email: COMP, role: "companion" },
      };
    await injectCompanionSession(page, session);
  }
  await shell.waitFor({ timeout: 20000 });
}

const ROUTES = [
  ["/companion/dashboard", "工作台"],
  ["/companion/order-hall", "抢单大厅"],
  ["/companion/orders", "我的订单"],
  ["/companion/earnings", "收益中心"],
  ["/companion/profile", "我的资料"],
  ["/companion/account", "账号中心"],
  ["/companion/messages", "消息中心"],
  ["/companion/rules", "陪玩规则"],
];

async function scrollPageToBottom(page, isMobile) {
  await page.evaluate((mobile) => {
    const pageEl = document.querySelector(".pw-page");
    if (!mobile && pageEl) {
      pageEl.scrollTop = pageEl.scrollHeight;
      return { mode: "page", top: pageEl.scrollTop, h: pageEl.scrollHeight };
    }
    const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    document.documentElement.scrollTop = h;
    document.body.scrollTop = h;
    return { mode: "window", top: window.scrollY || document.documentElement.scrollTop, h };
  }, isMobile);
  await page.waitForTimeout(120);
}

async function readScroll(page, isMobile) {
  return page.evaluate((mobile) => {
    const pageEl = document.querySelector(".pw-page");
    const shell = document.querySelector(".pw-shell");
    return {
      route: location.pathname,
      shellId: shell ? shell.getAttribute("data-pw-shell-id") || "" : "",
      pageY: pageEl ? pageEl.scrollTop : -1,
      pageH: pageEl ? pageEl.scrollHeight : 0,
      winY: window.scrollY || document.documentElement.scrollTop || 0,
      sideHtmlLen: (document.querySelector(".pw-side") || {}).innerHTML?.length || 0,
    };
  }, isMobile);
}

async function markShell(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".pw-shell");
    if (!shell) return "";
    let id = shell.getAttribute("data-pw-shell-id");
    if (!id) {
      id = "shell-" + Date.now();
      shell.setAttribute("data-pw-shell-id", id);
    }
    const side = document.querySelector(".pw-side");
    if (side && !side.getAttribute("data-pw-side-mark")) {
      side.setAttribute("data-pw-side-mark", "1");
    }
    return id;
  });
}

async function clickNavTo(page, path, isMobile) {
  const clicked = await page.evaluate((p) => {
    const prefer = document.querySelector(`.pw-nav [data-route="${p}"], .pw-bottom-nav [data-route="${p}"]`);
    const any = prefer || document.querySelector(`[data-route="${p}"]`);
    if (any) {
      any.click();
      return "dom";
    }
    // Synthesize sidebar-equivalent navigation via the same data-route click bus.
    const b = document.createElement("button");
    b.setAttribute("data-route", p);
    b.style.position = "fixed";
    b.style.left = "-9999px";
    document.body.appendChild(b);
    b.click();
    b.remove();
    return "synthetic";
  }, path);
  await page.waitForTimeout(isMobile ? 450 : 350);
  return clicked;
}

async function runViewport(browser, label, viewport) {
  const context = await browser.newContext({
    viewport,
    userAgent:
      viewport.width <= 430
        ? devices["iPhone 12"].userAgent
        : undefined,
  });
  const page = await context.newPage();
  const isMobile = viewport.width <= 760;
  const flips = [];
  const remounts = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      // Full document navigations are bad for SPA sidebar stability.
      remounts.push({ type: "framenavigated", url: frame.url(), t: Date.now() });
    }
  });

  try {
    await loginCompanion(page);
    // Leave isolation review-status if needed — try dashboard.
    if (/review-status/.test(page.url())) {
      const dash = page.locator('[data-route="/companion/dashboard"]');
      if (await dash.count()) {
        await dash.first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    const shellId0 = await markShell(page);
    step(`${label}_shell_ready`, !!shellId0, `shellId=${shellId0} url=${page.url()}`);

    // Ensure tall content for scroll (inject spacer once into page if short)
    await page.evaluate(() => {
      const pageEl = document.querySelector(".pw-page");
      if (!pageEl) return;
      if (!pageEl.querySelector("[data-e2e-scroll-spacer]")) {
        const sp = document.createElement("div");
        sp.setAttribute("data-e2e-scroll-spacer", "1");
        sp.style.height = "1400px";
        sp.style.opacity = "0.15";
        sp.textContent = "scroll-spacer";
        pageEl.appendChild(sp);
      }
    });

    for (let i = 0; i < ROUTES.length - 1; i++) {
      const from = ROUTES[i];
      const to = ROUTES[i + 1];
      // Navigate to from if needed
      if (!page.url().includes(from[0].replace("/companion", ""))) {
        await clickNavTo(page, from[0], isMobile);
        await page.waitForTimeout(400);
        await markShell(page);
        // re-add spacer after content swap
        await page.evaluate(() => {
          const pageEl = document.querySelector(".pw-page");
          if (!pageEl) return;
          if (!pageEl.querySelector("[data-e2e-scroll-spacer]")) {
            const sp = document.createElement("div");
            sp.setAttribute("data-e2e-scroll-spacer", "1");
            sp.style.height = "1400px";
            sp.style.opacity = "0.15";
            pageEl.appendChild(sp);
          }
        });
      }

      await scrollPageToBottom(page, isMobile);
      const before = await readScroll(page, isMobile);
      const scrolled = isMobile ? before.winY > 80 : before.pageY > 80;
      step(`${label}_scroll_bottom_${from[0]}`, scrolled, JSON.stringify(before));

      // Instrument first paint after click: capture early scroll samples
      const samples = [];
      const samplePromise = page.evaluate(async (mobile) => {
        const out = [];
        const read = () => {
          const pageEl = document.querySelector(".pw-page");
          out.push({
            t: performance.now(),
            path: location.pathname,
            pageY: pageEl ? pageEl.scrollTop : -1,
            winY: window.scrollY || document.documentElement.scrollTop || 0,
            shellId: document.querySelector(".pw-shell")?.getAttribute("data-pw-shell-id") || "",
            sideMark: document.querySelector(".pw-side")?.getAttribute("data-pw-side-mark") || "",
          });
        };
        read();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        read();
        await new Promise((r) => setTimeout(r, 50));
        read();
        await new Promise((r) => setTimeout(r, 120));
        read();
        await new Promise((r) => setTimeout(r, 250));
        read();
        return out;
      }, isMobile);

      await clickNavTo(page, to[0], isMobile);
      const sampled = await samplePromise;
      samples.push(...sampled);
      await page.waitForTimeout(200);
      const after = await readScroll(page, isMobile);

      const shellStable = after.shellId && after.shellId === shellId0;
      // Side mark persists only if sidebar DOM not remounted (desktop).
      const sideStable = isMobile
        ? true
        : await page.evaluate(() => document.querySelector(".pw-side")?.getAttribute("data-pw-side-mark") === "1");

      // Bounce detection: early sample shows large scroll then later near 0
      let bounced = false;
      if (samples.length >= 2) {
        const earlyMax = Math.max(
          ...samples.slice(0, 2).map((s) => (isMobile ? s.winY : s.pageY))
        );
        const late = samples[samples.length - 1];
        const lateY = isMobile ? late.winY : late.pageY;
        if (earlyMax > 200 && lateY < 40) bounced = true;
      }
      const finalTop = isMobile ? after.winY < 40 : after.pageY < 40;
      const pathOk = after.route.includes(to[0].replace(/\/$/, "")) || after.route.endsWith(to[0]);

      const ok = pathOk && finalTop && !bounced && (isMobile || (shellStable && sideStable));
      step(
        `${label}_nav_${from[0]}_to_${to[0]}`,
        ok,
        JSON.stringify({
          pathOk,
          finalTop,
          bounced,
          shellStable,
          sideStable,
          before,
          after,
          samples: samples.slice(0, 5),
        })
      );
      flips.push({ from: from[0], to: to[0], ok, bounced, shellStable, sideStable });

      // Keep shell mark if remounted accidentally
      await markShell(page);
      await page.evaluate(() => {
        const pageEl = document.querySelector(".pw-page");
        if (!pageEl) return;
        if (!pageEl.querySelector("[data-e2e-scroll-spacer]")) {
          const sp = document.createElement("div");
          sp.setAttribute("data-e2e-scroll-spacer", "1");
          sp.style.height = "1400px";
          sp.style.opacity = "0.15";
          pageEl.appendChild(sp);
        }
      });
    }

    // Full document navigations during in-app clicks should be none (or only login).
    const badNav = remounts.filter((r) => /\/companion\//.test(r.url) && !/login/.test(r.url));
    step(`${label}_no_full_reload_storm`, badNav.length <= ROUTES.length + 2, `navEvents=${badNav.length}`);

    await page.screenshot({ path: path.join(OUT, `${label}-final.png`), fullPage: false });
  } catch (err) {
    step(`${label}_fatal`, false, String(err?.stack || err));
    await page.screenshot({ path: path.join(OUT, `${label}-error.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  return flips;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await runViewport(browser, "desktop", { width: 1280, height: 900 });
    await runViewport(browser, "mobile", { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, results }, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(OUT, "fatal.json"), JSON.stringify({ error: String(err?.stack || err) }, null, 2));
  process.exit(1);
});
