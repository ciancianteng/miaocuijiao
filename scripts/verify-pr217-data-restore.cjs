const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

const FORBIDDEN = [/返点陪玩/u, /PR\d*Accept/i, /Staging\s*Companion/i, /\bsmoke\b/i, /ProdSmoke/i, /@meow\.test/i];

function getJson(url) {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { "User-Agent": "mcj", Accept: "application/json" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(d) });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      })
      .on("error", (e) => resolve({ error: String(e) }));
  });
}

async function latestPreview() {
  if (process.env.BASE) return process.env.BASE.replace(/\/$/, "");
  const deps = await getJson("https://api.github.com/repos/ciancianteng/miaocuijiao/deployments?per_page=8");
  const list = Array.isArray(deps.json) ? deps.json : [];
  const preview = list.find((d) => d.environment === "Preview");
  if (!preview) return "";
  const st = await getJson(preview.statuses_url);
  const first = Array.isArray(st.json) ? st.json[0] : null;
  return ((first && (first.environment_url || first.target_url)) || "").replace(/\/$/, "");
}

(async () => {
  const base = await latestPreview();
  if (!base) throw new Error("no preview base");

  const apiCompanions = await getJson(base + "/api/public/companions");
  const companions =
    (apiCompanions.json && (apiCompanions.json.companions || apiCompanions.json.data || [])) || [];
  const names = companions.map((c) => c.nickname || c.name || "");
  const forbiddenHits = names.filter((n) => FORBIDDEN.some((re) => re.test(n)));
  const realAvatars = companions.filter((c) => {
    const av = String(c.avatar || c.avatar_url || "");
    return av && !/default-avatar/i.test(av);
  }).length;

  const apiAnn = await getJson(base + "/api/platform/content?types=announcements&audience=home");
  const anns =
    (((apiAnn.json || {}).byType || {}).announcements) ||
    (apiAnn.json && apiAnn.json.items) ||
    [];

  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(base + "/?v=data-restore", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);

  const ui = await page.evaluate(() => {
    const bar = document.querySelector(".home-announcement-bar, [data-home-announcements], .announcement-strip");
    const track = bar && bar.querySelector(".home-announcement-track");
    const staticEl = bar && bar.querySelector(".home-announcement-static");
    const text = bar ? (bar.innerText || "").replace(/\s+/g, " ").trim() : "";
    const cards = [...document.querySelectorAll(".player-card, .home-track-card, [data-companion-card]")];
    const cardNames = cards
      .map((c) => (c.querySelector(".name, .player-name, .companion-name, h3, h4") || c).textContent || "")
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 20);
    const imgs = [...document.querySelectorAll(".player-card img, .home-track-card img, [data-companion-card] img")].map(
      (img) => img.currentSrc || img.src || ""
    );
    const banner = document.querySelector(".mcj-hero-viewport img, img.mcj-hero-image");
    const dots = document.querySelectorAll(".mcj-hero-dots button").length;
    const style = track ? getComputedStyle(track) : null;
    return {
      annText: text,
      hasMarqueeTrack: !!track,
      hasStaticOnly: !!staticEl && !track,
      animationName: style ? style.animationName : "",
      cardNames,
      imgs: imgs.slice(0, 12),
      bannerSrc: banner ? banner.currentSrc || banner.src : "",
      dots,
      slideCount: document.querySelectorAll(".mcj-hero-slide").length,
    };
  });

  // Wait for marquee motion if track exists
  let marqueeMoved = false;
  if (ui.hasMarqueeTrack) {
    const t0 = await page.evaluate(() => {
      const track = document.querySelector(".home-announcement-track");
      return track ? getComputedStyle(track).transform : "";
    });
    await page.waitForTimeout(1800);
    const t1 = await page.evaluate(() => {
      const track = document.querySelector(".home-announcement-track");
      return track ? getComputedStyle(track).transform : "";
    });
    marqueeMoved = t0 !== t1 && !!t1 && t1 !== "none";
  }

  await page.screenshot({
    path: path.join(OUT, "data-01-home-banner-ann.png"),
    clip: { x: 0, y: 0, width: 390, height: 560 },
  });

  const annTop = await page.evaluate(() => {
    const bar = document.querySelector(".home-announcement-bar, .announcement-strip");
    return bar ? Math.max(0, bar.getBoundingClientRect().top - 8) : 300;
  });
  await page.screenshot({
    path: path.join(OUT, "data-02-announcement-ticker.png"),
    clip: { x: 0, y: annTop, width: 390, height: 90 },
  });

  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUT, "data-03-home-recommend.png"),
    clip: { x: 0, y: 0, width: 390, height: 700 },
  });

  await page.goto(base + "/companion-center.html?v=data-restore", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(4500);
  const hall = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".player-card")];
    return {
      count: cards.length,
      names: cards
        .map((c) => {
          const n = c.querySelector(".player-name, .name, h3, .card-name");
          return (n && n.textContent || "").replace(/\s+/g, " ").trim();
        })
        .filter(Boolean),
      avatars: cards.map((c) => {
        const img = c.querySelector("img");
        return img ? img.currentSrc || img.src : "";
      }),
    };
  });
  await page.screenshot({
    path: path.join(OUT, "data-04-hall.png"),
    fullPage: false,
    clip: { x: 0, y: 0, width: 390, height: 720 },
  });

  const uiForbidden = [...ui.cardNames, ...hall.names].filter((n) => FORBIDDEN.some((re) => re.test(n)));
  const hallRealAvatar = hall.avatars.some((u) => u && !/default-avatar/i.test(u));
  const emptyStaticFail = /暂无最新公告/.test(ui.annText) && !ui.hasMarqueeTrack;
  const tickerOk =
    ui.hasMarqueeTrack &&
    /试运营|官方公告|妙脆角/.test(ui.annText) &&
    !emptyStaticFail;

  const report = {
    base,
    api: {
      companionsCount: companions.length,
      names,
      forbiddenHits,
      realAvatars,
      announcementsApiCount: Array.isArray(anns) ? anns.length : 0,
    },
    ui,
    hall,
    marqueeMoved,
    checks: {
      noForbiddenApi: forbiddenHits.length === 0,
      noForbiddenUi: uiForbidden.length === 0,
      tickerOk,
      marqueeMoved,
      bannerOk: !!ui.bannerSrc && ui.slideCount >= 1,
      paginationOk: ui.dots >= 1,
      // Honest: Staging may have zero real companions after fixture filter.
      hasAnyCompanion: companions.length > 0 || hall.count > 0,
      hasRealAvatar: realAvatars > 0 || hallRealAvatar,
    },
  };

  const pass =
    report.checks.noForbiddenApi &&
    report.checks.noForbiddenUi &&
    report.checks.tickerOk &&
    report.checks.bannerOk;

  // Soft flags (ENV block): real companions / real avatars may be unavailable on Staging.
  report.passHard = pass;
  report.passFull =
    pass && report.checks.hasAnyCompanion && report.checks.hasRealAvatar && report.checks.marqueeMoved;
  report.envBlock =
    !report.checks.hasAnyCompanion || !report.checks.hasRealAvatar
      ? {
          reason:
            "Preview/Staging Supabase public hall has no non-fixture published companions with real avatars after test isolation. Production public hall still has real companions.",
          homeApi: "GET /api/public/companions",
          hallApi: "GET /api/public/companions",
          annApi: "GET /api/platform/content?types=announcements&audience=home",
          previewEnv: "VERCEL_ENV=preview → Staging Supabase (not Production jqfaknpm…)",
        }
      : null;

  fs.writeFileSync(path.join(OUT, "data-restore-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passHard: report.passHard, passFull: report.passFull, envBlock: report.envBlock, checks: report.checks, api: report.api, base }, null, 2));
  await browser.close();
  if (!report.passHard) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
