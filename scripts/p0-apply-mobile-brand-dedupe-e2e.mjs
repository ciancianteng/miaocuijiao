/**
 * Mobile apply page: brand appears once under site header; menu overlay OK; no H-overflow.
 * Usage: node scripts/p0-apply-mobile-brand-dedupe-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const ART = path.join("/opt/cursor/artifacts", "apply-mobile-brand-dedupe");
const CHROME =
  process.env.CHROME_PATH ||
  "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
  return ok;
}

async function main() {
  // Guest session: #105 auth gate must still show create/login before apply steps.
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    channel: fs.existsSync(CHROME) ? undefined : "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const iphone = devices["iPhone 13"];
  const context = await browser.newContext({
    ...iphone,
    locale: "zh-CN",
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1200);

  // A: menu closed
  const closedShot = path.join(ART, "A-menu-closed-iphone.png");
  await page.screenshot({ path: closedShot, fullPage: false });
  step("A_menu_closed_screenshot", fs.existsSync(closedShot), closedShot);

  const metrics = await page.evaluate(() => {
    const headerBrand = document.querySelector(".mcj-header-brand, .mcj-site-header .brand, header .mcj-header-brand");
    const applyBrand = document.querySelector(".apply-brand");
    const applyBrandStyle = applyBrand ? getComputedStyle(applyBrand) : null;
    const applyBrandVisible =
      !!applyBrand &&
      applyBrandStyle.display !== "none" &&
      applyBrandStyle.visibility !== "hidden" &&
      applyBrandStyle.opacity !== "0" &&
      applyBrand.getBoundingClientRect().height > 0;

    const headerLogoDup = document.querySelectorAll(".mcj-header-brand img, .mcj-header-logo, .apply-brand img");
    const visibleBrandLogos = Array.from(headerLogoDup).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.height > 0 && r.width > 0 && s.display !== "none" && s.visibility !== "hidden" && r.top < 120;
    });

    const backBtn = Array.from(document.querySelectorAll("a,button")).find((el) =>
      /返回首页/.test(el.textContent || "")
    );
    const hero = document.querySelector(".apply-hero h1, .apply-hero");
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
    const header = document.querySelector(".mcj-site-header, header.mcj-header, .mcj-header, [data-mcj-header]");
    const authGateText = document.body.innerText || "";

    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      overflowX,
      applyBrandVisible,
      applyBrandDisplay: applyBrandStyle?.display || null,
      headerPresent: !!header || !!headerBrand,
      headerBrandText: (headerBrand?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      visibleBrandLogoCount: visibleBrandLogos.length,
      backY: backBtn ? Math.round(backBtn.getBoundingClientRect().top) : null,
      heroY: hero ? Math.round(hero.getBoundingClientRect().top) : null,
      heroText: (hero?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      authGate105:
        /先创建\s*\/\s*登录陪玩账号/.test(authGateText) &&
        /注册新陪玩/.test(authGateText) &&
        /已有账号登录/.test(authGateText),
    };
  });

  step("D_no_duplicate_apply_brand", !metrics.applyBrandVisible, JSON.stringify({
    applyBrandDisplay: metrics.applyBrandDisplay,
    applyBrandVisible: metrics.applyBrandVisible,
  }));
  step("D_header_brand_present", metrics.headerPresent, metrics.headerBrandText || "header ok");
  step("D_brand_logo_once_near_top", metrics.visibleBrandLogoCount === 1, JSON.stringify({
    visibleBrandLogoCount: metrics.visibleBrandLogoCount,
  }));
  step("C_no_horizontal_overflow", !metrics.overflowX, JSON.stringify({
    vw: metrics.vw,
    scrollWidth: metrics.scrollWidth,
  }));
  step("A_back_home_near_hero", metrics.backY != null && metrics.heroY != null && metrics.heroY - metrics.backY < 120, JSON.stringify({
    backY: metrics.backY,
    heroY: metrics.heroY,
    heroText: metrics.heroText,
  }));
  step("E_105_auth_gate_visible", metrics.authGate105, metrics.heroText || "auth gate");

  // B: open menu
  const menuBtn = page.locator('button.mcj-mnav-toggle, button[data-mcj-mnav-toggle], button[aria-label="打开菜单"]').first();
  await menuBtn.click({ timeout: 8000 });
  await page.waitForTimeout(700);

  const openShot = path.join(ART, "B-menu-open-iphone.png");
  await page.screenshot({ path: openShot, fullPage: false });
  step("B_menu_open_screenshot", fs.existsSync(openShot), openShot);

  const menuState = await page.evaluate(() => {
    const drawer = document.querySelector("[data-mcj-mnav-drawer], .mcj-mnav-drawer");
    const closeBtn = document.querySelector("[data-mcj-mnav-close], .mcj-mnav-close");
    const open =
      document.documentElement.classList.contains("mcj-mnav-open") ||
      document.body.classList.contains("mcj-mnav-open") ||
      (!!drawer && getComputedStyle(drawer).visibility !== "hidden" && drawer.getBoundingClientRect().width > 80);
    return {
      open,
      drawerClass: drawer?.className || null,
      closePresent: !!closeBtn,
      closeLabel: closeBtn?.getAttribute("aria-label") || closeBtn?.textContent || null,
      bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  step("B_menu_overlay_visible", menuState.open, JSON.stringify(menuState));
  step("B_menu_close_control", menuState.closePresent, JSON.stringify({ closePresent: menuState.closePresent, closeLabel: menuState.closeLabel }));
  step("C_no_overflow_with_menu_open", !menuState.bodyOverflowX, JSON.stringify(menuState));

  await page.locator('button.mcj-mnav-close, button[data-mcj-mnav-close], button[aria-label="关闭菜单"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(500);

  const afterClose = path.join(ART, "E-after-menu-close-iphone.png");
  await page.screenshot({ path: afterClose, fullPage: false });
  const closedAgain = await page.evaluate(() => {
    const drawer = document.querySelector("[data-mcj-mnav-drawer], .mcj-mnav-drawer");
    const stillOpen =
      document.documentElement.classList.contains("mcj-mnav-open") ||
      document.body.classList.contains("mcj-mnav-open");
    const w = drawer ? drawer.getBoundingClientRect().width : 0;
    return { stillOpen, drawerWidth: w };
  });
  step("E_menu_closed_after_close_btn", !closedAgain.stillOpen && closedAgain.drawerWidth < 40, JSON.stringify(closedAgain));
  step("E_menu_close_screenshot", fs.existsSync(afterClose), afterClose);

  // Desktop sanity: apply-brand still visible at wide viewport (no unnecessary desktop change)
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dpage = await desk.newPage();
  await dpage.goto(`${BASE}/companion-apply.html`, { waitUntil: "networkidle", timeout: 90000 });
  await dpage.waitForTimeout(800);
  const deskMetrics = await dpage.evaluate(() => {
    const applyBrand = document.querySelector(".apply-brand");
    const s = applyBrand ? getComputedStyle(applyBrand) : null;
    return {
      visible:
        !!applyBrand &&
        s.display !== "none" &&
        applyBrand.getBoundingClientRect().height > 0,
      display: s?.display || null,
    };
  });
  const deskShot = path.join(ART, "desktop-brand-still-present.png");
  await dpage.screenshot({ path: deskShot, fullPage: false });
  step("desktop_apply_brand_still_visible", deskMetrics.visible, JSON.stringify(deskMetrics));

  await desk.close();
  await browser.close();

  const summary = {
    base: BASE,
    art: ART,
    results,
    pass: results.every((r) => r.result === "PASS"),
  };
  fs.writeFileSync(path.join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
