const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const widths = [375, 390, 393, 430];
const TARGET = process.env.HALL_URL || "http://127.0.0.1:4173/companion-center.html";
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
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.goto(TARGET + (TARGET.includes("?") ? "&" : "?") + "_=" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForSelector(".player-card", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    // dismiss common overlays that block cards
    await page.evaluate(() => {
      document.querySelectorAll(".pwa-install-prompt, .pwa-teach, [data-pwa-prompt]").forEach((el) => {
        el.style.display = "none";
      });
      const panel = document.querySelector(".hall-search-panel");
      if (panel) panel.classList.remove("filters-open");
    });
    await page.waitForTimeout(400);
    // scroll first card into view
    await page.evaluate(() => {
      const card = document.querySelector(".player-card");
      if (card) card.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(300);

    const data = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".player-card")];
      const first = cards[0];
      const media = first && first.querySelector(".companion-card-media");
      const cs = media ? getComputedStyle(media) : null;
      const img = media && media.querySelector("img");
      const ics = img ? getComputedStyle(img) : null;
      const btns = first ? [...first.querySelectorAll(".companion-card-action")] : [];
      return {
        cardH: first ? first.offsetHeight : null,
        mediaAR: cs ? cs.aspectRatio : null,
        mediaW: media ? media.offsetWidth : null,
        mediaH: media ? media.offsetHeight : null,
        mediaMaxH: cs ? cs.maxHeight : null,
        imgObjectFit: ics ? ics.objectFit : null,
        verified: [...document.querySelectorAll(".mcj-verified-badge")].map((el) => el.textContent.trim()),
        hasYiRenZhengOnCards: !!document.querySelector(".player-card .mcj-verified-badge"),
        bodyTextHasYiRenZhengInCard: first ? /已认证/.test(first.innerText) : null,
        btnCount: btns.length,
        btnHeights: btns.map((b) => b.offsetHeight),
        ratioApprox: media && media.offsetWidth ? +(media.offsetHeight / media.offsetWidth).toFixed(3) : null,
      };
    });

    const shot = path.join(outDir, `hall-${w}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ width: w, shot: path.relative(process.cwd(), shot), ...data });
    await page.close();
  }
  fs.writeFileSync(path.join(outDir, "verify.json"), JSON.stringify({ target: TARGET, results }, null, 2));
  console.log(JSON.stringify({ target: TARGET, results }, null, 2));
  await browser.close();

  const bad = results.filter(
    (r) =>
      r.hasYiRenZhengOnCards ||
      r.bodyTextHasYiRenZhengInCard ||
      !String(r.mediaAR || "").includes("4") ||
      Math.abs((r.ratioApprox || 0) - 1.25) > 0.08 ||
      r.btnCount < 2 ||
      (r.mediaMaxH && r.mediaMaxH !== "none" && /px/.test(r.mediaMaxH) && parseFloat(r.mediaMaxH) < 200)
  );
  if (bad.length) {
    console.error("VERIFY_FAIL", JSON.stringify(bad, null, 2));
    process.exit(3);
  }
  console.log("VERIFY_OK");
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
