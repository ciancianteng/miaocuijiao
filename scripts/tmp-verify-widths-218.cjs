const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const widths = [375, 390, 393, 430];
const TARGET = process.env.HALL_URL || "http://127.0.0.1:4173/companion-center.html";

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
  const out = [];
  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".player-card", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const data = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".player-card")];
      const first = cards[0];
      const media = first && first.querySelector(".companion-card-media");
      const cs = media ? getComputedStyle(media) : null;
      const vh = window.innerHeight;
      const verified = [...document.querySelectorAll(".mcj-verified-badge")].map((el) => el.textContent.trim());
      const visible = cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top < vh && r.bottom > 40;
      }).length;
      return {
        cardH: first ? first.offsetHeight : null,
        cardRatio: first ? +(first.offsetHeight / vh).toFixed(3) : null,
        mediaAR: cs ? cs.aspectRatio : null,
        mediaH: media ? media.offsetHeight : null,
        mediaMaxH: cs ? cs.maxHeight : null,
        visibleApprox: visible,
        verifiedTexts: verified,
        hasYiRenZheng: document.body.innerText.includes("已认证"),
      };
    });
    out.push({ width: w, ...data });
    await page.close();
  }
  console.log(JSON.stringify({ target: TARGET, results: out }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
