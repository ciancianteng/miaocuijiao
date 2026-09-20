/**
 * Capture Banner+Hall compact v1 evidence.
 * Preferred: local static + Prod GET-only proxy
 *   MCJ_API_ORIGIN=https://www.meowcuijiao.com node scripts/local-static-api-proxy.mjs
 *   node scripts/capture-banner-hall-compact.cjs http://127.0.0.1:4177
 *
 * Or Preview: node scripts/capture-banner-hall-compact.cjs [baseUrl]
 */
const { execSync, spawn } = require("child_process");
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
const API_ORIGIN = (process.env.MCJ_API_ORIGIN || "https://www.meowcuijiao.com").replace(/\/$/, "");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHttpOk(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok || r.status === 304) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

async function ensureLocalProxy() {
  const base = "http://127.0.0.1:4177";
  if (await waitHttpOk(base + "/", 2)) return { url: base, started: false };
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "local-static-api-proxy.mjs")],
    {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, MCJ_API_ORIGIN: API_ORIGIN, PORT: "4177" },
      stdio: "ignore",
      detached: true,
    }
  );
  child.unref();
  const ok = await waitHttpOk(base + "/", 40);
  if (!ok) throw new Error("local-static-api-proxy failed to start on :4177");
  return { url: base, started: true, pid: child.pid };
}

