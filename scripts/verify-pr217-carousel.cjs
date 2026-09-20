const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const BASE = (process.env.BASE || "http://127.0.0.1:5180").replace(/\/$/, "");
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });

function getJson(url) {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { "User-Agent": "mcj", Accept: "application/vnd.github+json" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

async function resolvePreviewBase() {
  if (process.env.BASE) return process.env.BASE.replace(/\/$/, "");
  const deps = await getJson("https://api.github.com/repos/ciancianteng/miaocuijiao/deployments?per_page=8");
  const list = Array.isArray(deps) ? deps : [];
  const preview = list.find((d) => d.environment === "Preview");
  if (!preview) return BASE;
  const st = await getJson(preview.statuses_url);
  const first = Array.isArray(st) ? st[0] : null;
  return (first && (first.environment_url || first.target_url) || BASE).replace(/\/$/, "");
}

async function bannerState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    const slides = [...document.querySelectorAll(".mcj-hero-slide")];
    const dots = [...document.querySelectorAll(".mcj-hero-dots button")];
    const active = document.querySelector(".mcj-hero-slide.is-active");
    const img = active && active.querySelector("img.mcj-hero-image");
    const badge = active && active.querySelector("[data-preview-badge]");
    const arrows = document.querySelectorAll(".mcj-hero-arrow");
    const box = document.querySelector(".mcj-hero-viewport");
    const rect = box ? box.getBoundingClientRect() : null;
    return {
      index: Number((root && root.dataset.heroIndex) || 0),
      slideCount: slides.length,
      dots: dots.length,
      activeDot: dots.findIndex((d) => d.classList.contains("active")),
      src: img ? img.currentSrc || img.getAttribute("src") || "" : "",
      badge: badge ? badge.textContent.trim() : "",
      arrowsVisible: [...arrows].filter((a) => {
        const s = getComputedStyle(a);
        return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.01;
      }).length,
      autoplayMs: Number((root && root.dataset.autoplayMs) || 0),
      box: rect
        ? { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) }
        : null,
    };
  });
}

async function shotBanner(page, file, label) {
  const top = await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    return vp ? Math.max(0, vp.getBoundingClientRect().top - 16) : 280;
  });
  await page.evaluate((text) => {
    document.querySelectorAll("[data-verify-tag]").forEach((n) => n.remove());
    const vp = document.querySelector(".mcj-hero-viewport");
    if (!vp) return;
    const tag = document.createElement("div");
    tag.dataset.verifyTag = "1";
    tag.textContent = text;
    Object.assign(tag.style, {
      position: "absolute",
      right: "8px",
      bottom: "8px",
      zIndex: "40",
      padding: "4px 8px",
      borderRadius: "8px",
      background: "rgba(0,0,0,.78)",
      color: "#fff",
      fontSize: "11px",
      fontWeight: "700",
      pointerEvents: "none",
    });
    vp.appendChild(tag);
  }, label);
  await page.screenshot({
    path: path.join(OUT, file),
    clip: { x: 0, y: top, width: 390, height: 220 },
  });
}

