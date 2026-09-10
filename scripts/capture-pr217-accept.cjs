/**
 * Capture PR #217 acceptance shots @ 390px (localhost).
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

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

(async () => {
  ensureDir(OUT);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  const metrics = {};

  await page.goto(BASE + "/index.html?v=accept217", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2200);

  const home = await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    const hero = document.querySelector(".mcj-home-hero");
    const brand = document.querySelector(".home-brand-hero");
    const dots = document.querySelectorAll(".mcj-hero-dots button").length;
    const r = (el) =>
      el
        ? {
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
            top: Math.round(el.getBoundingClientRect().top),
          }
        : null;
    return {
      brand: r(brand),
      bannerRoot: r(hero),
      bannerVp: r(vp),
      dots,
      promo: !!(hero && hero.classList.contains("mcj-home-hero--promo")),
      title: (document.querySelector(".home-brand-hero-title") || {}).textContent || "",
    };
  });
  metrics.home = home;

  // 1. Hero top
  await page.screenshot({
    path: path.join(OUT, "01-390-home-hero-top.png"),
    clip: { x: 0, y: 0, width: 390, height: 520 },
  });

  // 2. Banner area
  const bannerBox = await page.evaluate(() => {
    const el = document.querySelector(".mcj-home-hero");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { y: Math.max(0, r.top - 12), h: Math.min(280, r.height + 40) };
  });
  if (bannerBox) {
    await page.screenshot({
      path: path.join(OUT, "02-390-banner-carousel.png"),
      clip: { x: 0, y: bannerBox.y, width: 390, height: bannerBox.h },
    });
  }

  // 3. Full long scroll layout
  const fullH = await page.evaluate(() =>
    Math.min(4200, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
  );
  await page.screenshot({
    path: path.join(OUT, "03-390-home-full-long.png"),
    fullPage: false,
    clip: { x: 0, y: 0, width: 390, height: Math.min(fullH, 2800) },
  });
  // Better: true full page
  await page.screenshot({
    path: path.join(OUT, "03-390-home-full-long.png"),
    fullPage: true,
  });

  // 4. Hall
  await page.goto(BASE + "/companion-center.html?v=accept217", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  const hall = await page.evaluate(() => {
    const team = document.querySelector('[data-hall-entry="team-lobby"]');
    const more = document.querySelector('[data-hall-entry="more-gameplays"]');
    const list = document.querySelector("#playerList, .companion-hall-grid");
    const intro = document.querySelector(".hall-intro, #companionHallTitle");
    const order = [];
    document
      .querySelectorAll(
        ".hall-intro, .hall-search-panel, .hall-results, .hall-secondary-entries, [data-hall-entry]"
      )
      .forEach((el) => {
        order.push({
          cls: (el.className || "").toString().slice(0, 60),
          top: Math.round(el.getBoundingClientRect().top),
          text: (el.textContent || "").trim().slice(0, 40),
        });
      });
    const card = document.querySelector(".player-card");
    const priceVisible = card
      ? /猫粮/.test(card.innerText || "") &&
        !!(card.querySelector(".companion-price, .companion-level-price-range"))
      : null;
    const name = card && card.querySelector(".companion-nickname-line");
    const nameFs = name ? getComputedStyle(name).fontSize : null;
    return {
      teamTop: team ? Math.round(team.getBoundingClientRect().top) : null,
      listTop: list ? Math.round(list.getBoundingClientRect().top) : null,
      introTop: intro ? Math.round(intro.getBoundingClientRect().top) : null,
      teamAfterList: team && list ? team.getBoundingClientRect().top > list.getBoundingClientRect().top : null,
      moreBeforeTeam:
        more && team
          ? more.getBoundingClientRect().top <= team.getBoundingClientRect().top
          : null,
      priceTextInCard: card ? /猫粮/.test(card.innerText || "") : null,
      priceVisible,
      nameFs,
      order,
    };
  });
  metrics.hall = hall;

  await page.screenshot({
    path: path.join(OUT, "04-390-companion-hall.png"),
    clip: { x: 0, y: 0, width: 390, height: 780 },
  });

  // 5. Card close-up
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
  if (cardBox && cardBox.width > 40 && cardBox.height > 40) {
    await page.screenshot({
      path: path.join(OUT, "05-390-card-closeup.png"),
      clip: cardBox,
    });
  } else {
    await page.screenshot({
      path: path.join(OUT, "05-390-card-closeup.png"),
      clip: { x: 0, y: 180, width: 390, height: 420 },
    });
  }

  // 6. Profile detail
  const profileHref = await page.evaluate(() => {
    const a = document.querySelector('.player-card a.companion-card-action[href*="profile"]');
    return a ? a.getAttribute("href") : null;
  });
  if (profileHref) {
    await page.goto(BASE + "/" + profileHref.replace(/^\//, "") + "&v=accept217", {
      waitUntil: "networkidle",
      timeout: 60000,
    });
  } else {
    await page.goto(BASE + "/profile.html?v=accept217", {
      waitUntil: "networkidle",
      timeout: 60000,
    });
  }
  await page.waitForTimeout(2500);
  // Scroll to 数据表现 for duplicate-proof shot
  await page.evaluate(() => {
    const el =
      document.querySelector(".pd-info-card--full:nth-of-type(2), .pd-perf-empty, .pd-meta-list") ||
      document.querySelector(".pd-info-card");
    if (el) el.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(400);
  const profile = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const scoreCount = (text.match(/(^|\n)评分(\n|$)/g) || []).length;
    const boxes = document.querySelectorAll(".pd-stat-cell").length;
    const boxesDisplay = [...document.querySelectorAll(".pd-stat-grid")].map(
      (el) => getComputedStyle(el).display
    );
    const metaLabels = [...document.querySelectorAll(".pd-meta-label")].map((el) =>
      (el.textContent || "").trim()
    );
    return { scoreCount, boxes, boxesDisplay, metaLabels, snippet: text.slice(0, 800) };
  });
  metrics.profile = profile;
  await page.screenshot({
    path: path.join(OUT, "06-390-profile-detail.png"),
    fullPage: false,
  });
  // Also capture mid section with 基本资料 + 数据表现
  const mid = await page.evaluate(() => {
    const el = document.querySelector(".pd-info-card");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { y: Math.max(0, r.top - 20) };
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
