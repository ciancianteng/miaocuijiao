/**
 * Capture Mobile App Prototype screenshots at 390 / 430.
 * Uses playwright-core against local vite preview.
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
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge not found");
}

async function shoot(page, width, height, name) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 }).catch(() =>
    page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 })
  );
  await page.waitForTimeout(2500);

  const file = (suffix) => path.join(OUT, `${name}-${suffix}.png`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: file("top"), fullPage: false });

  // Banner area
  const banner = await page.$("[data-mcj-home-hero], .mcj-home-hero--promo");
  if (banner) {
    await banner.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: file("banner"), fullPage: false });
  }

  // Stats (inside hero)
  const stats = await page.$("[data-home-daily-stats], .home-trust-stats");
  if (stats) {
    await stats.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: file("stats"), fullPage: false });
  }

  // Companions
  const hot = await page.$("#hotCompanionTrack");
  if (hot) {
    await hot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: file("companions"), fullPage: false });
  }

  // Bottom nav — scroll to bottom then clip viewport
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: file("bottom-nav"), fullPage: false });

  // Full page (may be long)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: file("full"), fullPage: true });

  // Overflow check
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowX: doc.scrollWidth > doc.clientWidth + 1,
    };
  });
  fs.writeFileSync(path.join(OUT, `${name}-overflow.json`), JSON.stringify(overflow, null, 2));
  return overflow;
}

(async () => {
  const executablePath = await findChrome();
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const r390 = await shoot(page, 390, 844, "real-390");
  const r430 = await shoot(page, 430, 932, "real-430");
  // Desktop sample
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "desktop-1440-top.png"), fullPage: false });
  await browser.close();
  console.log(JSON.stringify({ out: OUT, r390, r430, files: fs.readdirSync(OUT) }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
