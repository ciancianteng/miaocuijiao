/**
 * Build Mobile App Prototype homepage markup on main (UTF-8 safe).
 * Keeps CMS banner API mount; adds brand hero + app tabbar.
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(file, "utf8");

const brandHero = `    <section class="home-brand-hero" data-home-brand-hero aria-label="妙脆角 APP 首页顶部">
      <div class="home-brand-hero-inner">
        <div class="home-brand-hero-copy">
          <p class="home-brand-hero-kicker">MEOW CUI JIAO</p>
          <h1 class="home-brand-hero-title">妙脆角<span>MEOW CUI JIAO</span></h1>
          <p class="home-brand-hero-tagline">精选陪玩 · 真实在线 · 安心下单</p>
          <div class="home-brand-hero-actions">
            <a class="home-brand-hero-btn primary" href="companion-center.html">进入陪玩大厅</a>
            <a class="home-brand-hero-btn" href="support.html?start=1">联系客服</a>
          </div>
        </div>
        <div class="home-brand-hero-visual" aria-hidden="true">
          <span class="home-brand-hero-aura"></span>
          <img class="home-brand-hero-mascot" src="/assets/meow-cuijiao-brand.jpg" alt="" width="640" height="640" decoding="async" fetchpriority="high">
        </div>
        <div class="home-brand-hero-stats home-trust-stats" data-home-brand-hero-stats data-home-daily-stats aria-label="平台实时数据" hidden></div>
      </div>
    </section>

`;

const promo = `    <section class="mcj-home-hero mcj-home-hero--promo" data-mcj-home-hero aria-label="活动轮播"></section>

`;

const appTabbar = `  <nav class="mobile-bottom-nav mcj-app-tabbar" aria-label="底部导航">
    <a class="active" href="index.html" data-app-tab="home"><span class="mcj-app-tab-ico" aria-hidden="true">⌂</span><span class="mcj-app-tab-label">首页</span></a>
    <a href="companion-center.html" data-app-tab="hall"><span class="mcj-app-tab-ico" aria-hidden="true">▦</span><span class="mcj-app-tab-label">大厅</span></a>
    <a href="orders.html" data-app-tab="orders"><span class="mcj-app-tab-ico" aria-hidden="true">☰</span><span class="mcj-app-tab-label">订单</span></a>
    <a href="support.html?start=1" data-app-tab="support"><span class="mcj-app-tab-ico" aria-hidden="true">💬</span><span class="mcj-app-tab-label">客服</span></a>
    <a href="mine.html" data-app-tab="mine" data-mobile-mine><span class="mcj-app-tab-ico" aria-hidden="true">☺</span><span class="mcj-app-tab-label">我的</span></a>
  </nav>`;

const mainMarker = '<main class="container">';
const mainIdx = html.indexOf(mainMarker);
if (mainIdx < 0) throw new Error("main missing");
const afterMain = mainIdx + mainMarker.length;

const announceIdx = html.indexOf('id="homeAnnouncementBar"', afterMain);
const announceStart = html.lastIndexOf('<div class="announcement-strip', announceIdx);
const statsIdx = html.indexOf("data-home-daily-stats", announceStart);
const statsStart = html.lastIndexOf("<section", statsIdx);
const statsEnd = html.indexOf("</section>", statsIdx) + "</section>".length;
let end = statsEnd;
while (end < html.length && (html[end] === "\n" || html[end] === "\r")) end++;

// Remove original top CMS hero between main and announcement
const heroStart = html.indexOf('<section class="mcj-home-hero"', afterMain);
if (heroStart < 0 || heroStart > announceStart) throw new Error("cms hero missing");
const heroEnd = html.indexOf("</section>", heroStart) + "</section>".length;
let afterHero = heroEnd;
while (afterHero < html.length && (html[afterHero] === "\n" || html[afterHero] === "\r")) afterHero++;

const announcementBlock = html.slice(announceStart, statsStart);
const rest = html.slice(end);

html =
  html.slice(0, afterMain) +
  "\n" +
  brandHero +
  announcementBlock +
  promo +
  rest;

html = html.replace(/<main class="container">/, '<main class="container mcj-app-home">');
html = html.replace(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/, appTabbar);

if (!html.includes('class="mcj-app-shell"')) {
  html = html.replace(/<body([^>]*)>/, '<body class="mcj-app-shell"$1>');
}

// CSS links
if (!html.includes("home-brand-hero.css")) {
  html = html.replace(
    /(<link rel="stylesheet" href="src\/home-banner\.css\?v=[^"]+">)/,
    '$1\n  <link rel="stylesheet" href="src/home-brand-hero.css?v=20260910appProto1">\n  <link rel="stylesheet" href="src/home-trust-stats.css?v=20260910appProto1">'
  );
}
if (!html.includes("home-app-mobile.css")) {
  html = html.replace(
    /(<link rel="stylesheet" href="src\/home-mobile\.css\?v=[^"]+">)/,
    '$1\n  <link rel="stylesheet" href="src/home-app-mobile.css?v=20260910appProto1">'
  );
}

html = html.replace(/home-banner\.css\?v=[^"]+/, "home-banner.css?v=20260910appProto1");
html = html.replace(/home-mobile\.css\?v=[^"]+/, "home-mobile.css?v=20260910appProto1");
html = html.replace(/home-desktop\.css"/, 'home-desktop.css?v=20260910appProto1"');
html = html.replace(/home-desktop\.css\?v=[^"]+/, "home-desktop.css?v=20260910appProto1");
html = html.replace(/home-daily-stats\.js\?v=[^"]+/, "home-daily-stats.js?v=20260910appProto1");
html = html.replace(/home-banner\.js\?v=[^"]+/, "home-banner.js?v=20260910appProto1");
html = html.replace(/boss-header\.css\?v=[^"]+/, "boss-header.css?v=20260910appProto1");

fs.writeFileSync(file, html, "utf8");
const v = fs.readFileSync(file, "utf8");
console.log(
  JSON.stringify(
    {
      brand: v.includes("data-home-brand-hero"),
      promo: v.includes("mcj-home-hero--promo"),
      appCss: v.includes("home-app-mobile.css"),
      tabbar: v.includes("mcj-app-tabbar"),
      zh: /妙脆角|快速入口|底部导航/.test(v),
      standaloneStatsGone: (v.match(/data-home-daily-stats/g) || []).length === 1,
    },
    null,
    2
  )
);
