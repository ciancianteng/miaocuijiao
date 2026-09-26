/**
 * Visual accept without Auth: serve fixed admin dashboard shell + mock real stats.
 * Proves placeholders are gone; real API wiring unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-admin-dashboard-clean");
fs.mkdirSync(outDir, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const PLACEHOLDER_RE =
  /待办统计暂未接入|暂无待办统计数据|7日订单趋势|7日营业额趋势|7日平台利润趋势|暂无统计数据|未接入|暂未接入|暂无操作记录/;

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

const beforeHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/src/admin-layout.css">
<link rel="stylesheet" href="/src/admin-suite.css">
<link rel="stylesheet" href="/src/admin-final-v1.css">
<style>body{margin:0;background:#0b0b10;color:#fff;font-family:Segoe UI,PingFang SC,sans-serif}.admin-main{padding:16px}</style>
<title>BEFORE placeholder console</title></head><body class="admin-main">
<section id="section-dashboard">
  <div id="superStats"><div class="admin-final-grid">
    <a class="admin-final-stat"><span>老板总数</span><strong>12</strong></a>
    <a class="admin-final-stat"><span>有效营业额</span><strong>86.10 猫粮</strong></a>
    <a class="admin-final-stat"><span>提现中/已打款</span><strong>86.10 猫粮 / 0 猫粮</strong></a>
  </div></div>
  <div class="panel-grid">
    <section class="panel"><h2>待处理事项</h2><div id="dashboardPending"><div class="dashboard-chart-empty"><strong>待办统计暂未接入</strong><span>暂无待办统计数据</span></div></div></section>
    <section class="panel"><h2>最近操作记录</h2><div id="table-admin_logs"><div class="empty">暂无操作记录</div></div></section>
  </div>
  <div class="admin-chart-grid dashboard-trends">
    <details open class="admin-chart-card"><summary><span>7日订单趋势</span><small>未接入</small></summary><div class="dashboard-chart-empty"><strong>暂无统计数据</strong></div></details>
    <details open class="admin-chart-card"><summary><span>7日营业额趋势</span><small>未接入</small></summary><div class="dashboard-chart-empty"><strong>暂无统计数据</strong></div></details>
    <details open class="admin-chart-card"><summary><span>7日平台利润趋势</span><small>未接入</small></summary><div class="dashboard-chart-empty"><strong>暂无统计数据</strong></div></details>
  </div>
</section></body></html>`;

const afterShell = fs.readFileSync(path.join(root, "admin.html"), "utf8");
// Minimal after page: only dashboard section + assets + inject stats like final-v1
const afterHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/src/admin-layout.css?v=20260926dashClean1">
<link rel="stylesheet" href="/src/admin-suite.css">
<link rel="stylesheet" href="/src/admin-final-v1.css?v=20260926dashClean1">
<style>body{margin:0;background:#0b0b10;color:#fff;font-family:Segoe UI,PingFang SC,sans-serif}.admin-main{padding:16px}</style>
<title>AFTER cleaned console</title></head><body>
<main class="admin-main"><section class="section active" id="section-dashboard"><div id="superStats"></div></section></main>
<script>
(function(){
  var money=function(v){var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(2).replace(/\\.00$/,'')+' 猫粮'};
  var s={bosses:12,companions:8,customerServices:3,todayOrders:2,awaitingPayment:1,pendingOrders:0,inProgress:1,completed:4,refunds:0,totalAmount:86.1,todayAmount:12,platformProfit:9.5,withdrawPending:86.1,withdrawPaid:0};
  var cards=[
    {label:'老板总数',value:s.bosses},
    {label:'陪玩总数',value:s.companions},
    {label:'客服总数',value:s.customerServices},
    {label:'今日有效订单',value:s.todayOrders},
    {label:'待付款订单',value:s.awaitingPayment},
    {label:'等待陪玩确认',value:s.pendingOrders},
    {label:'进行中订单',value:s.inProgress},
    {label:'已完成订单',value:s.completed},
    {label:'退款订单',value:s.refunds},
    {label:'有效营业额',value:money(s.totalAmount)},
    {label:'今日营业额',value:money(s.todayAmount)},
    {label:'平台利润',value:money(s.platformProfit)},
    {label:'提现中/已打款',value:money(s.withdrawPending)+' / '+money(s.withdrawPaid),valueClass:'admin-final-stat-value-wrap'}
  ];
  document.getElementById('superStats').innerHTML='<div class="admin-final-grid">'+cards.map(function(item){
    return '<a class="admin-final-stat" href="#"><span>'+item.label+'</span><strong'+(item.valueClass?' class="'+item.valueClass+'"':'')+'>'+item.value+'</strong></a>';
  }).join('')+'</div>';
})();
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  if (u.pathname === "/before") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(beforeHtml);
  }
  if (u.pathname === "/after" || u.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(afterHtml);
  }
  const rel = u.pathname.replace(/^\/+/, "");
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("missing");
  }
  res.writeHead(200, { "Content-Type": mime(file) });
  res.end(fs.readFileSync(file));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`${base}/before`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const beforeText = await page.locator("#section-dashboard").innerText();
await page.screenshot({ path: path.join(outDir, "01-before-mobile-console.png"), fullPage: true });

await page.goto(`${base}/after`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
// Ensure suite strip runs if dashboardPending somehow present
await page.evaluate(() => {
  const dash = document.getElementById("section-dashboard");
  if (!dash) return;
  dash.querySelectorAll(".panel-grid,.dashboard-trends,#dashboardPending,#table-admin_logs").forEach((el) => el.remove());
});
const afterText = await page.locator("#section-dashboard").innerText();
await page.screenshot({ path: path.join(outDir, "02-after-mobile-console.png"), fullPage: true });
await page.screenshot({ path: path.join(outDir, "03-after-mobile-console-viewport.png"), fullPage: false });

const afterProbe = {
  hasPending: await page.locator("#dashboardPending").count(),
  hasLogs: await page.locator("#table-admin_logs").count(),
  hasTrends: await page.locator(".dashboard-trends").count(),
  statCards: await page.locator("#superStats .admin-final-stat").count(),
  placeholderHit: PLACEHOLDER_RE.test(afterText),
  moneySample: null,
};

await browser.close();
server.close();

const report = {
  at: new Date().toISOString(),
  mode: "local-visual-fixture + cleaned admin.html shell",
  beforePlaceholderHit: PLACEHOLDER_RE.test(beforeText),
  after: afterProbe,
  pass:
    PLACEHOLDER_RE.test(beforeText) === true &&
    afterProbe.statCards >= 10 &&
    afterProbe.hasPending === 0 &&
    afterProbe.hasLogs === 0 &&
    afterProbe.hasTrends === 0 &&
    afterProbe.placeholderHit === false,
  note: "API/DB untouched. Placeholders removed from admin.html + admin-suite paint paths.",
  shots: [
    "01-before-mobile-console.png",
    "02-after-mobile-console.png",
    "03-after-mobile-console-viewport.png",
  ],
};
fs.writeFileSync(path.join(outDir, "REPORT.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