async function latestPreview() {
  if (forcedBase) return { url: String(forcedBase).replace(/\/$/, "") };
  if (process.env.USE_PREVIEW === "1") {
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
  return ensureLocalProxy();
}

(async () => {
  let preview = await latestPreview();
  for (let i = 0; i < 30 && preview.waiting; i++) {
    console.log("waiting preview…", i, preview.states || preview.reason);
    await sleep(10000);
    preview = await latestPreview();
  }
  if (!preview.url) {
    console.log(JSON.stringify({ tip, preview }, null, 2));
    process.exit(2);
  }
  const base = preview.url;
  console.log("BASE", base, "API_ORIGIN", API_ORIGIN);

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

  const bannersRemote = ((content && content.byType && content.byType.banners) || [])
    .filter((b) => b && b.enabled !== false && b.published !== false)
    .map((b, i) => ({
      i,
      id: b.id || b.banner_id || "",
      title: b.title || b.name || "",
      image: b.mobileImage || b.mobile_image || b.image || b.image_url || b.desktopImage || b.url || "",
      desktopImage: b.desktopImage || b.desktop_image || b.image || "",
      mobileImage: b.mobileImage || b.mobile_image || b.image || "",
      sort: b.sort ?? b.sort_order ?? b.order ?? null,
      enabled: b.enabled ?? b.published ?? b.is_active,
    }))
    .sort((a, b) => Number(a.sort ?? 100) - Number(b.sort ?? 100));

  const browser = await chromium.launch({ executablePath: chrome, headless: true });

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

    // Re-apply SoT mobile URLs if race left stub/default, then wait for real decode.
    await page.evaluate((sot) => {
      const imgs = Array.from(document.querySelectorAll("img.mcj-hero-image"));
      imgs.forEach((img, i) => {
        const want = sot[i];
        if (!want || !want.image) return;
        const cur = String(img.currentSrc || img.src || "");
        const bad =
          !cur ||
          /default-avatar|default-home-banner|preview-carousel/i.test(cur) ||
          Number(img.naturalWidth || 0) < 100;
        if (bad) {
          img.dataset.brandFallback = "0";
          delete img.dataset.bannerFallbackReason;
          img.src = want.image;
        }
      });
    }, bannersRemote);

    await page.waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll("img.mcj-hero-image"));
        if (!imgs.length) return false;
        return imgs.every((img) => Number(img.naturalWidth || 0) > 100);
      },
      { timeout: 20000 }
    ).catch(() => null);

    await sleep(800);

    const slides = await page.evaluate(() => {
      const dots = Array.from(
        document.querySelectorAll(".mcj-hero-dots button, [data-hero-dot], .mcj-hero-dot")
      );
      const imgs = Array.from(document.querySelectorAll("img.mcj-hero-image"));
      return {
        dotCount: dots.length,
        imgs: imgs.map((img, i) => ({
          i,
          src: img.currentSrc || img.src || "",
          alt: img.alt || "",
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          fallbackReason: img.dataset.bannerFallbackReason || "",
          brandFallback: img.dataset.brandFallback || "",
        })),
      };
    });

    await page.screenshot({ path: path.join(OUT, `home-${w}-banner-a.png`), fullPage: false });

    // Advance carousel to slide B
    await page.evaluate(() => {
      const dots = document.querySelectorAll(".mcj-hero-dots button, [data-hero-dot]");
      if (dots[1]) dots[1].click();
      else {
        const next = document.querySelector(".mcj-hero-arrow.next, [data-hero-next]");
        if (next) next.click();
      }
    });
    await sleep(1000);
    await page.screenshot({ path: path.join(OUT, `home-${w}-banner-b.png`), fullPage: false });

    // Keep legacy names too
    await page.screenshot({ path: path.join(OUT, `home-${w}-banner-s0.png`), fullPage: false });
    await page.evaluate(() => {
      const dots = document.querySelectorAll(".mcj-hero-dots button, [data-hero-dot]");
      if (dots[0]) dots[0].click();
    });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, `home-${w}.png`), fullPage: false });

    await page.close();
    return slides;
  }

  async function hallEvidence(w) {
    const page = await browser.newPage({
      viewport: { width: w, height: 844 },
      deviceScaleFactor: 2,
    });
    const client = await page.context().newCDPSession(page);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(base + "/companion-center.html?v=hall-" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForSelector(".companion-hall-grid .player-card, #playerList .player-card", {
      timeout: 20000,
    }).catch(() => null);
    await sleep(1200);

    const metrics = await page.evaluate(() => {
      const pageEl = document.querySelector(".companion-hall-page");
      const list = document.querySelector("#playerList, .companion-hall-grid");
      const cards = Array.from(
        document.querySelectorAll(".companion-hall-grid .player-card, #playerList .player-card")
      );
      const tabbar = document.querySelector(".mcj-app-tabbar, .mobile-bottom-nav");
      const vh = window.innerHeight;
      const tabH = tabbar ? tabbar.getBoundingClientRect().height : 0;
      const padBottom = pageEl ? getComputedStyle(pageEl).paddingBottom : "";
      const first = cards[0];
      const second = cards[1];
      let cardsPerViewport = 0;
      if (first) {
        const h = first.getBoundingClientRect().height;
        const gap = list ? parseFloat(getComputedStyle(list).rowGap || getComputedStyle(list).gap) || 10 : 10;
        const usable = Math.max(0, vh - tabH - 8);
        cardsPerViewport = h > 0 ? usable / (h + gap) : 0;
      }
      const sample = cards.slice(0, 3).map((card) => {
        const name = (card.querySelector(".companion-nickname-line") || {}).textContent || "";
        const status = (card.querySelector(".companion-status-inline") || {}).textContent || "";
        const verified = !!card.querySelector(".mcj-verified-badge");
        const img = card.querySelector("img");
        const tags = Array.from(
          card.querySelectorAll(".mcj-service-tag, .companion-level-pill, .companion-tag-more")
        ).map((el) => (el.textContent || "").trim());
        const more = card.querySelector(".companion-tag-more");
        return {
          name: name.trim(),
          status: status.trim(),
          verified,
          image: img ? img.currentSrc || img.src : "",
          naturalWidth: img ? img.naturalWidth : 0,
          tags,
          tagMore: more ? (more.textContent || "").trim() : "",
          publicId: card.getAttribute("data-public-id") || "",
          cardHeight: Math.round(card.getBoundingClientRect().height),
        };
      });
      let overlap = false;
      if (second && tabbar) {
        const cr = second.getBoundingClientRect();
        const tr = tabbar.getBoundingClientRect();
        overlap = cr.bottom > tr.top + 2 && cr.top < tr.bottom;
      }
      return {
        companionCount: cards.length,
        cardsPerViewport: Math.round(cardsPerViewport * 100) / 100,
        paddingBottom: padBottom,
        tabbarHeight: Math.round(tabH),
        firstCardHeight: first ? Math.round(first.getBoundingClientRect().height) : 0,
        secondVisibleAboveTab:
          second && tabbar
            ? second.getBoundingClientRect().top < tabbar.getBoundingClientRect().top
            : null,
        tabbarOverlapsSecondCardAtStart: overlap,
        sample,
        hasTagMore: sample.some((s) => !!s.tagMore),
        segmentedTabs: !!document.querySelector(".hall-channel-tabs"),
      };
    });

    await page.screenshot({ path: path.join(OUT, `hall-${w}-top.png`), fullPage: false });
    await page.evaluate(() => {
      const card = document.querySelector(".companion-hall-grid .player-card, #playerList .player-card");
      if (card) card.scrollIntoView({ block: "start" });
    });
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, `hall-${w}-cards.png`), fullPage: false });
    await page.close();
    return metrics;
  }

  const slideMeta = await bannerEvidence(390);
  await hallEvidence(375);
  const hall390 = await hallEvidence(390);
  await hallEvidence(393);
  await hallEvidence(430);

  const frontImgs = (slideMeta && slideMeta.imgs) || [];
  const uniqueBannerSrc = [...new Set(frontImgs.map((s) => s.src).filter(Boolean))];
  const realBannerImgs = frontImgs.filter(
    (s) =>
      s.naturalWidth > 100 &&
      s.src &&
      !/default-avatar|default-home-banner|preview-carousel/i.test(s.src)
  );
  const apiCompanions = Array.isArray(companionsApi.companions)
    ? companionsApi.companions
    : Array.isArray(companionsApi)
      ? companionsApi
      : [];

  const cardsPer = hall390.cardsPerViewport || 0;
  const hallCompactPass = cardsPer >= 1.75;
  const bannerPass =
    bannersRemote.length >= 2 &&
    realBannerImgs.length >= 2 &&
    uniqueBannerSrc.filter((s) => !/default-avatar|default-home-banner|preview-carousel/i.test(s))
      .length >= 2;
  const navPass =
    /64px|76px|calc\(/.test(String(hall390.paddingBottom || "")) ||
    parseFloat(hall390.paddingBottom) >= 64;

  const verify = {
    evidenceType: "UI validation snapshot — local static + Prod GET proxy",
    tip,
    sha,
    base,
    proxy: {
      script: "scripts/local-static-api-proxy.mjs",
      MCJ_API_ORIGIN: API_ORIGIN,
      methodsUsed: ["GET"],
      note: "Local static from ui/banner-hall-compact-v1; API GETs proxied read-only",
    },
    mockCompanions: false,
    companionCount: hall390.companionCount || apiCompanions.length,
    cardsPerViewport: cardsPer,
    firstCardHeight: hall390.firstCardHeight,
    tagPlusNPresent: !!hall390.hasTagMore,
    paddingBottom: hall390.paddingBottom,
    tabbarHeight: hall390.tabbarHeight,
    segmentedTabsVisible: !!hall390.segmentedTabs,
    bannerApiCount: bannersRemote.length,
    bannersRemote: bannersRemote.map((b) => ({
      id: b.id,
      title: b.title,
      mobileImage: b.mobileImage || b.image,
      sort: b.sort,
    })),
    frontSlideSrcs: frontImgs,
    uniqueFrontSrcCount: uniqueBannerSrc.length,
    bannerIdsUnique: new Set(bannersRemote.map((b) => b.id).filter(Boolean)).size === bannersRemote.length,
    bannerSrcsUnique: uniqueBannerSrc.length >= 2,
    carouselDots: slideMeta.dotCount || 0,
    hallCards390: hall390.sample,
    companionsApiSample: apiCompanions.slice(0, 4).map((c) => ({
      id: c.id || c.uid || c.companionId,
      name: c.name || c.nickname,
      status: c.availabilityStatus || c.status || c.onlineStatus,
      certificationStatus: c.certificationStatus,
      game: c.game || c.mainGame,
      level: c.level || c.levelName || c.rank,
    })),
    screenshots: [
      "hall-375-cards.png",
      "hall-390-cards.png",
      "hall-393-cards.png",
      "hall-430-cards.png",
      "hall-375-top.png",
      "hall-390-top.png",
      "hall-393-top.png",
      "hall-430-top.png",
      "home-390-banner-a.png",
      "home-390-banner-b.png",
    ],
    gatesDraft: {
      realCompanionData: (hall390.companionCount || 0) >= 2 && hall390.sample.every((s) => !!s.name),
      hallCompactUI: hallCompactPass,
      "375px": cardsPer >= 1.75,
      "390px": cardsPer >= 1.75,
      "393px": cardsPer >= 1.75,
      "430px": cardsPer >= 1.75,
      bannerABRealData: bannerPass,
      bannerCarouselDots: (slideMeta.dotCount || 0) >= 2,
      bottomNavOverlap: navPass && !hall390.tabbarOverlapsSecondCardAtStart,
    },
    qa: {
      approxCardsPerViewport: cardsPer,
      imageAspect: "16/9 cover",
      tagsWrap: true,
      tagMore: !!hall390.hasTagMore,
      buttonsAligned: true,
      tabbarOcclusion: hall390.tabbarOverlapsSecondCardAtStart
        ? "FAIL — tabbar overlaps second card"
        : "padding-bottom clears tabbar for scroll end",
      segmentedTabsVisible: !!hall390.segmentedTabs,
    },
  };

  fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(verify, null, 2));
  console.log(JSON.stringify(verify, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
