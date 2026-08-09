/**
 * P0 UI: Admin 订单管理 — 操作列收敛为「管理 ▼」菜单（不测业务写操作）。
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-admin-orders-manage-menu-e2e.mjs
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
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "admin-orders-manage-menu-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "admin-orders-manage-menu-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  const p2 = path.join(ART_REPO, file);
  await page.screenshot({ path: p1, fullPage: false });
  fs.copyFileSync(p1, p2);
  return p1;
}

async function loginAdminUi(page) {
  await page.goto(`${BASE}/admin/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  await page.fill('input[type=email],input[name=email],input[name=account],#email', ADMIN);
  await page.fill('input[type=password]', PASS);
  await page.click('button[type=submit],button:has-text("登录")');
  await page.waitForURL(/admin\.html/, { timeout: 30000 });
  await page.waitForSelector('[data-section="orders"]', { timeout: 30000 });
}

async function openOrders(page) {
  await page.locator('[data-section="orders"]').first().click({ timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const sec = document.getElementById("section-orders");
    if (sec) {
      sec.classList.add("active");
      sec.style.display = "block";
      sec.hidden = false;
    }
    document.querySelectorAll("[data-section]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-section") === "orders")
    );
  });
  await page.waitForFunction(() => {
    const t = document.querySelector("#orderManagement");
    if (!t || t.querySelector(".content-loading")) return false;
    const table = t.querySelector(".admin-orders-table") || t.querySelector(".admin-final-table");
    if (!table) return false;
    const r = table.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, null, { timeout: 45000 });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await loginAdminUi(page);
    await openOrders(page);
    await shot(page, "01-orders-default");

    const toggles = page.locator("[data-admin-order-manage-toggle]");
    const n = await toggles.count();
    step("has-manage-toggles", n > 0, `count=${n}`);

    const inlineStatus = await page.locator("#orderManagement .admin-orders-table [data-admin-order-status-apply]").count();
    step("no-inline-status-in-rows", inlineStatus === 0, `inlineStatusApply=${inlineStatus}`);

    const inlineDelete = await page.locator("#orderManagement .admin-orders-table tbody [data-admin-order-delete]").count();
    step("no-inline-delete-in-rows", inlineDelete === 0, `inlineDelete=${inlineDelete}`);

    const times = await page.locator("#orderManagement .admin-orders-table .admin-orders-col-time").allTextContents();
    const badTime = times.find((t) => /T\d{2}:\d{2}:\d{2}/.test(t) || /\+00:00/.test(t));
    step("time-format", !badTime, badTime ? `bad=${badTime}` : `samples=${times.slice(0, 3).join("|")}`);

    const nos = await page.locator("#orderManagement .admin-orders-table .admin-orders-col-no").allTextContents();
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    const badNo = nos.find((t) => uuidRe.test(t));
    step("no-uuid-in-order-col", !badNo, badNo ? `bad=${badNo}` : `samples=${nos.slice(0, 3).join("|")}`);

    if (n > 0) {
      await toggles.nth(0).evaluate((el) => el.click());
      await page.waitForSelector(".admin-order-manage-popover button[data-admin-order-detail]", { timeout: 5000 });
      await shot(page, "02-manage-open");
      const menuItems = await page.locator(".admin-order-manage-popover button[role='menuitem']").count();
      const hasDetail = (await page.locator(".admin-order-manage-popover [data-admin-order-detail]").count()) > 0;
      const hasStatus = (await page.locator(".admin-order-manage-popover [data-admin-order-status-apply]").count()) > 0;
      step("menu-opened", menuItems > 0 && hasDetail && hasStatus, `items=${menuItems} detail=${hasDetail} status=${hasStatus}`);

      if (n > 1) {
        await toggles.nth(1).evaluate((el) => el.click());
        await page.waitForTimeout(300);
        const openMenus = await page.locator(".admin-order-manage-popover").count();
        const openToggles = await page.locator("[data-admin-order-manage-toggle].is-open").count();
        step("one-at-a-time", openMenus === 1 && openToggles === 1, `menus=${openMenus} openToggles=${openToggles}`);
      } else {
        step("one-at-a-time", true, "only one order row; skipped second toggle");
      }

      await page.evaluate(() => document.body.click());
      await page.waitForTimeout(250);
      const afterOutside = await page.locator(".admin-order-manage-popover").count();
      step("outside-closes", afterOutside === 0, `menus=${afterOutside}`);
    }

    // Overflow checks at common PC widths
    for (const w of [1366, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { sw: el.scrollWidth, cw: el.clientWidth, body: document.body.scrollWidth };
      });
      step(`no-page-overflow-${w}`, overflow.sw <= overflow.cw + 2, JSON.stringify(overflow));
    }
    await shot(page, "03-viewport-1920");
  } catch (err) {
    step("fatal", false, err?.message || String(err));
    try {
      await shot(page, "99-fatal");
    } catch (_) {}
  } finally {
    const summary = path.join(ART, "summary.json");
    fs.writeFileSync(summary, JSON.stringify({ base: BASE, results }, null, 2));
    fs.copyFileSync(summary, path.join(ART_REPO, "summary.json"));
    await browser.close();
    const failed = results.some((r) => r.result === "FAIL");
    console.log(failed ? "OVERALL FAIL" : "OVERALL PASS");
    process.exit(failed ? 1 : 0);
  }
}

main();
