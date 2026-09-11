const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const widths = [375, 390, 393, 430];
const TARGET = "http://127.0.0.1:4173/companion-center.html";
const outDir = path.join(__dirname, "..", "docs", "hall-photo-4x5-accept");
fs.mkdirSync(outDir, { recursive: true });

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (_) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch (__) {
      return await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
    }
  }
}

(async () => {
  const browser = await launch();
  const results = [];
  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("mcj_pwa_install_dismissed", "1");
        localStorage.setItem("mcj-pwa-dismissed", "1");
        localStorage.setItem("mcj_pwa_prompt_seen", "1");
      } catch (_) {}
    });
    await page.goto(TARGET + "?_=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".player-card", { timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll("[data-mcj-pwa-root], .mcj-pwa-root, .mcj-pwa-sheet, .mcj-pwa-overlay").forEach((el) => el.remove());
      const panel = document.querySelector(".hall-search-panel");
      if (panel) panel.classList.remove("filters-open");
      // collapse intro to show more of card if needed
      const card = document.querySelector(".player-card");
      if (card) card.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(400);

    const data = await page.evaluate(() => {
      const first = document.querySelector(".player-card");
      const media = first && first.querySelector(".companion-card-media");
      const cs = media ? getComputedStyle(media) : null;
      const btns = first ? [...first.querySelectorAll(".companion-card-action")] : [];
      return {
        mediaAR: cs ? cs.aspectRatio : null,
        mediaW: media ? media.offsetWidth : null,
        mediaH: media ? media.offsetHeight : null,
        mediaMaxH: cs ? cs.maxHeight : null,
        ratioApprox: media && media.offsetWidth ? +(media.offsetHeight / media.offsetWidth).toFixed(3) : null,
        hasYiRenZhengOnCards: !!document.querySelector(".player-card .mcj-verified-badge"),
        bodyTextHasYiRenZhengInCard: first ? /已认证/.test(first.innerText) : null,
        btnCount: btns.length,
        btnHeights: btns.map((b) => b.offsetHeight),
        cardH: first ? first.offsetHeight : null,
      };
    });

    const card = page.locator(".player-card").first();
    await card.screenshot({ path: path.join(outDir, `card-${w}.png`) });
    await page.screenshot({ path: path.join(outDir, `hall-${w}.png`), fullPage: false });
    results.push({ width: w, ...data });
    await page.close();
  }
  fs.writeFileSync(path.join(outDir, "verify.json"), JSON.stringify({ target: TARGET, results }, null, 2));
  console.log(JSON.stringify({ target: TARGET, results }, null, 2));
  await browser.close();
  console.log("RESHOT_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
