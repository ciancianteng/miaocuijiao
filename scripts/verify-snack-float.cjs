const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = (process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");
const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(BASE + "/?v=snack-float", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => {
    const snacks = [...document.querySelectorAll(".mcj-snack")].map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        cls: el.className,
        display: s.display,
        opacity: Number(s.opacity),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && s.display !== "none" && Number(s.opacity) > 0.2,
        z: s.zIndex,
      };
    });
    const copyZ = getComputedStyle(document.querySelector(".home-brand-hero-copy")).zIndex;
    const snackZ = getComputedStyle(document.querySelector(".home-brand-hero-snacks")).zIndex;
    const heroOverflow = getComputedStyle(document.querySelector(".home-brand-hero")).overflow;
    return {
      snacks,
      visibleCount: snacks.filter((s) => s.visible).length,
      copyZ,
      snackZ,
      heroOverflow,
    };
  });

  await page.screenshot({
    path: path.join(OUT, "snack-01-hero-390.png"),
    clip: { x: 0, y: 0, width: 390, height: 420 },
  });

  fs.writeFileSync(path.join(OUT, "snack-float-verify.json"), JSON.stringify({ base: BASE, ...report }, null, 2));
  console.log(JSON.stringify({ base: BASE, visibleCount: report.visibleCount, snacks: report.snacks, copyZ: report.copyZ, snackZ: report.snackZ, heroOverflow: report.heroOverflow }, null, 2));
  await browser.close();
  if (report.visibleCount < 2) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
