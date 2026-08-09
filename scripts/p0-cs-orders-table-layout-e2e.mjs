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
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 700) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function loginCs(page) {
  await page.goto(`${BASE}/customer-service/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('input[name="account"]', { timeout: 30000 });
  await page.fill('input[name="account"]', CS_EMAIL);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL(/\/customer-service\/(dashboard|orders|conversations)/i, { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
}

async function openOrders(page) {
  // Prefer in-app nav so bootstrap state is preserved (full reload can briefly paint empty).
  const nav = page.locator('.cs-nav button:has-text("订单处理")');
  if (await nav.count()) {
    await nav.first().click();
  } else {
    await page.goto(`${BASE}/customer-service/orders/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  }
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll(".cs-orders-table tbody tr, table.cs-table tbody tr");
    if (!rows.length) return false;
    const text = rows[0].innerText || "";
    return !/暂无订单/.test(text) || rows.length > 1;
  }, { timeout: 45000 }).catch(() => {});
  await page.waitForSelector(".cs-orders-table, table.cs-table", { timeout: 30000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const wrap = document.querySelector(".cs-orders-table-wrap") || document.querySelector(".cs-table-wrap");
    const table = document.querySelector(".cs-orders-table") || document.querySelector("table.cs-table");
    const actionCell = document.querySelector("td.cs-col-actions") || document.querySelector(".cs-table tbody td:last-child");
    const timeCell = document.querySelector("td.cs-col-time") || document.querySelector(".cs-table tbody tr td:nth-child(7)");
    const thumb = document.querySelector(".cs-proof-thumb") || document.querySelector(".cs-proof-preview img");
    const btns = [...document.querySelectorAll("td.cs-col-actions .cs-btn, .cs-table tbody td:last-child .cs-btn")].slice(0, 8).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent.trim().slice(0, 24),
        right: Math.round(r.right),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
        inViewport: r.right <= window.innerWidth + 1 && r.left >= 0,
      };
    });
    const ar = actionCell ? actionCell.getBoundingClientRect() : null;
    return {
      url: location.href,
      route: document.querySelector(".cs-page")?.getAttribute("data-route") || "",
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clientWidth: doc.clientWidth,
      hasOrdersTable: !!document.querySelector(".cs-orders-table"),
      hasTable: !!table,
      wrapClient: wrap ? Math.round(wrap.clientWidth) : 0,
      wrapScroll: wrap ? Math.round(wrap.scrollWidth) : 0,
      wrapInternalScrollOnly: wrap ? wrap.scrollWidth > wrap.clientWidth + 2 : false,
      actionsRight: ar ? Math.round(ar.right) : -1,
      actionsVisible: !!(ar && ar.width > 40 && ar.right <= window.innerWidth + 1),
      timeText: timeCell ? timeCell.textContent.trim() : "",
      thumbW: thumb ? Math.round(thumb.getBoundingClientRect().width) : null,
      thumbH: thumb ? Math.round(thumb.getBoundingClientRect().height) : null,
      btns,
      rowCount: document.querySelectorAll(".cs-table tbody tr").length,
    };
  });
}

async function main() {
  console.log("BASE", BASE);

  // Confirm deploy markers in hashed CSS/JS
  const html = await (await fetch(`${BASE}/customer-service/orders/?cb=${Date.now()}`, { cache: "no-store" })).text();
  const cssHref = (html.match(/href="(\/assets\/customer-service-v2-[^"]+\.css)"/) || [])[1];
  const jsHref = (html.match(/href="(\/assets\/customer-service-v2-[^"]+\.js)"/) || html.match(/src="(\/assets\/customer-service-v2-[^"]+\.js)"/) || [])[1]
    || (html.match(/href="(\/assets\/customer-service-v2-[^"]+\.js)"/) || [])[1];
  const css = cssHref ? await (await fetch(`${BASE}${cssHref}`, { cache: "no-store" })).text() : "";
  const js = jsHref ? await (await fetch(`${BASE}${jsHref}`, { cache: "no-store" })).text() : "";
  step(
    "deploy_marker",
    /cs-orders-table-wrap/.test(css + js + html) && /cs-proof-thumb|cs-col-actions/.test(css + js + html),
    `css=${cssHref || "none"} js=${jsHref || "none"}`
  );

  const chrome =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "/usr/local/bin/google-chrome");
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // One authenticated context, then resize across PC widths
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  await loginCs(page);
  step("cs_login", /\/customer-service\//.test(page.url()) && !/\/login/.test(page.url()), page.url());
  await openOrders(page);
  step("orders_page_loaded", !!(await page.locator(".cs-orders-table, table.cs-table").count()), page.url());

  for (const width of [1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(600);
    const m = await measure(page);
    const noPageOverflow = m.scrollWidth <= m.clientWidth + 2;
    const timeOk =
      !m.timeText ||
      m.timeText === "-" ||
      (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(m.timeText) && !/\.\d|\+00:00|Z/.test(m.timeText));
    const thumbOk = m.thumbW == null || (m.thumbW <= 56 && m.thumbH <= 56);
    const actionsOk =
      m.actionsVisible ||
      m.btns.some((b) => b.visible && b.inViewport) ||
      (m.rowCount > 0 && m.hasTable && m.actionsRight > 0 && m.actionsRight <= width + 1);

    step(`no_page_overflow_${width}`, noPageOverflow, JSON.stringify({ scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, wrap: [m.wrapClient, m.wrapScroll], internal: m.wrapInternalScrollOnly }));
    step(`actions_visible_${width}`, actionsOk && m.hasTable, JSON.stringify({ actionsRight: m.actionsRight, btns: m.btns, hasOrdersTable: m.hasOrdersTable, rows: m.rowCount }));
    step(`time_format_${width}`, timeOk, m.timeText || "(no time cell)");
    step(`thumb_size_${width}`, thumbOk, JSON.stringify({ w: m.thumbW, h: m.thumbH }));
    await shot(page, `orders-${width}`);
  }

  // Click smoke — first action button still works
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector("td.cs-col-actions .cs-btn, .cs-table tbody td:last-child .cs-btn");
    if (!btn) return { ok: false, reason: "no-btn" };
    btn.click();
    return { ok: true, text: btn.textContent.trim().slice(0, 40) };
  });
  await page.waitForTimeout(900);
  const afterClick = await page.evaluate(() => ({
    modal: !!document.querySelector(".cs-modal, .cs-dialog"),
    stillApp: !!document.querySelector(".cs-shell, .cs-page"),
    text: document.body.innerText.slice(0, 160),
  }));
  step("action_button_clickable", clicked.ok && afterClick.stillApp, JSON.stringify({ clicked, afterClick }));
  await shot(page, "action-click");

  await browser.close();
  const summary = {
    base: BASE,
    results,
    passCount: results.filter((r) => r.result === "PASS").length,
    failCount: results.filter((r) => r.result === "FAIL").length,
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failCount) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
