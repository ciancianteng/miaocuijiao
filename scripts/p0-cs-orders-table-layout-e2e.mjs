/**
 * UI-only: CS orders table must not overflow the page at PC widths.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-cs-orders-table-layout-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "cs-orders-table-layout-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "cs-orders-table-layout-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-cs-token": token } : {}),
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

async function main() {
  console.log("BASE", BASE);
  // Wait for deploy containing layout markers
  let deployed = false;
  for (let i = 0; i < 20; i++) {
    const html = await (await fetch(`${BASE}/customer-service/orders/?cb=${Date.now()}`, { cache: "no-store" })).text();
    const asset = (html.match(/\/assets\/customer-service[^"]+\.js/) || html.match(/customer-service-v2\.js[^"]*/))?.[0] || "";
    let js = "";
    if (asset.startsWith("/assets/")) js = await (await fetch(`${BASE}${asset}`, { cache: "no-store" })).text();
    else if (/customer-service-v2\.js/.test(html)) {
      const src = (html.match(/src="([^"]*customer-service-v2\.js[^"]*)"/) || [])[1];
      if (src) js = await (await fetch(src.startsWith("http") ? src : `${BASE}${src.startsWith("/") ? "" : "/"}${src}`, { cache: "no-store" })).text();
    }
    if (/fmtOrderDateTime|cs-orders-table-wrap|cs-proof-thumb/.test(js + html)) {
      deployed = true;
      step("deploy_marker", true, asset || "html/src");
      break;
    }
    console.log("waiting deploy", i + 1);
    await new Promise((r) => setTimeout(r, 12000));
  }
  if (!deployed) step("deploy_marker", false, "layout markers not found");

  let login = await api("/api/customer-service", null, { action: "login", account: CS_EMAIL, email: CS_EMAIL, password: PASS, remember: true });
  if (!tok(login.json)) {
    login = await api("/api/auth", null, { action: "login", email: CS_EMAIL, password: PASS, loginPortal: "customer_service" });
  }
  const token = tok(login.json);
  const sessionPayload = login.json?.session || { token, accessToken: token, user: login.json?.user || { email: CS_EMAIL, role: "customer_service" } };
  step("cs_login", !!token, CS_EMAIL);
  if (!token) {
    fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const chrome =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "/usr/local/bin/google-chrome");
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  async function seedCsSession(context) {
    await context.addInitScript(
      ({ session, token, email }) => {
        const raw = Object.assign({}, session || {}, {
          token: token || session?.token || session?.accessToken,
          accessToken: token || session?.accessToken || session?.token,
          user: Object.assign({ email, role: "customer_service" }, session?.user || {}),
        });
        localStorage.setItem("mcjServiceSession", JSON.stringify(raw));
        sessionStorage.setItem("mcjServiceSession", JSON.stringify(raw));
        localStorage.setItem("customerServiceAuthToken", raw.token || token);
        localStorage.setItem("mcjAuthAccessToken", raw.token || token);
        localStorage.setItem("mcjRole", "customer_service");
        localStorage.setItem("customerServiceUser", JSON.stringify(raw.user || { email, role: "customer_service" }));
        localStorage.setItem("customerUser", JSON.stringify(raw.user || { email, role: "customer_service", name: "CS E2E" }));
      },
      { session: sessionPayload, token, email: CS_EMAIL }
    );
  }

  const widths = [1366, 1440, 1920];
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "zh-CN" });
    await seedCsSession(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-service/orders/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);
    // Navigate via in-app orders button if still on login/dashboard
    if (!(await page.locator(".cs-orders-table, .cs-table").count())) {
      await page.locator('button:has-text("订单处理"), [data-route*="orders"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const wrap = document.querySelector(".cs-orders-table-wrap, .cs-table-wrap");
      const table = document.querySelector(".cs-orders-table, .cs-table");
      const actions = document.querySelector(".cs-col-actions, .cs-actions");
      const actionCell = document.querySelector("td.cs-col-actions, .cs-table tbody td:last-child");
      const timeCell = document.querySelector("td.cs-col-time, .cs-table tbody tr td:nth-child(7)");
      const thumb = document.querySelector(".cs-proof-thumb, .cs-proof-preview img");
      const pageEl = document.querySelector(".cs-page");
      const btns = [...document.querySelectorAll("td.cs-col-actions .cs-btn, .cs-table tbody td:last-child .cs-btn")].slice(0, 6);
      const btnBox = btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim().slice(0, 20), right: r.right, bottom: r.bottom, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
      });
      return {
        scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
        clientWidth: doc.clientWidth,
        pageOverflowX: pageEl ? pageEl.scrollWidth > pageEl.clientWidth + 2 : null,
        wrapScrollable: wrap ? wrap.scrollWidth >= wrap.clientWidth : null,
        wrapClient: wrap ? Math.round(wrap.clientWidth) : 0,
        wrapScroll: wrap ? Math.round(wrap.scrollWidth) : 0,
        tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
        actionsRight: actionCell ? Math.round(actionCell.getBoundingClientRect().right) : -1,
        actionsVisible: actionCell
          ? (() => {
              const r = actionCell.getBoundingClientRect();
              return r.width > 40 && r.right <= window.innerWidth + 1 && r.left >= 0;
            })()
          : false,
        timeText: timeCell ? timeCell.textContent.trim() : "",
        thumbW: thumb ? Math.round(thumb.getBoundingClientRect().width) : null,
        thumbH: thumb ? Math.round(thumb.getBoundingClientRect().height) : null,
        hasOrdersTable: !!document.querySelector(".cs-orders-table"),
        btnBox,
        bodyTextSample: document.body.innerText.slice(0, 120),
      };
    });
    const noPageOverflow = metrics.scrollWidth <= metrics.clientWidth + 2;
    const timeOk = !metrics.timeText || metrics.timeText === "-" || (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(metrics.timeText) && !/\.\d|\+00:00|Z/.test(metrics.timeText));
    const thumbOk = metrics.thumbW == null || (metrics.thumbW <= 56 && metrics.thumbH <= 56);
    const actionsOk = metrics.actionsVisible || metrics.btnBox.some((b) => b.visible && b.right <= width + 1);

    step(`no_page_overflow_${width}`, noPageOverflow, JSON.stringify({ scrollWidth: metrics.scrollWidth, clientWidth: metrics.clientWidth, wrap: [metrics.wrapClient, metrics.wrapScroll] }));
    step(`actions_visible_${width}`, actionsOk, JSON.stringify({ actionsRight: metrics.actionsRight, btnBox: metrics.btnBox, hasTable: metrics.hasOrdersTable }));
    step(`time_format_${width}`, timeOk, metrics.timeText || "(no rows)");
    step(`thumb_size_${width}`, thumbOk, JSON.stringify({ w: metrics.thumbW, h: metrics.thumbH }));

    const shot = path.join(ART, `orders-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    fs.copyFileSync(shot, path.join(ART_REPO, `orders-${width}.png`));
    await context.close();
  }

  // Click smoke: open first action button if present at 1440
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    await seedCsSession(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-service/orders/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);
    if (!(await page.locator(".cs-orders-table, .cs-table").count())) {
      await page.locator('button:has-text("订单处理"), [data-route*="orders"]').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector("td.cs-col-actions .cs-btn, .cs-table tbody td:last-child .cs-btn");
      if (!btn) return { ok: false, reason: "no-btn" };
      btn.click();
      return { ok: true, text: btn.textContent.trim().slice(0, 30) };
    });
    await page.waitForTimeout(800);
    const modalOrNav = await page.evaluate(() => ({
      modal: !!document.querySelector(".cs-modal, .cs-dialog"),
      stillOrders: /订单处理/.test(document.body.innerText),
    }));
    step("action_button_clickable", clicked.ok, JSON.stringify({ clicked, modalOrNav }));
    await page.screenshot({ path: path.join(ART, "action-click.png"), fullPage: true });
    fs.copyFileSync(path.join(ART, "action-click.png"), path.join(ART_REPO, "action-click.png"));
    await context.close();
  }

  await browser.close();
  const summary = { base: BASE, results, passCount: results.filter((r) => r.result === "PASS").length, failCount: results.filter((r) => r.result === "FAIL").length };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failCount) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
