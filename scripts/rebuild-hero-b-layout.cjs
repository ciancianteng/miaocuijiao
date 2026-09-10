/**
 * Reorder homepage: Hero (B-layout) → Banner → Announcement.
 * Swap mascot to transparent hero IP. UTF-8 safe.
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(file, "utf8");

const brandHero = `    <section class="home-brand-hero" data-home-brand-hero aria-label="妙脆角 APP 首页顶部">
      <div class="home-brand-hero-inner">
        <div class="home-brand-hero-copy">
          <p class="home-brand-hero-kicker">MEOW CUI JIAO</p>
          <h1 class="home-brand-hero-title">妙脆角</h1>
          <div class="home-brand-hero-stats home-trust-stats" data-home-brand-hero-stats data-home-daily-stats aria-label="平台实时数据" hidden></div>
          <p class="home-brand-hero-tagline">精选陪玩 · 真实在线 · 安心下单</p>
          <div class="home-brand-hero-actions">
            <a class="home-brand-hero-btn primary" href="companion-center.html">进入陪玩大厅</a>
            <a class="home-brand-hero-btn" href="support.html?start=1">联系客服</a>
          </div>
        </div>
        <div class="home-brand-hero-visual" aria-hidden="true">
          <span class="home-brand-hero-aura"></span>
          <span class="mcj-chip mcj-chip--a"></span>
          <span class="mcj-chip mcj-chip--b"></span>
          <span class="mcj-chip mcj-chip--c"></span>
          <span class="mcj-chip mcj-chip--d"></span>
          <img class="home-brand-hero-mascot" src="/assets/meow-cuijiao-hero-ip.webp" alt="" width="1024" height="1024" decoding="async" fetchpriority="high">
        </div>
      </div>
    </section>

`;

const promo = `    <section class="mcj-home-hero mcj-home-hero--promo" data-mcj-home-hero aria-label="活动轮播"></section>

`;

const mainMarker = '<main class="container mcj-app-home">';
const mainIdx = html.indexOf(mainMarker);
if (mainIdx < 0) throw new Error("main missing");
const afterMain = mainIdx + mainMarker.length;

const announceIdx = html.indexOf('id="homeAnnouncementBar"', afterMain);
if (announceIdx < 0) throw new Error("announcement missing");
const announceStart = html.lastIndexOf("<div class=\"announcement-strip", announceIdx);
if (announceStart < 0) throw new Error("announcement start missing");

// Find end of announcement block (closing </div> of strip)
let depth = 0;
let announceEnd = -1;
for (let i = announceStart; i < html.length; i++) {
  if (html.startsWith("<div", i)) {
    depth++;
    i += 3;
    continue;
  }
  if (html.startsWith("</div>", i)) {
    depth--;
    i += 5;
    if (depth === 0) {
      announceEnd = i + 1;
      break;
    }
  }
}
if (announceEnd < 0) throw new Error("announcement end missing");
while (announceEnd < html.length && (html[announceEnd] === "\n" || html[announceEnd] === "\r")) announceEnd++;

const announcementBlock = html.slice(announceStart, announceEnd);

// Remove everything from afterMain until after announcement (old hero+announcement+maybe banner)
const promoIdx = html.indexOf('data-mcj-home-hero', announceEnd);
const promoStart = html.lastIndexOf("<section", promoIdx);
const promoEnd = html.indexOf("</section>", promoStart) + "</section>".length;
let afterPromo = promoEnd;
while (afterPromo < html.length && (html[afterPromo] === "\n" || html[afterPromo] === "\r")) afterPromo++;

const rest = html.slice(afterPromo);
html = html.slice(0, afterMain) + "\n" + brandHero + promo + announcementBlock + "\n\n" + rest;

// Ensure body class
if (!html.includes('class="mcj-app-shell"') && !html.includes("mcj-app-shell")) {
  html = html.replace(/<body([^>]*)>/, '<body class="mcj-app-shell"$1>');
}

html = html.replace(/home-brand-hero\.css\?v=[^"]+/, "home-brand-hero.css?v=20260910appProto2");
html = html.replace(/home-trust-stats\.css\?v=[^"]+/, "home-trust-stats.css?v=20260910appProto2");
html = html.replace(/home-app-mobile\.css\?v=[^"]+/, "home-app-mobile.css?v=20260910appProto2");
html = html.replace(/home-banner\.css\?v=[^"]+/, "home-banner.css?v=20260910appProto2");
html = html.replace(/home-daily-stats\.js\?v=[^"]+/, "home-daily-stats.js?v=20260910appProto2");
html = html.replace(/home-banner\.js\?v=[^"]+/, "home-banner.js?v=20260910appProto2");

fs.writeFileSync(file, html, "utf8");
const v = fs.readFileSync(file, "utf8");
const orderOk =
  v.indexOf("data-home-brand-hero") < v.indexOf("data-mcj-home-hero") &&
  v.indexOf("data-mcj-home-hero") < v.indexOf("homeAnnouncementBar");
console.log(
  JSON.stringify(
    {
      zh: v.includes("妙脆角"),
      ip: v.includes("meow-cuijiao-hero-ip"),
      chips: v.includes("mcj-chip"),
      orderOk,
      statsInCopy: /home-brand-hero-copy[\s\S]*?data-home-daily-stats/.test(v),
      statsOutsideHero: (v.match(/data-home-daily-stats/g) || []).length === 1,
    },
    null,
    2
  )
);
