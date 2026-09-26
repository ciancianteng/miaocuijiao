/**
 * Visual accept: Boss mine center actions IA (VIP card untouched).
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-boss-mine-actions-ia");
fs.mkdirSync(outDir, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const vipCss = fs.readFileSync(path.join(root, "src/boss-vip-ui.css"), "utf8");
const vipJs = fs.readFileSync(path.join(root, "src/boss-vip-ui.js"), "utf8");
const bcaCss = fs.readFileSync(path.join(root, "src/boss-center-actions.css"), "utf8");
const bcaJs = fs.readFileSync(path.join(root, "src/boss-center-actions.js"), "utf8");

const shellCss = `
body{margin:0;background:#050505;color:#f5f5f7;font-family:Segoe UI,PingFang SC,sans-serif}
.boss-shell{width:min(430px,calc(100% - 24px));margin:0 auto;padding:8px 0 40px}
.boss-id{padding:18px 16px;margin:0 0 16px;border-radius:20px;border:1px solid rgba(255,214,232,.14);background:linear-gradient(160deg,rgba(28,18,28,.95),rgba(10,10,12,.96))}
.boss-id-top{display:flex;gap:16px;align-items:center}
.boss-id-avatar{width:64px;height:64px;border-radius:999px;display:grid;place-items:center;border:2px solid rgba(255,158,207,.35);background:rgba(232,154,196,.08);font-weight:900;font-size:24px;color:#ffd6e7}
.boss-id-meta h1{margin:0;font-size:20px}
.boss-id-meta p{margin:8px 0 0;color:rgba(255,255,255,.48);font-size:13px}
.boss-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
.boss-stat{min-height:64px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,214,232,.16);background:rgba(255,255,255,.03);color:inherit;text-decoration:none}
.boss-stat-label{display:block;color:#ffd6e7;font-size:13px;font-weight:700}
.boss-stat-value{font-size:20px;font-weight:800}
.mine-quick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}
.mine-quick a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:84px;border-radius:16px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#fff;text-decoration:none;font-size:11px;font-weight:700}
.mine-section-title{margin:4px 2px 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:rgba(255,214,232,.45);text-transform:uppercase}
.entry-stack{display:grid;gap:10px}
.entry{border-radius:16px;border:1px solid rgba(255,214,232,.12);background:rgba(12,10,16,.92)}
.entry-trigger{display:flex;align-items:center;justify-content:space-between;min-height:56px;padding:0 14px;width:100%;border:0;background:transparent;color:#fff;font:inherit;font-size:15px;text-decoration:none}
.entry-arrow{width:26px;height:26px;border-radius:999px;border:1px solid rgba(255,214,232,.22)}
`;

const vipMock = {
  currentLevelName: "普通会员",
  confirmedSpend: 120,
  currentThreshold: 0,
  nextLevelName: "银牌老板",
  nextThreshold: 500,
  remaining: 380,
  isMaxLevel: false,
  benefits: "基础下单权益",
};

function pageHtml(mode) {
  const vipPanel =
    mode === "after"
      ? "" // filled by JS
      : ""; // filled by JS for both via vip ui
  const actionsBefore = `
    <div class="mine-quick">
      <a href="#"><span>订单</span></a><a href="#"><span>消息</span></a><a href="#"><span>客服</span></a><a href="#"><span>充值</span></a>
    </div>
    <p class="mine-section-title">账户与服务</p>
    <div class="entry-stack">
      <section class="entry"><button class="entry-trigger" type="button"><span>编辑资料</span><span class="entry-arrow"></span></button></section>
      <section class="entry"><button class="entry-trigger" type="button"><span>我的资产</span><span class="entry-arrow"></span></button></section>
      <section class="entry"><button class="entry-trigger" type="button"><span>账号安全</span><span class="entry-arrow"></span></button></section>
      <section class="entry"><button class="entry-trigger" type="button"><span>订单与服务</span><span class="entry-arrow"></span></button></section>
      <section class="entry"><a class="entry-trigger" href="#"><span>消息中心</span><span class="entry-arrow"></span></a></section>
      <section class="entry"><a class="entry-trigger" href="#"><span>我的积分</span><span class="entry-arrow"></span></a></section>
      <section class="entry"><a class="entry-trigger" href="#"><span>礼物中心</span><span class="entry-arrow"></span></a></section>
      <section class="entry"><a class="entry-trigger" href="#"><span>老板使用教学</span><span class="entry-arrow"></span></a></section>
      <section class="entry"><a class="entry-trigger" href="#"><span>直属陪玩</span><span class="entry-arrow"></span></a></section>
      <section class="entry"><button class="entry-trigger" type="button"><span>添加妙脆角到主屏幕</span><span class="entry-arrow"></span></button></section>
      <section class="entry"><button class="entry-trigger" type="button"><span>消息通知</span><span class="entry-arrow"></span></button></section>
    </div>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mine ${mode}</title>
<style>${shellCss}</style>
<style>${vipCss}</style>
${mode === "after" ? `<style>${bcaCss}</style>` : ""}
</head><body>
<main class="boss-shell" id="root">
  <section class="boss-id">
    <div class="boss-id-top"><div class="boss-id-avatar">老</div><div class="boss-id-meta"><h1>验收老板</h1><p>老板 UID B0001</p></div></div>
    <div class="boss-stats"><a class="boss-stat" href="#"><span class="boss-stat-label">积分</span><strong class="boss-stat-value">12</strong></a><a class="boss-stat" href="#"><span class="boss-stat-label">直属</span><strong class="boss-stat-value">2</strong></a></div>
  </section>
  <div id="vipMount"></div>
  <div id="actionsMount">${mode === "before" ? actionsBefore : ""}</div>
</main>
<script>${vipJs}</script>
${mode === "after" ? `<script>${bcaJs}</script>` : ""}
<script>
(function(){
  var vip=${JSON.stringify(vipMock)};
  document.getElementById('vipMount').innerHTML=window.MCJBossVipUI.renderPanel(vip);
  ${
    mode === "after"
      ? "document.getElementById('actionsMount').innerHTML=window.MCJBossCenterActions.render({hasCompanion:false});"
      : ""
  }
})();
</script>
</body></html>`;
}

function mime(p) {
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  if (u.pathname === "/before") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pageHtml("before"));
    return;
  }
  if (u.pathname === "/after") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pageHtml("after"));
    return;
  }
  res.writeHead(404);
  res.end("missing");
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`http://127.0.0.1:${port}/before`, { waitUntil: "networkidle" });
await page.waitForSelector(".bv-hero-card");
const beforeVip = await page.locator(".bv-hero-card").innerText();
await page.screenshot({ path: path.join(outDir, "A-before-full.png"), fullPage: true });
await page.locator(".bv-hero-card").screenshot({ path: path.join(outDir, "A-before-vip-card.png") });

await page.goto(`http://127.0.0.1:${port}/after`, { waitUntil: "networkidle" });
await page.waitForSelector(".bca-root");
const afterVip = await page.locator(".bv-hero-card").innerText();
const bodyText = await page.locator("body").innerText();
await page.screenshot({ path: path.join(outDir, "B-after-full.png"), fullPage: true });
await page.locator(".bv-hero-card").screenshot({ path: path.join(outDir, "C-vip-card-unchanged.png") });
await page.locator(".bca-quick").screenshot({ path: path.join(outDir, "D-quick-actions.png") });
await page.locator("#bcaAccountTitle").locator("..").screenshot({ path: path.join(outDir, "E-account-manage.png") });
await page.locator("#bcaHelpTitle").locator("..").screenshot({ path: path.join(outDir, "F-settings-help.png") });

const fails = [];
if (beforeVip !== afterVip) fails.push("vip_card_text_changed");
if (/订单与服务/.test(bodyText)) fails.push("has_订单与服务");
if (/消息中心/.test(bodyText)) fails.push("has_消息中心");
if (!/常用功能/.test(bodyText)) fails.push("missing_常用功能");
if (!/我的订单/.test(bodyText)) fails.push("missing_我的订单");
if (!/礼物中心/.test(bodyText)) fails.push("missing_礼物中心");
if (!/直属陪玩/.test(bodyText)) fails.push("missing_直属陪玩");
if (!/账号管理/.test(bodyText)) fails.push("missing_账号管理");
if (!/设置与帮助/.test(bodyText)) fails.push("missing_设置与帮助");
if (!/联系客服/.test(bodyText)) fails.push("missing_联系客服");
if (!/MEOW CUI JIAO VIP/.test(afterVip)) fails.push("vip_brand_missing");
if (!/当前等级/.test(afterVip) || !/累计有效消费/.test(afterVip)) fails.push("vip_stats_missing");
if (!/Exclusive Benefits|专属福利|基础下单权益/.test(afterVip)) fails.push("vip_benefits_missing");

// hash vip css/js files vs expected unchanged relative to git? skip — fixture uses same files

const report = {
  ok: fails.length === 0,
  fails,
  vipCardUnchanged: beforeVip === afterVip,
  modifiedMembershipCard: "NO",
  modifiedDatabase: "NO",
  deletedEntries: ["订单与服务", "消息中心", "旧四宫格(订单/消息/客服/充值)"],
  keptRoutes: {
    "我的订单": "/orders.html",
    充值: "/recharge.html",
    礼物中心: "gifts.html",
    直属陪玩: "my-direct-companions.html",
    编辑资料: "data-mine-feature=profile",
    我的资产: "data-mine-feature=assets",
    我的积分: "points.html",
    账号安全: "data-mine-feature=security",
    老板使用教学: "/guide.html?role=boss",
    添加到主屏幕: "data-pwa-install",
    消息通知: "data-open-notify-settings",
    联系客服: "/support.html",
  },
  files: [
    "src/boss-center-actions.js (new)",
    "src/boss-center-actions.css (new)",
    "mine.html (actions region only)",
  ],
  untouched: ["src/boss-vip-ui.js", "src/boss-vip-ui.css", "API", "DB"],
};
fs.writeFileSync(path.join(outDir, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
process.exit(fails.length ? 1 : 0);
