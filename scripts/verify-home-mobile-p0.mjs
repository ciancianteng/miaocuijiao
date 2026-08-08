import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/verify-home-mobile-p0.mjs <preview-url>");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "tmp-home-mobile-p0");
fs.mkdirSync(outDir, { recursive: true });
const widths = [360, 375, 390, 414, 430];
const browser = await chromium.launch();
const results = [];

for (const w of widths) {
  const context = await browser.newContext({
    viewport: { width: w, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(base.replace(/\/$/, "") + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const header = document.querySelector("header.mcj-boss-header");
    const inner = document.querySelector(".mcj-boss-header-inner");
    const toggle = document.querySelector("[data-mcj-mnav-toggle]");
    const brand = document.querySelector(".mcj-header-brand");
    const logo = document.querySelector(".mcj-header-brand-logo");
    const hero = document.querySelector(".mcj-home-hero, [data-mcj-home-hero]");
    const ann = document.querySelector("#homeAnnouncementBar");
    const card = document.querySelector(".home-daily-card");
    const meta = document.querySelector("[data-home-daily-stats] .compact-title p, [data-home-daily-stats] .section-title p");
    const hr = header?.getBoundingClientRect();
    const tr = toggle?.getBoundingClientRect();
    const br = brand?.getBoundingClientRect();
    const lr = logo?.getBoundingClientRect();
    const her = hero?.getBoundingClientRect();
    const cr = card?.getBoundingClientRect();
    const overlapLogo = tr && lr && !(tr.right <= lr.left + 1 || tr.left >= lr.right - 1 || tr.bottom <= lr.top + 1 || tr.top >= lr.bottom - 1);
    const overBanner = tr && her && tr.bottom > her.top + 2 && tr.top < her.bottom;
    return {
      headerH: hr ? Math.round(hr.height) : 0,
      padL: inner ? getComputedStyle(inner).paddingLeft : null,
      toggleLeft: tr ? Math.round(tr.left) : null,
      brandLeft: br ? Math.round(br.left) : null,
      logoLeft: lr ? Math.round(lr.left) : null,
      toggleBeforeLogo: !!(tr && lr && tr.right <= lr.left + 2),
      overlapLogo: !!overlapLogo,
      overBanner: !!overBanner,
      heroTop: her ? Math.round(her.top) : null,
      headerBottom: hr ? Math.round(hr.bottom) : null,
      gapHeaderHero: her && hr ? Math.round(her.top - hr.bottom) : null,
      cardH: cr ? Math.round(cr.height) : null,
      metaText: meta ? meta.textContent.trim() : "",
      hasTimezone: meta ? /Asia|Kuala/i.test(meta.textContent) : false,
      hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      vw: innerWidth,
    };
  });

  await page.locator("[data-mcj-mnav-toggle]").click();
  await page.waitForTimeout(250);
  const menuOpen = await page.evaluate(() => {
    const sheet = document.getElementById("mcjMnavSheet");
    return !!(sheet && !sheet.hidden && sheet.classList.contains("open"));
  });
  await page.locator("[data-mcj-mnav-close]").click().catch(() => {});

  const shot = path.join(outDir, "home-" + w + ".png");
  await page.screenshot({ path: shot, fullPage: false });

  const pass =
    info.headerH >= 56 &&
    info.headerH <= 72 &&
    info.toggleBeforeLogo &&
    !info.overlapLogo &&
    !info.overBanner &&
    info.gapHeaderHero != null &&
    info.gapHeaderHero >= 12 &&
    info.gapHeaderHero <= 28 &&
    !info.hasTimezone &&
    /最后更新|今日实时/.test(info.metaText || "最后更新") &&
    (info.cardH == null || (info.cardH >= 60 && info.cardH <= 90)) &&
    !info.hScroll &&
    menuOpen;

  results.push({ w, pass, menuOpen, info, shot });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
