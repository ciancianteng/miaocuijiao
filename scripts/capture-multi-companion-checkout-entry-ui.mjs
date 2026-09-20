#!/usr/bin/env node
/**
 * Capture multi-companion checkout-entry UX evidence (local harness).
 * Uses real hall / place-order / team CSS. No Production writes.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = "/opt/cursor/artifacts/multi-companion-checkout-entry";
const OUT = path.join(root, "artifacts/multi-companion-checkout-entry");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const hallCss = fs.readFileSync(path.join(root, "src/companion-hall.css"), "utf8");
const polishCss = fs.existsSync(path.join(root, "src/ui-linglu-polish.css"))
  ? fs.readFileSync(path.join(root, "src/ui-linglu-polish.css"), "utf8")
  : "";
const poCss = fs.readFileSync(path.join(root, "src/place-order-modal.css"), "utf8");
const teamCss = fs.readFileSync(path.join(root, "src/multi-companion-team.css"), "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Multi checkout entry harness</title>
<style>
${hallCss}
${polishCss}
${poCss}
${teamCss}
body{margin:0;background:#0b0b0f;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;}
.shot-label{position:fixed;left:8px;top:8px;z-index:9999;background:#111;color:#ffd6e7;padding:4px 8px;border-radius:6px;font-size:11px;}
.panel{display:none;padding:20px;}
.panel.on{display:block;}
.hall-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:48px 20px 20px;max-width:1100px;margin:0 auto;}
.companion-card{background:#16161c;border:1px solid rgba(255,255,255,.08);border-radius:18px;overflow:hidden;}
.companion-card-cover{height:160px;background:linear-gradient(135deg,#3a2438,#1a1220);}
.companion-card-body{padding:14px;}
.companion-nickname-line{margin:0 0 8px;font-weight:800;}
.companion-card-actions{display:flex;gap:8px;}
.companion-card-action{flex:1;text-align:center;text-decoration:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;border-radius:12px;padding:10px 8px;font-size:13px;font-weight:760;}
.companion-card-action.primary{background:linear-gradient(180deg,#ffe2ef,#e7a0c4);color:#1b0712;border:0;}
.pw-order-card{max-width:520px;margin:40px auto;padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:#141418;}
.pw-group-peers{margin-top:12px;padding:12px;border-radius:12px;background:rgba(243,168,203,.08);}
.pw-peer-chip{display:inline-flex;align-items:center;gap:6px;margin-right:8px;}
.pw-peer-chip img{width:28px;height:28px;border-radius:50%;background:#333;}
.boss-order{max-width:640px;margin:40px auto;padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:#141418;}
.od-child-row{margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(243,168,203,.2);}
</style>
</head>
<body>
<div class="shot-label" id="label">harness</div>

<section class="panel on" id="hall">
  <div class="hall-grid">
    <article class="companion-card">
      <div class="companion-card-cover"></div>
      <div class="companion-card-body">
        <p class="companion-nickname-line">陪玩 A · 小橘</p>
        <div class="companion-card-actions">
          <a class="companion-card-action" href="#">查看详情</a>
          <button type="button" class="companion-card-action primary">立即下单</button>
        </div>
      </div>
    </article>
    <article class="companion-card">
      <div class="companion-card-cover"></div>
      <div class="companion-card-body">
        <p class="companion-nickname-line">陪玩 B · 阿茶</p>
        <div class="companion-card-actions">
          <a class="companion-card-action" href="#">查看详情</a>
          <button type="button" class="companion-card-action primary">立即下单</button>
        </div>
      </div>
    </article>
  </div>
</section>

<section class="panel" id="single-checkout">
  <div class="mcj-po-mask" style="position:relative;inset:auto;display:flex;align-items:center;justify-content:center;min-height:100vh;background:rgba(0,0,0,.55);padding:24px;">
    <div class="mcj-po-dialog" style="width:min(440px,100%);background:#121218;border-radius:18px;overflow:hidden;">
      <div class="mcj-po-scroll" style="padding:16px;">
        <h3 style="margin:0 0 8px">下单确认 · 陪玩 A</h3>
        <p style="color:#9f949c;margin:0 0 12px">英雄联盟 · 2小时 · 30 猫粮</p>
        <div style="padding:12px;border-radius:12px;background:rgba(255,255,255,.04);margin-bottom:12px;">
          <div>已选陪玩：小橘</div>
          <div>英雄联盟 × 2小时</div>
          <div><strong>RM30 / 30猫粮</strong></div>
        </div>
      </div>
      <div class="mcj-po-footer" style="padding:12px 16px 16px;">
        <div class="mcj-po-footer-actions">
          <button type="button" class="mcj-po-add-another">+ 加一位陪玩一起下单</button>
          <button type="button" class="primary mcj-po-submit">确认订单并付款</button>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="panel" id="multi-checkout">
  <div class="mcj-team-sheet-mask" style="position:relative;inset:auto;min-height:100vh;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);padding:16px;">
    <div class="mcj-team-sheet" style="width:min(560px,100%);background:#121218;border-radius:18px 18px 12px 12px;overflow:hidden;">
      <div class="mcj-team-sheet-head" style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
        <h3 style="margin:0">联合下单</h3><span>×</span>
      </div>
      <div class="mcj-team-sheet-scroll" style="padding:14px 16px;max-height:70vh;overflow:auto;">
        <div class="mcj-team-members">
          <article class="mcj-team-member">
            <div class="mcj-team-member-main">
              <img class="mcj-team-member-avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect fill='%23333' width='48' height='48'/%3E%3C/svg%3E" alt="">
              <div class="mcj-team-member-info"><strong>陪玩 A · 小橘</strong><span>英雄联盟 · 2小时</span><em>30 猫粮</em></div>
              <div class="mcj-team-member-actions"><button type="button" class="mcj-team-edit">修改</button><button type="button" class="mcj-team-remove">移除</button></div>
            </div>
          </article>
          <article class="mcj-team-member">
            <div class="mcj-team-member-main">
              <img class="mcj-team-member-avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect fill='%23444' width='48' height='48'/%3E%3C/svg%3E" alt="">
              <div class="mcj-team-member-info"><strong>陪玩 B · 阿茶</strong><span>王者荣耀 · 1小时</span><em>40 猫粮</em></div>
              <div class="mcj-team-member-actions"><button type="button" class="mcj-team-edit">修改</button><button type="button" class="mcj-team-remove">移除</button></div>
            </div>
          </article>
        </div>
        <button type="button" class="mcj-team-add-more">+ 继续添加陪玩</button>
        <p class="mcj-team-pay-hint">本订单一次付款，每位陪玩按自己的服务价格分别结算。</p>
      </div>
      <div class="mcj-team-sheet-foot" style="padding:12px 16px 16px;border-top:1px solid rgba(255,255,255,.08);">
        <div class="mcj-team-sheet-meta"><span>共 2 位陪玩</span><div class="mcj-team-sheet-total">订单总额 <strong>70 猫粮</strong></div></div>
        <button type="button" class="mcj-team-submit">确认付款 70猫粮</button>
      </div>
    </div>
  </div>
</section>

<section class="panel" id="boss-order">
  <div class="boss-order">
    <h3>Boss 订单详情 · 多人陪玩订单</h3>
    <p>一次付款 · 订单总额 70 猫粮</p>
    <div class="od-child-row"><strong>陪玩 A · 小橘</strong><div>英雄联盟 × 2小时 · 30猫粮</div></div>
    <div class="od-child-row"><strong>陪玩 B · 阿茶</strong><div>王者荣耀 × 1小时 · 40猫粮</div></div>
  </div>
</section>

<section class="panel" id="comp-a">
  <article class="pw-order-card">
    <header><h3>Companion A 订单</h3><p>英雄联盟 / 陪玩服务</p></header>
    <div><span>你的订单金额</span> <strong>30 猫粮</strong></div>
    <div><span>预计到手猫粮</span> <strong>（仅自己）</strong></div>
    <div class="pw-group-peers">
      <div class="pw-group-peers-title">本次联合陪玩 · 共 2 位</div>
      <div class="pw-group-peers-row"><span>一起接单</span>
        <strong>
          <span class="pw-peer-chip"><img alt="">小橘</span>
          <span class="pw-peer-chip"><img alt="">阿茶</span>
        </strong>
      </div>
      <p class="pw-note">你只能看到自己的订单金额与收入；其他陪玩收入不会显示。</p>
    </div>
  </article>
</section>

<section class="panel" id="comp-b">
  <article class="pw-order-card">
    <header><h3>Companion B 订单</h3><p>王者荣耀 / 陪玩服务</p></header>
    <div><span>你的订单金额</span> <strong>40 猫粮</strong></div>
    <div><span>预计到手猫粮</span> <strong>（仅自己）</strong></div>
    <div class="pw-group-peers">
      <div class="pw-group-peers-title">本次联合陪玩 · 共 2 位</div>
      <div class="pw-group-peers-row"><span>一起接单</span>
        <strong>
          <span class="pw-peer-chip"><img alt="">小橘</span>
          <span class="pw-peer-chip"><img alt="">阿茶</span>
        </strong>
      </div>
      <p class="pw-note">你只能看到自己的订单金额与收入；其他陪玩收入不会显示。</p>
    </div>
  </article>
</section>

<script>
window.show = function(id, label){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  document.getElementById(id).classList.add('on');
  document.getElementById('label').textContent = label || id;
};
</script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, "harness.html"), html);

function copy(name) {
  const src = path.join(OUT, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ART, name));
}

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const shots = [
    { name: "01-desktop-hall-two-buttons.png", w: 1366, h: 768, fn: (p) => p.evaluate(() => window.show("hall", "Desktop hall · 2 buttons")) },
    { name: "02-mobile-hall-no-team-add.png", w: 390, h: 844, fn: (p) => p.evaluate(() => window.show("hall", "Mobile hall · no 加入一起下单")) },
    { name: "03-single-checkout-add-peer.png", w: 390, h: 844, fn: (p) => p.evaluate(() => window.show("single-checkout", "Single checkout · +加一位陪玩")) },
    { name: "04-multi-checkout-member-list.png", w: 1366, h: 900, fn: (p) => p.evaluate(() => window.show("multi-checkout", "Joint checkout · A+B independent prices")) },
    { name: "05-boss-order-detail.png", w: 1366, h: 768, fn: (p) => p.evaluate(() => window.show("boss-order", "Boss joint order detail")) },
    { name: "06-companion-a-peers.png", w: 390, h: 844, fn: (p) => p.evaluate(() => window.show("comp-a", "Companion A · peers, own income only")) },
    { name: "07-companion-b-peers.png", w: 390, h: 844, fn: (p) => p.evaluate(() => window.show("comp-b", "Companion B · peers, own income only")) },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.w, height: shot.h } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await shot.fn(page);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(OUT, shot.name), fullPage: false });
    copy(shot.name);
    console.log("saved", shot.name);
    await page.close();
  }
  await browser.close();
  server.close();
  console.log("artifacts ->", ART);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
