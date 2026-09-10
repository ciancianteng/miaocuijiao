/**
 * Acceptance screenshots for mobile app prototype (PR #214).
 * Captures: hero+stats, banner carousel, companions, tabbar, support, mine.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.PROTO_BASE || "http://127.0.0.1:5179/";
const OUT = path.join(__dirname, "..", "docs", "mobile-app-proto-screenshots");
fs.mkdirSync(OUT, { recursive: true });

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge not found");
}

async function settle(page, ms) {
  await page.waitForTimeout(ms);
}

async function go(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() =>
    page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  );
  await settle(page, 1800);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function auditClicks(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const issues = [];
    const selectors = [
      ".home-brand-hero-btn",
      ".mcj-hero-image-link",
      "[data-announcement-open]",
      ".mcj-app-tabbar a",
      ".quick-entry-grid a",
    ];
    const nodes = selectors.flatMap((s) => Array.from(document.querySelectorAll(s))).slice(0, 40);
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const cx = Math.min(window.innerWidth - 2, Math.max(2, rect.left + rect.width / 2));
      const cy = Math.min(window.innerHeight - 2, Math.max(2, rect.top + rect.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (!top) continue;
      if (!(el === top || el.contains(top) || top.contains(el))) {
        issues.push({
          label: String(el.getAttribute("href") || el.getAttribute("aria-label") || el.className).slice(0, 80),
          blocker: String(top.className || top.tagName).slice(0, 80),
        });
      }
    }
    const doc = document.documentElement;
    return {
      overflowX: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      clickIssues: issues.slice(0, 12),
      tagline: (document.querySelector(".home-brand-hero-tagline") || {}).textContent || "",
      statsText: (document.querySelector("[data-home-daily-stats]") || {}).innerText || "",
      hasTodayOrders: /今日有效订单|今日营业额/.test(document.body.innerText || ""),
    };
  });
}

(async () => {
  const executablePath = await findChrome();
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const report = {};

  for (const [w, h, prefix] of [
    [390, 844, "accept-390"],
    [430, 932, "accept-430"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, BASE);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page, 400);
    await shot(page, `${prefix}-01-hero-stats.png`);

    const banner = await page.$("[data-mcj-home-hero], .mcj-home-hero--promo");
    if (banner) {
      await banner.scrollIntoViewIfNeeded();
      await settle(page, 300);
      await shot(page, `${prefix}-02-carousel.png`);
    }

    const ann = await page.$("#homeAnnouncementBar");
    if (ann) {
      await ann.scrollIntoViewIfNeeded();
      await settle(page, 200);
      await shot(page, `${prefix}-03-announcement.png`);
    }

    const hot = await page.$("#hotCompanionTrack, .companion-hall, .hot-companions");
    if (hot) {
      await hot.scrollIntoViewIfNeeded();
      await settle(page, 300);
      await shot(page, `${prefix}-04-companions.png`);
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(page, 300);
    await shot(page, `${prefix}-05-tabbar.png`);

    report[prefix] = await auditClicks(page);

    await go(page, new URL("support.html?start=1", BASE).href);
    await settle(page, 1500);
    await shot(page, `${prefix}-06-support.png`);

    await go(page, new URL("mine.html", BASE).href);
    await settle(page, 1500);
    await shot(page, `${prefix}-07-mine.png`);

    // Visual of logged-in mine App layout (UI mock for screenshot only).
    await page.evaluate(() => {
      document.querySelectorAll(".modal.open, .auth-modal, .mcj-auth-modal, [data-auth-shell], .login-modal").forEach(function (el) {
        el.classList.remove("open");
        el.setAttribute("aria-hidden", "true");
        el.style.display = "none";
      });
      document.body.style.overflow = "";
      var root = document.getElementById("accountApp");
      if (!root) return;
      root.innerHTML =
        '<section class="boss-id"><div class="boss-id-top"><div class="boss-id-avatar">C</div><div class="boss-id-meta"><h1>截图预览老板</h1><p>老板 UID MCJ-DEMO</p></div></div><div class="boss-stats"><a class="boss-stat" href="points.html"><span class="boss-stat-label">积分</span><strong class="boss-stat-value">128</strong></a><a class="boss-stat" href="my-direct-companions.html"><span class="boss-stat-label">直属</span><strong class="boss-stat-value">2</strong></a></div></section><div class="mine-quick" aria-label="常用功能"><a href="orders.html"><span class="mine-quick-ico">单</span><span class="mine-quick-label">订单</span></a><a href="support.html?start=1"><span class="mine-quick-ico">客</span><span class="mine-quick-label">客服</span></a><a href="recharge.html"><span class="mine-quick-ico">充</span><span class="mine-quick-label">充值</span></a><a href="points.html"><span class="mine-quick-ico">分</span><span class="mine-quick-label">积分</span></a></div><p class="mine-section-title">账户与服务</p><div class="entry-stack"><section class="entry"><button type="button" class="entry-trigger"><span class="entry-title">编辑资料</span><span class="entry-arrow"></span></button></section><section class="entry"><button type="button" class="entry-trigger"><span class="entry-title">我的资产</span><span class="entry-arrow"></span></button></section><section class="entry"><button type="button" class="entry-trigger"><span class="entry-title">账号安全</span><span class="entry-arrow"></span></button></section><section class="entry"><button type="button" class="entry-trigger"><span class="entry-title">订单与服务</span><span class="entry-arrow"></span></button></section></div><div class="mine-logout-wrap"><button class="mine-logout" type="button">退出登录</button></div>';
    });
    await settle(page, 500);
    await shot(page, `${prefix}-08-mine-app-layout.png`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, BASE);
  await shot(page, "accept-desktop-1440-hero.png");

  await browser.close();
  fs.writeFileSync(path.join(OUT, "accept-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, report, files: fs.readdirSync(OUT).filter((f) => f.startsWith("accept-")) }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
