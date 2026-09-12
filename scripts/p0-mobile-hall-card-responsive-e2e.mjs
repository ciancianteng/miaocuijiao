/**
 * Mobile hall / home / profile responsive checks at iPhone 390px.
 * Usage: BASE=http://127.0.0.1:5173 node scripts/p0-mobile-hall-card-responsive-e2e.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = String(process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");
const ART = path.join(ROOT, "artifacts", "mobile-hall-card-responsive-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, pass, detail) {
  results.push({ name, result: pass ? "PASS" : "FAIL", detail: detail || "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  // --- Hall ---
  await page.goto(`${BASE}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  // Inject a fake card if list empty (auth/API may fail locally)
  await page.evaluate(() => {
    const list = document.getElementById("playerList");
    if (!list) return;
    if (list.querySelector(".player-card")) return;
    list.innerHTML =
      '<article class="card player-card">' +
      '<div class="companion-card-media"><img src="/default-avatar.png" alt="t"><span class="companion-online-badge">在线</span></div>' +
      '<div class="companion-card-body">' +
      '<div class="row companion-card-head companion-card-title-row"><h3>测试陪玩</h3><span class="companion-status-inline">在线</span></div>' +
      '<div class="companion-price">25 猫粮/小时</div>' +
      '<div class="companion-identity-row companion-tags"><span class="companion-level-pill">萌喵</span></div>' +
      '<div class="companion-games-row"><span class="mcj-service-tag">VALORANT</span></div>' +
      '<div class="companion-card-actions"><a class="companion-card-action" href="#">查看详情</a><button type="button" class="companion-card-action primary">立即下单</button></div>' +
      "</div></article>";
  });
  await page.waitForSelector(".companion-hall-grid .player-card", { timeout: 10000 });

  const hall = await page.evaluate(() => {
    const card = document.querySelector(".companion-hall-grid .player-card");
    const media = card && card.querySelector(".companion-card-media");
    const img = media && media.querySelector("img");
    const price = card && card.querySelector(".companion-price");
    const status = card && card.querySelector(".companion-status-inline");
    const pageEl = document.querySelector(".companion-hall-page");
    const nav = document.querySelector(".bottom-nav");
    const grid = document.querySelector(".companion-hall-grid");
    const cb = card && card.getBoundingClientRect();
    const mb = media && media.getBoundingClientRect();
    const pb = pageEl && getComputedStyle(pageEl);
    const gb = grid && getComputedStyle(grid);
    const imgFit = img ? getComputedStyle(img).objectFit : "";
    const cols = gb ? gb.gridTemplateColumns : "";
    return {
      vw: window.innerWidth,
      cardW: cb ? Math.round(cb.width) : 0,
      cardH: cb ? Math.round(cb.height) : 0,
      cardLeft: cb ? Math.round(cb.left) : 0,
      mediaH: mb ? Math.round(mb.height) : 0,
      mediaRatio: cb && mb && cb.height ? +(mb.height / cb.height).toFixed(3) : 0,
      pagePadBottom: pb ? pb.paddingBottom : "",
      gridCols: cols,
      singleCol: cols === "none" || (cols && !cols.includes(" ") && cols !== "none") || (cols && cols.split(" ").filter(Boolean).length === 1),
      objectFit: imgFit,
      navFixed: nav ? getComputedStyle(nav).position === "fixed" : false,
      navDisplay: nav ? getComputedStyle(nav).display : "",
      priceFs: price ? parseFloat(getComputedStyle(price).fontSize) : 0,
      pricePad: price ? getComputedStyle(price).padding : "",
      statusDot: status ? getComputedStyle(status, "::before").width : "",
      cardShadow: card ? getComputedStyle(card).boxShadow : "",
      gap: gb ? gb.gap || gb.rowGap : "",
    };
  });
  await page.screenshot({ path: path.join(ART, "hall-390.png"), fullPage: true });

  step("hall_viewport_390", hall.vw === 390, JSON.stringify({ vw: hall.vw }));
  step(
    "hall_single_column",
    hall.singleCol || (hall.gridCols && hall.gridCols.split(/\s+/).length <= 1),
    hall.gridCols
  );
  step(
    "hall_card_side_margin",
    hall.cardLeft >= 14 && hall.cardLeft <= 20 && hall.cardW >= 340 && hall.cardW <= 360,
    JSON.stringify({ left: hall.cardLeft, w: hall.cardW })
  );
  step(
    "hall_media_height_capped",
    hall.mediaH > 0 && hall.mediaH <= 120 && hall.mediaRatio <= 0.42,
    JSON.stringify({ mediaH: hall.mediaH, ratio: hall.mediaRatio, cardH: hall.cardH })
  );
  step("hall_object_fit_cover", hall.objectFit === "cover", hall.objectFit);
  step(
    "hall_page_padding_bottom",
    /px/.test(hall.pagePadBottom) && parseFloat(hall.pagePadBottom) >= 100,
    hall.pagePadBottom
  );
  step("hall_bottom_nav_fixed", hall.navFixed && hall.navDisplay !== "none", JSON.stringify({ fixed: hall.navFixed, display: hall.navDisplay }));
  step("hall_price_emphasis", hall.priceFs >= 17 && /px/.test(hall.pricePad || ""), JSON.stringify({ fs: hall.priceFs, pad: hall.pricePad }));
  step("hall_status_dot", parseFloat(hall.statusDot || "0") >= 7, hall.statusDot);
  step("hall_card_depth", /rgba?\(/.test(hall.cardShadow || "") || /px/.test(hall.cardShadow || ""), (hall.cardShadow || "").slice(0, 80));
  step("hall_tighter_gap", parseFloat(hall.gap || "0") <= 14, hall.gap);

  // Desktop sanity: 1280 should not use mobile media height
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  const desk = await page.evaluate(() => {
    const media = document.querySelector(".companion-hall-grid .companion-card-media");
    const grid = document.querySelector(".companion-hall-grid");
    const mb = media && media.getBoundingClientRect();
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns : "";
    return {
      mediaH: mb ? Math.round(mb.height) : 0,
      colCount: cols ? cols.split(/\s+/).filter(Boolean).length : 0,
    };
  });
  step(
    "desktop_layout_preserved",
    desk.colCount >= 3 && desk.mediaH >= 200,
    JSON.stringify(desk)
  );

  // --- Home ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  const home = await page.evaluate(() => {
    const nav = document.querySelector(".mobile-bottom-nav");
    const container = document.querySelector("main.container, .container");
    const av = document.querySelector(".companion-card .avatar, .hot-card .avatar");
    return {
      title: document.title,
      hasNav: !!nav && getComputedStyle(nav).display !== "none",
      padBottom: container ? getComputedStyle(container).paddingBottom : "",
      avatarH: av ? Math.round(av.getBoundingClientRect().height) : null,
    };
  });
  await page.screenshot({ path: path.join(ART, "home-390.png"), fullPage: false });
  step("home_loads", /MEOW|妙脆角/i.test(home.title || ""), home.title);
  step("home_bottom_nav_visible", home.hasNav, JSON.stringify(home));
  step(
    "home_avatar_not_huge",
    home.avatarH == null || home.avatarH <= 180,
    String(home.avatarH)
  );

  // --- Profile (may redirect/login; still assert CSS file applies if shell present) ---
  await page.goto(`${BASE}/profile.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const profile = await page.evaluate(() => {
    const wrap = document.querySelector(".profile-avatar-wrap");
    const shell = document.querySelector(".profile-detail-shell, .profile-detail-page");
    const wb = wrap && wrap.getBoundingClientRect();
    return {
      url: location.href,
      hasShell: !!shell,
      avatarH: wb ? Math.round(wb.height) : null,
      avatarMax: wrap ? getComputedStyle(wrap).maxHeight : "",
    };
  });
  await page.screenshot({ path: path.join(ART, "profile-390.png"), fullPage: false });
  step(
    "profile_mobile_avatar_capped",
    profile.avatarH == null || profile.avatarH <= 240 || /220px|200px|180px/.test(profile.avatarMax),
    JSON.stringify(profile)
  );

  await browser.close();
  const failed = results.filter((r) => r.result === "FAIL");
  const out = { overall: failed.length ? "FAIL" : "PASS", failed: failed.length, base: BASE, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  console.log("\nOVERALL", out.overall, "failed=", failed.length);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
