/**
 * Capture Banner+Hall compact v1 evidence from Vercel Preview (or BASE_URL).
 * Usage: node scripts/capture-banner-hall-compact.cjs [baseUrl]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const OUT = path.join(__dirname, "..", "docs", "banner-hall-compact-accept");
fs.mkdirSync(OUT, { recursive: true });

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const short = sha.slice(0, 7);
const tip = execSync("git log -1 --oneline", { encoding: "utf8" }).trim();
const forcedBase = process.argv[2] || process.env.BASE_URL || "";

async function latestPreview() {
  if (forcedBase) return { url: String(forcedBase).replace(/\/$/, "") };
  const deps = await fetch(
    "https://api.github.com/repos/ciancianteng/miaocuijiao/deployments?environment=Preview&per_page=20",
    { headers: { "User-Agent": "mcj", Accept: "application/vnd.github+json" } }
  ).then((r) => r.json());
  const hit = (deps || []).find((d) => (d.sha || "").startsWith(short) || d.sha === sha);
  if (!hit) return { waiting: true, reason: "no deploy yet" };
  const st = await fetch(hit.statuses_url, {
    headers: { "User-Agent": "mcj", Accept: "application/vnd.github+json" },
  }).then((r) => r.json());
  const ok = (st || []).find((s) => s.state === "success" && (s.environment_url || s.target_url));
  if (ok) return { url: String(ok.environment_url || ok.target_url).replace(/\/$/, "") };
  return { waiting: true, states: (st || []).map((s) => s.state) };
}

(async () => {
  let preview = await latestPreview();
  for (let i = 0; i < 30 && preview.waiting; i++) {
    console.log("waiting preview…", i, preview.states || preview.reason);
    await new Promise((r) => setTimeout(r, 10000));
    preview = await latestPreview();
  }
  if (!preview.url) {
    console.log(JSON.stringify({ tip, preview }, null, 2));
    process.exit(2);
  }
  const base = preview.url;
  console.log("BASE", base);

  const content = await fetch(
    base + "/api/gateway?path=" + encodeURIComponent("platform/content") + "&types=banners&_=" + Date.now(),
    { headers: { Accept: "application/json" }, cache: "no-store" }
  )
    .then((r) => r.json())
    .catch((e) => ({ error: String(e && e.message) }));

  const companionsApi = await fetch(base + "/api/public/companions", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e && e.message) }));

  const browser = await chromium.launch({ executablePath: chrome, headless: true });

  async function shotPage(w, file, urlPath) {
    const page = await browser.newPage({
      viewport: { width: w, height: 844 },
      deviceScaleFactor: 2,
    });
    const client = await page.context().newCDPSession(page);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(base + urlPath + (urlPath.includes("?") ? "&" : "?") + "v=" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2800);
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    await page.close();
  }

  async function bannerEvidence(w) {
    const page = await browser.newPage({
      viewport: { width: w, height: 844 },
      deviceScaleFactor: 2,
    });
    const client = await page.context().newCDPSession(page);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(base + "/?v=banner-" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(3200);

    const slides = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll(".mcj-hero-image, .mcj-home-banner img, #homeBanner img, .banner img"));
      const roots = document.querySelectorAll("[data-mcj-banner], .mcj-home-banner, #homeBanner, .mcj-hero");
      const root = roots[0] || document.querySelector("main") || document.body;
      const allImgs = imgs.length
        ? imgs
        : Array.from(root.querySelectorAll("img")).filter((img) => /banner|hero|slide/i.test(img.className + img.src));
      return allImgs.map((img, i) => ({
        i,
        src: img.currentSrc || img.src || "",
        alt: img.alt || "",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        dataId: img.getAttribute("data-banner-id") || img.closest("[data-banner-id]")?.getAttribute("data-banner-id") || "",
      }));
    });

    await page.screenshot({ path: path.join(OUT, `home-${w}-banner-s0.png`), fullPage: false });

    // Try swipe / next for carousel evidence
    for (let step = 1; step <= 2; step++) {
      await page.evaluate((n) => {
        const track =
          document.querySelector(".mcj-hero-track, .mcj-banner-track, .banner-track, [data-mcj-banner-track]") ||
          document.querySelector(".mcj-home-banner, #homeBanner");
        if (!track) return;
        const w = track.clientWidth || window.innerWidth;
        track.scrollLeft = w * n;
        track.dispatchEvent(new Event("scroll"));
        const dots = document.querySelectorAll(".mcj-hero-dot, .mcj-banner-dot, [data-mcj-banner-dot]");
        if (dots[n]) dots[n].click();
        const next = document.querySelector("[data-mcj-banner-next], .mcj-hero-next");
        if (next) next.click();
      }, step);
      await page.waitForTimeout(900);
      await page.screenshot({
        path: path.join(OUT, `home-${w}-banner-s${step}.png`),
        fullPage: false,
      });
    }

    await page.close();
    return slides;
  }

  async function hallEvidence(w) {
    const page = await browser.newPage({
      viewport: { width: w, height: 900 },
      deviceScaleFactor: 2,
    });
    const client = await page.context().newCDPSession(page);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(base + "/companion-center.html?v=hall-" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(3500);

    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".companion-hall-grid .player-card, #playerList .player-card"))
        .slice(0, 4)
        .map((card) => {
          const name = (card.querySelector(".companion-nickname-line") || {}).textContent || "";
          const status = (card.querySelector(".companion-status-inline") || {}).textContent || "";
          const verified = !!(card.querySelector(".mcj-verified-badge"));
          const img = card.querySelector("img");
          const tags = Array.from(card.querySelectorAll(".mcj-service-tag, .companion-level-pill")).map(
            (el) => (el.textContent || "").trim()
          );
          return {
            name: name.trim(),
            status: status.trim(),
            verified,
            image: img ? img.currentSrc || img.src : "",
            tags,
            publicId: card.getAttribute("data-public-id") || "",
          };
        });
    });

    await page.screenshot({ path: path.join(OUT, `hall-${w}-top.png`), fullPage: false });
    await page.evaluate(() => {
      const card = document.querySelector(".companion-hall-grid .player-card, #playerList .player-card");
      if (card) card.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `hall-${w}-cards.png`), fullPage: false });
    await page.close();
    return cards;
  }

  const bannersRemote = ((content && content.byType && content.byType.banners) || []).map((b, i) => ({
    i,
    id: b.id || b.banner_id || "",
    title: b.title || b.name || "",
    image: b.image || b.image_url || b.mobileImage || b.desktopImage || b.url || "",
    sort: b.sort ?? b.sort_order ?? b.order ?? null,
    enabled: b.enabled ?? b.published ?? b.is_active,
  }));

  const slideSrcs390 = await bannerEvidence(390);
  await shotPage(375, "home-375.png", "/");
  await shotPage(393, "home-393.png", "/");
  await shotPage(430, "home-430.png", "/");
  await shotPage(390, "home-390.png", "/");

  const hall390 = await hallEvidence(390);
  await hallEvidence(375);
  await hallEvidence(393);
  await hallEvidence(430);

  const uniqueBannerSrc = [...new Set(slideSrcs390.map((s) => s.src).filter(Boolean))];
  const apiCompanions = Array.isArray(companionsApi.companions) ? companionsApi.companions : [];
  const verify = {
    tip,
    sha,
    base,
    bannerApiCount: bannersRemote.length,
    bannersRemote,
    frontSlideSrcs: slideSrcs390,
    uniqueFrontSrcCount: uniqueBannerSrc.length,
    bannerSrcMatch:
      bannersRemote.length > 0
        ? bannersRemote.every((b) => {
            const img = String(b.image || "");
            if (!img) return true;
            return slideSrcs390.some((s) => s.src.includes(img.split("/").pop()) || s.src === img || img.includes(s.src.split("/").pop() || "___"));
          })
        : null,
    hallCards390: hall390,
    companionsApiSample: apiCompanions.slice(0, 4).map((c) => ({
      id: c.id || c.uid || c.companionId,
      name: c.name || c.nickname,
      status: c.availabilityStatus || c.status || c.onlineStatus,
      certificationStatus: c.certificationStatus,
      game: c.game || c.mainGame,
      level: c.level || c.levelName || c.rank,
    })),
    noMockHall: !/mockProfiles|fake companion|placeholder/i.test(JSON.stringify(hall390)),
  };

  fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(verify, null, 2));
  console.log(JSON.stringify(verify, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
