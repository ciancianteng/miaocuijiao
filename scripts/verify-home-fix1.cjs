const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const BASE = (process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "mcj", Accept: "application/json" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });

  async function shot(viewport, prefix, useProdCompanions) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: viewport.width <= 430 ? 2 : 1,
    });
    if (useProdCompanions) {
      const body = await getText("https://www.meowcuijiao.com/api/public/companions");
      await page.route("**/api/public/companions**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body,
        });
      });
    }
    await page.goto(BASE + "/?v=home-fix1", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(4500);

    const report = await page.evaluate(async () => {
      const snacks = [...document.querySelectorAll(".mcj-snack")].filter(
        (el) => getComputedStyle(el).display !== "none"
      );
      const snackInfo = snacks.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          src: (el.currentSrc || el.src || "").split("/").pop(),
          op: Number(getComputedStyle(el).opacity),
          w: Math.round(r.width),
          visible: r.width >= 30 && Number(getComputedStyle(el).opacity) >= 0.75,
        };
      });
      const vp = document.querySelector(".mcj-hero-viewport");
      const box = vp ? vp.getBoundingClientRect() : null;
      const img = document.querySelector("img.mcj-hero-image");
      const slides = document.querySelectorAll(".mcj-hero-slide").length;
      const dots = document.querySelectorAll(".mcj-hero-dots button").length;
      const cards = [...document.querySelectorAll("#hotCompanionTrack .hot-card.companion-card:not(.hot-more-card):not(.mcj-empty-card)")];
      const cardInfo = cards.map((c) => ({
        name: (c.querySelector("h3") || {}).textContent || "",
        game: (c.querySelector(".hot-game, .hot-info > p") || {}).textContent || "",
        level: (c.querySelector(".companion-level-pill") || {}).textContent || "",
        status: (c.querySelector(".hot-status") || {}).textContent || "",
        tags: [...c.querySelectorAll(".hot-tags span")].map((t) => t.textContent).filter(Boolean),
        avatar: ((c.querySelector(".hot-cover img") || {}).currentSrc || "").slice(0, 80),
        hasDefaultAvatar: /default-avatar/i.test((c.querySelector(".hot-cover img") || {}).currentSrc || ""),
      }));
      return {
        snacksVisible: snackInfo.filter((s) => s.visible).length,
        snackInfo,
        banner: box
          ? {
              w: Math.round(box.width),
              h: Math.round(box.height),
              ratio: Number((box.width / Math.max(1, box.height)).toFixed(3)),
            }
          : null,
        bannerNat: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
        slides,
        dots,
        cards: cardInfo,
        apiHint: document.querySelector("#hotCompanionTrack")?.dataset?.sourceCount || "",
      };
    });

    await page.screenshot({
      path: path.join(OUT, `${prefix}-hero.png`),
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(560, viewport.height) },
    });

    const bannerTop = await page.evaluate(() => {
      const vp = document.querySelector(".mcj-hero-viewport");
      return vp ? Math.max(0, vp.getBoundingClientRect().top - 8) : 280;
    });
    await page.screenshot({
      path: path.join(OUT, `${prefix}-banner.png`),
      clip: { x: 0, y: bannerTop, width: viewport.width, height: 260 },
    });

    await page.evaluate(() => {
      const el = document.querySelector(".hot-recommend-section");
      if (el) el.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(400);
    const cardsTop = await page.evaluate(() => {
      const el = document.querySelector(".hot-recommend-section");
      return el ? Math.max(0, el.getBoundingClientRect().top - 8) : 400;
    });
    await page.screenshot({
      path: path.join(OUT, `${prefix}-companions.png`),
      clip: { x: 0, y: cardsTop, width: viewport.width, height: 520 },
    });

    await page.close();
    return report;
  }

  const mobile = await shot({ width: 390, height: 844 }, "fix1-390", true);
  const desktop = await shot({ width: 1280, height: 900 }, "fix1-1280", true);

  const out = {
    base: BASE,
    note: "Companion cards verified with Production /api/public/companions JSON fulfilled into local PR UI (no fake rows). Preview Staging still returns 0 after fixture isolation.",
    mobile,
    desktop,
  };
  fs.writeFileSync(path.join(OUT, "home-fix1-verify.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();

  const ok =
    mobile.snacksVisible >= 2 &&
    mobile.banner &&
    mobile.banner.ratio >= 1.5 &&
    mobile.banner.ratio <= 2.1 &&
    mobile.slides >= 2 &&
    mobile.cards.length >= 1 &&
    mobile.cards.every((c) => c.name && !/返点陪玩|PR\d*Accept/i.test(c.name));
  if (!ok) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
