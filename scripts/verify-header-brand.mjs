import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/verify-header-brand.mjs <preview-url>");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "tmp-header-brand-shots");
fs.mkdirSync(outDir, { recursive: true });

const widths = [1440, 1024, 768, 390];
const browser = await chromium.launch();
const results = [];

for (const w of widths) {
  const h = w >= 900 ? 900 : 844;
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: w <= 768,
    hasTouch: w <= 768,
  });
  const page = await context.newPage();
  await page.goto(base.replace(/\/$/, "") + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const brand = document.querySelector(".mcj-header-brand");
    const logo = document.querySelector(".mcj-header-brand-logo");
    const en = document.querySelector(".mcj-header-brand-en");
    const zh = document.querySelector(".mcj-header-brand-zh");
    const desk = document.querySelector(".mcj-desk-nav");
    const toggle = document.querySelector("[data-mcj-mnav-toggle]");
    const header = document.querySelector("header.mcj-boss-header");
    const hero = document.querySelector(".mcj-home-hero, [data-mcj-home-hero]");
    const bs = brand ? getComputedStyle(brand) : null;
    const hs = header ? getComputedStyle(header) : null;
    const br = brand ? brand.getBoundingClientRect() : null;
    const hr = header ? header.getBoundingClientRect() : null;
    const her = hero ? hero.getBoundingClientRect() : null;
    return {
      brandHref: brand && brand.getAttribute("href"),
      brandDisplay: bs && bs.display,
      brandVisibility: bs && bs.visibility,
      brandOpacity: bs && bs.opacity,
      logoVisible: !!(logo && getComputedStyle(logo).display !== "none" && logo.getBoundingClientRect().width > 0),
      logoH: logo ? Math.round(logo.getBoundingClientRect().height) : 0,
      enText: en && en.textContent.trim(),
      enVisible: !!(en && getComputedStyle(en).display !== "none" && en.getBoundingClientRect().height > 0),
      zhText: zh && zh.textContent.trim(),
      zhVisible: !!(zh && getComputedStyle(zh).display !== "none" && zh.getBoundingClientRect().height > 0),
      deskVisible: !!(desk && getComputedStyle(desk).display !== "none"),
      toggleVisible: !!(toggle && getComputedStyle(toggle).display !== "none" && toggle.getBoundingClientRect().width > 0),
      headerZ: hs && hs.zIndex,
      headerBottom: hr ? Math.round(hr.bottom) : null,
      heroTop: her ? Math.round(her.top) : null,
      brandLeft: br ? Math.round(br.left) : null,
      hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });

  let menuOk = true;
  if (w < 900) {
    await page.locator("[data-mcj-mnav-toggle]").click();
    await page.waitForTimeout(300);
    menuOk = await page.evaluate(() => {
      const sheet = document.getElementById("mcjMnavSheet");
      return !!(sheet && !sheet.hidden && sheet.classList.contains("open"));
    });
    await page.locator("[data-mcj-mnav-close]").click().catch(() => {});
  }

  const shot = path.join(outDir, "header-" + w + ".png");
  await page.screenshot({ path: shot, fullPage: false });

  const pass =
    info.brandDisplay !== "none" &&
    info.brandVisibility !== "hidden" &&
    Number(info.brandOpacity) > 0 &&
    info.logoVisible &&
    info.logoH >= 36 &&
    info.logoH <= 44 &&
    info.zhVisible &&
    info.zhText === "妙脆角" &&
    (info.brandHref === "/" || /index\.html/.test(String(info.brandHref || ""))) &&
    !info.hScroll &&
    (info.heroTop == null || info.headerBottom <= info.heroTop + 1) &&
    (w >= 900
      ? info.deskVisible && info.enVisible && info.enText === "MEOW CUI JIAO" && !info.toggleVisible
      : info.toggleVisible && menuOk && (w > 520 ? info.enVisible : true));

  results.push({ w, pass, menuOk, info, shot });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
