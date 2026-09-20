/**
 * Capture Reference-B layout screenshots for Mobile App Prototype.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.PROTO_BASE || "http://127.0.0.1:5179/";
const OUT = path.join(__dirname, "..", "docs", "mobile-app-proto-screenshots");
fs.mkdirSync(OUT, { recursive: true });

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("Chrome/Edge not found");
}

async function waitReady(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2800);
}

async function shotViewport(page, width, height, prefix) {
  await page.setViewportSize({ width, height });
  await waitReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `${prefix}-first-screen.png`), fullPage: false });

  // Hero + banner region
  await page.screenshot({ path: path.join(OUT, `${prefix}-hero-banner.png`), fullPage: false });

  // Advance carousel if possible
  await page.evaluate(() => {
    const dots = document.querySelectorAll(".mcj-home-hero--promo .mcj-hero-dots button");
    if (dots[1]) dots[1].click();
  });
  await page.waitForTimeout(800);
  const banner = await page.$("[data-mcj-home-hero]");
  if (banner) {
    await banner.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${prefix}-banner-slide2.png`), fullPage: false });
  }

  const ann = await page.$("#homeAnnouncementBar");
  if (ann) {
    await ann.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${prefix}-announcement.png`), fullPage: false });
  }

  const stats = await page.$("[data-home-daily-stats]");
  if (stats) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${prefix}-stats.png`), fullPage: false });
  }

  const hot = await page.$("#hotCompanionTrack");
  if (hot) {
    await hot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${prefix}-companions.png`), fullPage: false });
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    mascotSrc: (document.querySelector(".home-brand-hero-mascot") || {}).currentSrc || "",
    bannerH: (document.querySelector("[data-mcj-home-hero]") || {}).clientHeight || 0,
    mascotW: (document.querySelector(".home-brand-hero-mascot") || {}).clientWidth || 0,
    order: {
      hero: !!document.querySelector("[data-home-brand-hero]"),
      banner: !!document.querySelector("[data-mcj-home-hero]"),
      ann: !!document.querySelector("#homeAnnouncementBar"),
    },
  }));
  fs.writeFileSync(path.join(OUT, `${prefix}-meta.json`), JSON.stringify(overflow, null, 2));
  return overflow;
}

(async () => {
  const browser = await chromium.launch({ executablePath: await findChrome(), headless: true });
  const page = await browser.newPage();
  const widths = [
    [320, 720, "w320"],
    [360, 780, "w360"],
    [390, 844, "real-390"],
    [412, 915, "w412"],
    [430, 932, "real-430"],
  ];
  const results = {};
  for (const [w, h, name] of widths) results[name] = await shotViewport(page, w, h, name);

  await page.setViewportSize({ width: 1440, height: 900 });
  await waitReady(page);
  await page.screenshot({ path: path.join(OUT, "desktop-1440-top.png"), fullPage: false });

  // Interaction probes
  const interact = await page.evaluate(() => {
    const banner = document.querySelector(".mcj-home-hero--promo .mcj-hero-image-link, .mcj-home-hero--promo a");
    const mascot = document.querySelector(".home-brand-hero-visual");
    const cs = getComputedStyle(mascot || document.body);
    return {
      bannerPointer: banner ? getComputedStyle(banner).pointerEvents : "missing",
      mascotPointer: cs.pointerEvents,
      bannerZ: banner ? getComputedStyle(banner.closest(".mcj-home-hero") || banner).zIndex : null,
    };
  });
  fs.writeFileSync(path.join(OUT, "interaction-meta.json"), JSON.stringify(interact, null, 2));

  await browser.close();
  console.log(JSON.stringify({ out: OUT, results, interact, files: fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
