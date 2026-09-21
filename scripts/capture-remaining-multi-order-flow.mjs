/**
 * Capture remaining-flow acceptance screenshots (local branch + Production guide).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = "/opt/cursor/artifacts/remaining-multi-order-flow";
fs.mkdirSync(outDir, { recursive: true });
const LOCAL = process.env.ACCEPT_BASE || "http://127.0.0.1:8765";
const PROD = "https://www.meowcuijiao.com";
const XIAOHUIHUI = "737b7c07-cab8-4270-a2da-6eee49135559";
const XIAOHONG = "458c3d2e-5803-403b-9a25-af1d12c8d142";

const result = { ok: false, steps: [] };

async function save(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  result.steps.push(name);
  return file;
}

function toLine(row, serviceName) {
  const services = Array.isArray(row.services) ? row.services : [];
  const picked = services.find((s) => s.name === serviceName) || services[0];
  return {
    companionId: row.id,
    companionName: row.name || row.nickname,
    avatar: row.avatar || row.cover || "",
    unitPrice: Number(picked?.price) || Number(row.price) || 30,
    service: picked?.name || serviceName,
    serviceId: picked?.serviceId || picked?.id || "",
    game: row.game,
    services,
    gamePrices: row.gamePrices || {},
    online: true,
    hours: 1,
    quantity: 1,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const hui = await fetch(`${PROD}/api/public/companions?id=${XIAOHUIHUI}`).then((r) => r.json());
  const hong = await fetch(`${PROD}/api/public/companions?id=${XIAOHONG}`).then((r) => r.json());
  const rowA = (hui.companions || [])[0];
  const rowB = (hong.companions || [])[0];

  // Ensure accept page exists
  const acceptPath = "/workspace/artifacts/remaining-multi-order-flow/accept.html";
  fs.mkdirSync(path.dirname(acceptPath), { recursive: true });
  fs.writeFileSync(
    acceptPath,
    `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>剩余流程验收</title>
<link rel="stylesheet" href="/src/multi-companion-team.css?v=20260921remaining1">
<link rel="stylesheet" href="/src/place-order-modal.css?v=20260921remaining1">
<style>
body{margin:0;background:#120c14;color:#fff;font-family:"PingFang SC","Noto Sans SC",sans-serif}
.story{min-height:160vh;padding:20px 16px}
.profile-bottom-bar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));background:#1a121c}
.profile-bottom-bar button,.profile-bottom-bar a{flex:1;height:44px;border-radius:999px;border:0;font-weight:800;display:flex;align-items:center;justify-content:center;text-decoration:none}
.pd-bottom-secondary{background:transparent;color:#ffd6e8;border:1px solid rgba(243,168,203,.4)!important}
.pd-bottom-primary{background:#f3a8cb;color:#2a1020}
.companion-hall-page{padding:16px;min-height:120vh}
.hall-card{padding:16px;margin:12px 0;border:1px solid rgba(255,255,255,.12);border-radius:16px}
</style></head>
<body class="profile-detail-page">
<div class="story"><h1>多人联合下单验收</h1><p id="note">local branch</p>
<section class="companion-hall-page" id="hall" hidden>
  <h2>陪玩大厅（草稿保留）</h2>
  <div class="hall-card">卡片 A</div><div class="hall-card">卡片 B</div><div class="hall-card">卡片 C（应不被队伍栏挡住）</div>
</section>
</div>
<nav class="profile-bottom-bar" hidden></nav>
<script src="/src/mcj-time-picker.js?v=20260921remaining1"></script>
<script src="/src/place-order-modal.js?v=20260921remaining1"></script>
<script src="/src/multi-companion-team.js?v=20260921remaining1"></script>
<script>
// Simulate profile CTA paint after team restore race
setTimeout(function(){
  var b=document.querySelector('.profile-bottom-bar');
  if(b){b.hidden=false;b.className='profile-bottom-bar pd-bottom-bar';
    b.innerHTML='<a class="pd-bottom-secondary" href="#">咨询客服</a><button class="pd-bottom-primary" type="button">立即下单</button>';
    if(window.MCJMultiCompanionTeam) window.MCJMultiCompanionTeam.syncBottomStackOffset();
  }
}, 80);
</script>
</body></html>`
  );

  // Mobile local: team bar stacking
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const page = await mob.newPage();
  await page.goto(`${LOCAL}/artifacts/remaining-multi-order-flow/accept.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MCJMultiCompanionTeam);

  await page.evaluate((a) => {
    window.MCJMultiCompanionTeam.clear();
    window.MCJMultiCompanionTeam.add(a);
  }, toLine(rowA, "三角洲 手游 国服"));
  await page.waitForTimeout(300);
  const stack1 = await page.evaluate(() => {
    const team = document.querySelector("[data-mcj-team-bar]");
    const bottom = document.querySelector(".profile-bottom-bar");
    const tr = team && team.getBoundingClientRect();
    const br = bottom && bottom.getBoundingClientRect();
    const gap = tr && br ? Math.round(br.top - tr.bottom) : null;
    return {
      gap,
      actionsH: getComputedStyle(document.documentElement).getPropertyValue("--mcj-bottom-actions-h"),
      teamBottom: team && getComputedStyle(team).bottom,
      noOverlap: gap == null ? false : gap >= 4,
    };
  });
  result.stack1 = stack1;
  await save(page, "01_mobile_team_bar_no_overlap.png");

  // Continue选 → draft retained (simulate hall on same page)
  await page.evaluate(() => {
    sessionStorage.setItem("mcjMultiTeamPicking", "1");
    document.getElementById("hall").hidden = false;
    document.querySelector(".story h1").textContent = "大厅 · 草稿保留";
    if (window.MCJMultiCompanionTeam) window.MCJMultiCompanionTeam.syncBottomStackOffset();
  });
  await page.waitForTimeout(200);
  const draft = await page.evaluate(() => {
    const raw = sessionStorage.getItem("mcjMultiTeamSelection");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {}
    return {
      picking: sessionStorage.getItem("mcjMultiTeamPicking"),
      count: (parsed && parsed.lines && parsed.lines.length) || 0,
      first: parsed && parsed.lines && parsed.lines[0] && {
        name: parsed.lines[0].companionName,
        service: parsed.lines[0].service,
        unitPrice: parsed.lines[0].unitPrice,
      },
    };
  });
  result.draftAfterContinue = draft;
  await save(page, "02_mobile_continue_select_draft_kept.png");

  // Add second + checkout: game id + time + voice + status 待提交
  await page.evaluate((b) => {
    window.MCJMultiCompanionTeam.add(b);
    window.MCJMultiCompanionTeam.openCheckout();
  }, toLine(rowB, "王者荣耀 国服"));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll("[data-mcj-team-toast]").forEach((el) => el.remove());
    const gid = document.querySelector("[data-mcj-team-game-id]");
    if (gid) gid.value = "BOSS_GID_DEMO";
  });
  const sheet = await page.evaluate(() => {
    const t = (document.querySelector(".mcj-team-sheet") || {}).innerText || "";
    return {
      hasGameId: /游戏ID/.test(t),
      hasStart: /开始/.test(t),
      hasEnd: /结束|预计结束/.test(t),
      hasVoice: /Discord|游戏麦/.test(t),
      pendingSubmit: /待提交/.test(t),
      total: (t.match(/合计[\s\S]{0,24}/) || [])[0],
    };
  });
  result.sheet = sheet;
  await save(page, "03_mobile_checkout_game_id_time_voice.png");

  await page.evaluate(() => {
    const sc = document.querySelector(".mcj-team-sheet-scroll");
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(200);
  await save(page, "04_mobile_checkout_scrolled_footer.png");

  // Single order modal time + game id
  await page.evaluate(() => {
    document.querySelector("[data-mcj-team-sheet]")?.remove();
    window.MCJPlaceOrder.openFromCompanion(
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "小灰灰",
        price: 35,
        services: [{ name: "三角洲 手游 国服", price: 35, id: "s1" }],
      },
      { unitPrice: 35, service: "三角洲 手游 国服", services: [{ name: "三角洲 手游 国服", price: 35, id: "s1" }] }
    );
  });
  await page.waitForTimeout(400);
  await save(page, "05_mobile_single_order_game_id_time.png");
  await mob.close();

  // Desktop checkout
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const dpage = await desk.newPage();
  await dpage.goto(`${LOCAL}/artifacts/remaining-multi-order-flow/accept.html`, { waitUntil: "domcontentloaded" });
  await dpage.waitForFunction(() => window.MCJMultiCompanionTeam);
  await dpage.evaluate(
    ({ a, b }) => {
      window.MCJMultiCompanionTeam.clear();
      window.MCJMultiCompanionTeam.add(a);
      window.MCJMultiCompanionTeam.add(b);
      window.MCJMultiCompanionTeam.openCheckout();
    },
    { a: toLine(rowA, "三角洲 手游 国服"), b: toLine(rowB, "王者荣耀 国服") }
  );
  await dpage.waitForTimeout(400);
  await dpage.evaluate(() => document.querySelectorAll("[data-mcj-team-toast]").forEach((el) => el.remove()));
  const deskLayout = await dpage.evaluate(() => ({
    sheets: document.querySelectorAll(".mcj-team-sheet").length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  result.desktop = deskLayout;
  await save(dpage, "06_desktop_checkout.png");
  await desk.close();

  // Production guide (live)
  const gmob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const gpage = await gmob.newPage();
  const gres = await gpage.goto(`${PROD}/guide.html?role=boss`, { waitUntil: "domcontentloaded", timeout: 45000 });
  result.guideStatus = gres && gres.status();
  await gpage.waitForTimeout(1200);
  const gtext = await gpage.evaluate(() => (document.body.innerText || "").slice(0, 800));
  result.guideOk = result.guideStatus === 200 && !/NOT_FOUND/.test(gtext);
  result.guideSnippet = gtext.slice(0, 240);
  await save(gpage, "07_prod_mobile_guide_boss.png");
  await gmob.close();

  const gdesk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const gd = await gdesk.newPage();
  await gd.goto(`${PROD}/guide.html?role=boss`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await gd.waitForTimeout(1000);
  await save(gd, "08_prod_desktop_guide_boss.png");
  await gdesk.close();

  // Production profile mobile (live post-#279)
  const pm = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const pp = await pm.newPage();
  await pp.goto(`${PROD}/profile.html?id=${XIAOHUIHUI}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pp.waitForTimeout(1500);
  await save(pp, "09_prod_mobile_profile.png");
  await pm.close();

  result.ok = true;
} catch (err) {
  result.ok = false;
  result.error = String(err && err.stack || err);
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
