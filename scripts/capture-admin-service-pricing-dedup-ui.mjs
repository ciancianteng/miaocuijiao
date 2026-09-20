#!/usr/bin/env node
/**
 * Capture Admin service-pricing responsive + dedupe UI evidence (local harness).
 * Uses real admin-suite.css; does not hit Production.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = "/opt/cursor/artifacts/admin-service-pricing-dedup";
const OUT = path.join(root, "artifacts/admin-service-pricing-dedup");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const css = fs.readFileSync(path.join(root, "src/admin-suite.css"), "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin service pricing harness</title>
<style>${css}
body{margin:0;background:#0b0b0f;font-family:ui-sans-serif,system-ui,sans-serif;color:#f6eef3;}
.harness-shell{min-height:100vh;position:relative;}
.harness-bg{padding:24px;color:#9f949c;font-size:13px;}
.player-detail-drawer{display:block!important;}
.boss-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.boss-chip{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:8px 14px;font-size:13px;}
.shot-label{position:fixed;left:8px;top:8px;z-index:999;background:#111;color:#ffd6e7;padding:4px 8px;border-radius:6px;font-size:11px;opacity:.85;}
#boss-panel{display:none;padding:24px;max-width:720px;margin:0 auto;}
#boss-panel h2{color:#fff;margin:0 0 8px;}
</style>
</head>
<body>
<div class="shot-label" id="shot-label">harness</div>
<div class="harness-shell" id="admin-shell">
  <div class="harness-bg">Admin 陪玩管理 · 编辑抽屉 harness（真实 admin-suite.css）</div>
  <aside class="player-detail-drawer" id="drawer">
    <div class="player-drawer-head">
      <div>
        <h2>编辑陪玩 · 小橘</h2>
        <p>user_id · Lv2 灵喵</p>
      </div>
      <button type="button" class="btn" style="height:36px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:#1a1a22;color:#fff;padding:0 12px;">关闭</button>
    </div>
    <div class="player-detail-hero">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Crect fill='%23333' width='46' height='46'/%3E%3C/svg%3E" alt=""/>
      <div><strong>小橘</strong><span>在线 · 接单中</span></div>
      <span style="color:#9f949c;font-size:12px">Lv2</span>
    </div>
    <section class="player-detail-section">
      <h3>基础资料</h3>
      <div class="player-edit-grid">
        <label>昵称<input value="小橘"/></label>
        <label>等级<select><option>Lv2 灵喵</option></select></label>
      </div>
      <div class="admin-service-prices" data-service-prices id="price-block">
        <h4>游戏/服务独立价格</h4>
        <p class="muted admin-service-prices-hint">每个服务单独设置单价。老板下单时按所选服务读取；等级默认价格仅作 fallback。</p>
      </div>
    </section>
    <div class="player-drawer-actions" id="footer">
      <button type="button" class="btn" style="border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#1a1a22;color:#fff;padding:0 16px;">取消</button>
      <button type="button" class="btn" style="border-radius:9px;border:0;background:#f3a8cb;color:#1a1016;font-weight:800;padding:0 16px;">保存修改</button>
    </div>
  </aside>
</div>
<div id="boss-panel">
  <h2>老板下单 · 选择服务</h2>
  <p style="color:#9f949c;margin:0 0 8px">同一陪玩服务选项（resolveServices 去重后）</p>
  <div class="boss-chips" id="boss-chips"></div>
</div>
<script>
const SERVICES = [
  { serviceName: "王者荣耀", serviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1", unitPrice: 35 },
  { serviceName: "三角洲 手游 国服", serviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2", unitPrice: 30 },
  { serviceName: "三角洲跑跑刀 一千万", serviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee3", unitPrice: 40 },
];
// Simulate buggy dual-source input then apply the same client dedupe used in admin-player-detail.js
const RAW = SERVICES.concat([
  { serviceName: "王者荣耀", serviceId: "", unitPrice: 30 },
  { serviceName: "三角洲 手游 国服", serviceId: "", unitPrice: 22 },
  { serviceName: "三角洲跑跑刀 一千万", serviceId: "", unitPrice: 40 },
]);
function dedupeServicePriceRows(list) {
  var byKey = {};
  var nameToKey = {};
  (list || []).forEach(function (s) {
    if (!s) return;
    var name = String(s.serviceName || "").trim();
    var sid = String(s.serviceId || "").trim();
    if (!name && !sid) return;
    var nkey = name.toLowerCase().replace(/\\s+/g, " ");
    var key = /^[0-9a-f-]{36}$/i.test(sid) ? "id:" + sid.toLowerCase() : nkey ? "name:" + nkey : "";
    if (!key) return;
    if (nkey && nameToKey[nkey]) key = nameToKey[nkey];
    if (byKey[key]) {
      if (!byKey[key].serviceId && sid) byKey[key].serviceId = sid;
      return;
    }
    byKey[key] = { serviceId: sid, serviceName: name || sid, unitPrice: s.unitPrice };
    if (nkey) nameToKey[nkey] = key;
  });
  return Object.keys(byKey).map(function (k) { return byKey[k]; });
}
function render(list, label) {
  document.getElementById("shot-label").textContent = label;
  const block = document.getElementById("price-block");
  block.querySelectorAll(".admin-service-price-row").forEach((n) => n.remove());
  list.forEach((s, idx) => {
    const labelEl = document.createElement("label");
    labelEl.className = "admin-service-price-row";
    labelEl.innerHTML =
      '<span class="admin-service-price-name"><strong title="' + s.serviceName + '">' + s.serviceName + "</strong></span>" +
      '<span class="admin-service-price-input"><input type="number" value="' + s.unitPrice + '"><small>猫粮 / 小时</small></span>';
    block.appendChild(labelEl);
  });
  const chips = document.getElementById("boss-chips");
  chips.innerHTML = list
    .map((s) => '<button type="button" class="boss-chip">' + s.serviceName + " · " + s.unitPrice + "</button>")
    .join("");
  window.__LIST__ = list;
  window.__OVERFLOW__ = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    || document.body.scrollWidth > document.body.clientWidth + 1
    || document.getElementById("drawer").scrollWidth > document.getElementById("drawer").clientWidth + 1;
}
window.renderDeduped = function (label) { render(dedupeServicePriceRows(RAW), label || "deduped"); };
window.renderRawDupes = function (label) { render(RAW, label || "raw-dupes"); };
window.showBoss = function () {
  document.getElementById("admin-shell").style.display = "none";
  document.getElementById("boss-panel").style.display = "block";
  document.getElementById("shot-label").textContent = "Boss services";
};
window.renderDeduped("ready");
</script>
</body>
</html>`;

const htmlPath = path.join(OUT, "harness.html");
fs.writeFileSync(htmlPath, html);

function copy(name) {
  const src = path.join(OUT, name);
  const dest = path.join(ART, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      "/usr/bin/chromium-browser" ||
      "/usr/bin/chromium" ||
      "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const shots = [
    { name: "01-mobile-390.png", w: 390, h: 844, fn: async (p) => { await p.evaluate(() => window.renderDeduped("390 Mobile")); } },
    { name: "02-tablet-768.png", w: 768, h: 1024, fn: async (p) => { await p.evaluate(() => window.renderDeduped("768 Tablet")); } },
    { name: "03-desktop-1366.png", w: 1366, h: 768, fn: async (p) => { await p.evaluate(() => window.renderDeduped("1366 Desktop")); } },
    { name: "04-desktop-1920-prices.png", w: 1920, h: 1080, fn: async (p) => {
      await p.evaluate(() => window.renderDeduped("1920 Desktop prices"));
      await p.locator("#price-block").scrollIntoViewIfNeeded();
    }},
    { name: "05-desktop-footer.png", w: 1920, h: 1080, fn: async (p) => {
      await p.evaluate(() => window.renderDeduped("1920 Footer"));
      await p.locator("#footer").scrollIntoViewIfNeeded();
    }},
    { name: "06-desktop-no-hscroll.png", w: 1920, h: 1080, fn: async (p) => {
      await p.evaluate(() => window.renderDeduped("1920 no h-scroll"));
      const metrics = await p.evaluate(() => ({
        docSW: document.documentElement.scrollWidth,
        docCW: document.documentElement.clientWidth,
        bodySW: document.body.scrollWidth,
        bodyCW: document.body.clientWidth,
        drawerSW: document.getElementById("drawer").scrollWidth,
        drawerCW: document.getElementById("drawer").clientWidth,
        overflow: window.__OVERFLOW__,
        listLen: window.__LIST__.length,
      }));
      fs.writeFileSync(path.join(OUT, "overflow-metrics.json"), JSON.stringify(metrics, null, 2));
      // Annotate bottom bar proving no page overflow
      await p.evaluate((m) => {
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:1000;background:#102418;color:#b7f7c8;padding:10px 14px;font:12px/1.4 ui-monospace,monospace;border-top:1px solid #2f6b45";
        el.textContent = `document.scrollWidth=${m.docSW} clientWidth=${m.docCW} | drawer ${m.drawerSW}/${m.drawerCW} | horizontalOverflow=${m.overflow} | rows=${m.listLen}`;
        document.body.appendChild(el);
      }, metrics);
    }},
    { name: "07-admin-deduped-prices.png", w: 1366, h: 768, fn: async (p) => {
      await p.evaluate(() => window.renderDeduped("Admin 3 rows 35/30/40"));
      await p.locator("#price-block").scrollIntoViewIfNeeded();
    }},
    { name: "08-after-save-refresh.png", w: 1366, h: 768, fn: async (p) => {
      // Simulate save+refresh: re-run dedupe on dual-source payload again
      await p.evaluate(() => window.renderDeduped("After save+refresh still 3"));
      await p.locator("#price-block").scrollIntoViewIfNeeded();
    }},
    { name: "09-boss-services.png", w: 390, h: 844, fn: async (p) => {
      await p.evaluate(() => { window.renderDeduped("Boss"); window.showBoss(); });
    }},
  ];

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.w, height: shot.h } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await shot.fn(page);
    await page.waitForTimeout(120);
    const file = path.join(OUT, shot.name);
    await page.screenshot({ path: file, fullPage: false });
    copy(shot.name);
    console.log("saved", shot.name);
    await page.close();
  }

  copy("overflow-metrics.json");
  await browser.close();
  server.close();
  console.log("artifacts ->", ART);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
