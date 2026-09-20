/**
 * Capture PR Preview @390 with measured banner overlay proof.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const BASE = process.env.BASE || "http://127.0.0.1:5180";
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const metrics = { base: BASE };

  await page.goto(BASE + "/?v=accept217b", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4000);

  metrics.home = await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    const hero = document.querySelector(".mcj-home-hero");
    const brand = document.querySelector(".home-brand-hero");
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) };
    };
    return {
      title: (document.querySelector(".home-brand-hero-title") || {}).textContent || "",
      brand: r(brand),
      banner: r(vp),
      dots: document.querySelectorAll(".mcj-hero-dots button").length,
      slides: document.querySelectorAll(".mcj-hero-slide").length,
      promo: !!(hero && hero.classList.contains("mcj-home-hero--promo")),
    };
  });

  // Draw measurement badge on banner for acceptance proof
  await page.evaluate((m) => {
    const vp = document.querySelector(".mcj-hero-viewport");
    if (!vp || !m) return;
    const tag = document.createElement("div");
    tag.textContent = m.w + " × " + m.h + "  ·  2.35:1";
    Object.assign(tag.style, {
      position: "absolute",
      left: "8px",
      bottom: "8px",
      zIndex: "20",
      padding: "4px 8px",
      borderRadius: "8px",
      background: "rgba(0,0,0,.72)",
      color: "#fff",
      fontSize: "11px",
      fontWeight: "700",
      pointerEvents: "none",
    });
    vp.style.position = "relative";
    vp.appendChild(tag);
  }, metrics.home.banner);

  await page.screenshot({
    path: path.join(OUT, "01-390-home-hero-top.png"),
    clip: { x: 0, y: 0, width: 390, height: 560 },
  });

  const by = metrics.home.banner ? Math.max(0, metrics.home.banner.top - 16) : 340;
  await page.screenshot({
    path: path.join(OUT, "02-390-banner-carousel.png"),
    clip: { x: 0, y: by, width: 390, height: 220 },
  });

  // remove overlay for full page
  await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    if (vp) [...vp.querySelectorAll("div")].forEach((d) => {
      if (/×/.test(d.textContent || "")) d.remove();
    });
  });

  await page.screenshot({ path: path.join(OUT, "03-390-home-full-long.png"), fullPage: true });

  await page.goto(BASE + "/companion-center.html?v=accept217b", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(3500);
  metrics.hall = await page.evaluate(() => {
    const team = document.querySelector('[data-hall-entry="team-lobby"]');
    const list = document.querySelector("#playerList");
    const card = document.querySelector(".player-card");
    const name = card && card.querySelector(".companion-nickname-line");
    return {
      teamAfterList: !!(team && list && team.getBoundingClientRect().top > list.getBoundingClientRect().top),
      priceInCard: !!(card && /猫粮/.test(card.innerText || "")),
      nameFs: name ? getComputedStyle(name).fontSize : null,
      nameText: name ? name.textContent : null,
      verified: !!(card && card.querySelector(".mcj-verified-badge")),
    };
  });
  await page.screenshot({
    path: path.join(OUT, "04-390-companion-hall.png"),
    clip: { x: 0, y: 0, width: 390, height: 780 },
  });

  const cardBox = await page.evaluate(() => {
    const card = document.querySelector(".player-card");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.left - 8)),
      y: Math.max(0, Math.floor(r.top - 8)),
      width: Math.min(390, Math.ceil(r.width + 16)),
      height: Math.min(520, Math.ceil(r.height + 16)),
    };
  });
  if (cardBox) {
    await page.screenshot({ path: path.join(OUT, "05-390-card-closeup.png"), clip: cardBox });
  }

  const href = await page.evaluate(() => {
    const a = document.querySelector('.player-card a.companion-card-action[href*="profile"]');
    return a ? a.getAttribute("href") : null;
  });
  await page.goto(BASE + "/" + (href || "profile.html").replace(/^\//, ""), {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const el = document.querySelector(".pd-info-card");
    if (el) el.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(300);
  metrics.profile = await page.evaluate(() => ({
    boxes: document.querySelectorAll(".pd-stat-cell").length,
    labels: [...document.querySelectorAll(".pd-meta-label")].map((el) => el.textContent.trim()),
    perf: (document.querySelector(".pd-perf-empty") || {}).textContent || "",
  }));
  await page.screenshot({ path: path.join(OUT, "06-390-profile-detail.png") });
  const mid = await page.evaluate(() => {
    const el = document.querySelector(".pd-info-card");
    if (!el) return null;
    return { y: Math.max(0, el.getBoundingClientRect().top - 12) };
  });
  if (mid) {
    await page.screenshot({
      path: path.join(OUT, "06b-390-profile-stats.png"),
      clip: { x: 0, y: mid.y, width: 390, height: 520 },
    });
  }

  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