async function dragSwipe(page, direction) {
  const box = await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    if (!vp) return null;
    const r = vp.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (!box) throw new Error("no viewport");
  const y = box.y + box.h / 2;
  const fromX = direction === "left" ? box.x + box.w * 0.82 : box.x + box.w * 0.18;
  const toX = direction === "left" ? box.x + box.w * 0.18 : box.x + box.w * 0.82;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

(async () => {
  const base = await resolvePreviewBase();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  await page.goto(base + "/?v=carousel-proof", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4500);

  // Freeze remote reload noise during proof window
  await page.evaluate(() => {
    window.removeEventListener("focus", window.MCJHomeBanner && window.MCJHomeBanner.applyHome);
  });

  let s1 = await bannerState(page);
  // Ensure start at slide 0
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      const banners = window.MCJHomeBanner.resolveHomeBanners();
      window.MCJHomeBanner.render(root, banners, { index: 0 });
    }
  });
  await page.waitForTimeout(800);
  s1 = await bannerState(page);
  await shotBanner(page, "carousel-01-slide1.png", "Slide 1 · index " + s1.index);

  const autoplayMs = s1.autoplayMs || 4500;
  await page.waitForTimeout(autoplayMs + 900);
  const s2 = await bannerState(page);
  await shotBanner(page, "carousel-02-slide2-autoplay.png", "Autoplay → Slide " + (s2.index + 1));

  // Force to slide 1 then swipe left to slide 2 (third shot = slide 3 after another swipe)
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      window.MCJHomeBanner.render(root, window.MCJHomeBanner.resolveHomeBanners(), { index: 1 });
    }
  });
  await page.waitForTimeout(500);
  await dragSwipe(page, "left");
  const s3 = await bannerState(page);
  await shotBanner(page, "carousel-03-slide3-swipe.png", "Swipe → Slide " + (s3.index + 1));

  // Pagination proof: capture dots area after going 0 -> 1 -> 2 via dots/auto
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      window.MCJHomeBanner.render(root, window.MCJHomeBanner.resolveHomeBanners(), { index: 0 });
    }
  });
  await page.waitForTimeout(400);
  const p0 = await bannerState(page);
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      window.MCJHomeBanner.render(root, window.MCJHomeBanner.resolveHomeBanners(), { index: 1 });
    }
  });
  await page.waitForTimeout(400);
  const p1 = await bannerState(page);
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      window.MCJHomeBanner.render(root, window.MCJHomeBanner.resolveHomeBanners(), { index: 2 });
    }
  });
  await page.waitForTimeout(400);
  const p2 = await bannerState(page);
  await shotBanner(
    page,
    "carousel-04-pagination.png",
    "Dots active=" + (p2.activeDot + 1) + "/" + p2.dots
  );

  // Loop: from last swipe left -> first
  await page.evaluate(() => {
    const root = document.querySelector("[data-mcj-home-hero]");
    if (root && window.MCJHomeBanner) {
      window.MCJHomeBanner.render(root, window.MCJHomeBanner.resolveHomeBanners(), { index: 2 });
    }
  });
  await page.waitForTimeout(400);
  await dragSwipe(page, "left");
  const loop = await bannerState(page);

  // Swipe back
  await dragSwipe(page, "right");
  const swipeBack = await bannerState(page);

  const report = {
    base,
    slideCount: s1.slideCount,
    autoplayMs,
    arrowsVisible: s1.arrowsVisible,
    slide1: s1,
    afterAutoplay: s2,
    afterSwipeTo3: s3,
    pagination: { at0: p0.activeDot, at1: p1.activeDot, at2: p2.activeDot, dots: p2.dots },
    loopToFirst: loop.index,
    swipeBackIndex: swipeBack.index,
    box: s1.box,
  };

  const autoplayPass = s1.index === 0 && s2.index === 1 && s1.slideCount >= 2;
  const swipePass = s3.index === 2;
  const loopPass = loop.index === 0;
  const dotsPass = p0.activeDot === 0 && p1.activeDot === 1 && p2.activeDot === 2 && p2.dots === s1.slideCount;
  const arrowsPass = s1.arrowsVisible === 0;
  const sizePass = s1.box && s1.box.w >= 340 && s1.box.w <= 370 && s1.box.h >= 140 && s1.box.h <= 160;
  const pass = autoplayPass && swipePass && loopPass && dotsPass && arrowsPass && sizePass && s1.slideCount >= 3;

  fs.writeFileSync(
    path.join(OUT, "carousel-verify.json"),
    JSON.stringify(
      {
        pass,
        checks: { autoplayPass, swipePass, loopPass, dotsPass, arrowsPass, sizePass },
        report,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      {
        pass,
        checks: { autoplayPass, swipePass, loopPass, dotsPass, arrowsPass, sizePass },
        slideCount: report.slideCount,
        autoplayMs: report.autoplayMs,
        indexes: { s1: s1.index, autoplay: s2.index, swipe3: s3.index, loop: loop.index },
        pagination: report.pagination,
        arrowsVisible: report.arrowsVisible,
        box: report.box,
        base,
      },
      null,
      2
    )
  );
  await browser.close();
  if (!pass) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
