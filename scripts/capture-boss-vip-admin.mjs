/**
 * LOCAL acceptance screenshots for Admin Boss VIP + Boss card states.
 * Does not hit Production. Marks LOCAL.
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolveVipLevel, viewBossVipSnapshot } from "../server/api/_boss-vip.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/boss-vip-admin");
const optDir = "/opt/cursor/artifacts/boss-vip-admin";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(optDir, { recursive: true });

const levels = [
  { id: "lv0", name: "普通会员", spend_threshold: 0, benefits: "", sort_order: 0, is_active: true, bossCount: 3 },
  {
    id: "lv1",
    name: "银卡会员",
    spend_threshold: 500,
    benefits: "专属客服\n优先匹配",
    sort_order: 10,
    is_active: true,
    bossCount: 2,
  },
  {
    id: "lv2",
    name: "金卡会员",
    spend_threshold: 2000,
    benefits: "生日福利\n专属活动",
    sort_order: 20,
    is_active: true,
    bossCount: 0,
  },
  {
    id: "lv3",
    name: "钻石会员",
    spend_threshold: 5000,
    benefits: "专属折扣",
    sort_order: 30,
    is_active: true,
    bossCount: 0,
  },
];

function snap(spend) {
  return viewBossVipSnapshot({ confirmedSpend: spend, resolved: resolveVipLevel(spend, levels) });
}

const harness = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Boss VIP Admin LOCAL harness</title>
<link rel="stylesheet" href="/src/boss-vip-ui.css?v=local"/>
<style>
body{margin:0;background:#0b0712;color:#ffe6f2;font-family:system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
.tag{font-size:11px;opacity:.55;margin:0 0 8px}
.admin-card,.panel{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(22,16,28,.96);padding:14px;margin-bottom:16px}
.admin-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
button,.ghost-btn,.primary-btn{border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.06);color:#ffe6f2;padding:8px 12px;min-height:40px}
.primary-btn{background:rgba(243,168,203,.9);color:#1b0712;border:0;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border-bottom:1px solid rgba(255,255,255,.08);padding:8px;text-align:left;vertical-align:top}
label{display:flex;flex-direction:column;gap:4px;font-size:12px}
input,textarea,select{border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#140e1a;color:#ffe6f2;padding:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.stage{display:none}.stage.on{display:block}
.nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.nav button.on{background:rgba(243,168,203,.35)}
</style>
</head><body>
<div class="wrap">
  <p class="tag">LOCAL harness · Admin Boss VIP + Boss card states</p>
  <div class="nav" id="nav"></div>
  <div id="adminMount" class="stage on"></div>
  <div id="bossMount" class="stage"></div>
</div>
<script>
  // Stub MUST exist before admin-boss-vip.js binds Auth.
  window.MCJAdminAuthFetch = {
    fetch: async (url, opts={}) => {
      const u = String(url||'');
      const method = String(opts.method||'GET').toUpperCase();
      let body = {};
      try { body = opts.body ? JSON.parse(opts.body) : {}; } catch(e) {}
      const action = String(body.action||'').toLowerCase();
      const isList = method==='GET' || /action=list/.test(u) || !action || action==='list' || action==='levels';
      if (u.includes('/api/admin/boss-vip') && isList) {
        return { ok:true, status:200, json: async()=>({ ok:true, tablesReady:true, levels: window.__VIP_LEVELS||[] }) };
      }
      return { ok:true, status:200, json: async()=>({ ok:true, message:'saved', levels: window.__VIP_LEVELS||[] }) };
    }
  };
  window.__VIP_LEVELS = ${JSON.stringify(
    levels.map((l) => ({
      id: l.id,
      name: l.name,
      spendThreshold: l.spend_threshold,
      benefits: l.benefits,
      sortOrder: l.sort_order,
      isActive: l.is_active,
      bossCount: l.bossCount,
    }))
  )};
</script>
<script src="/src/admin-boss-vip.js?v=local"></script>
<script src="/src/boss-vip-ui.js?v=local"></script>
<script>
  const adminBox = document.createElement('div');
  adminBox.id = 'bossLevelsMount';
  document.getElementById('adminMount').appendChild(adminBox);

  const snaps = {
    member0: ${JSON.stringify(snap(0))},
    silver600: ${JSON.stringify(snap(600))},
    gold2100: ${JSON.stringify(snap(2100))},
    diamond99999: ${JSON.stringify(snap(99999))},
  };

  window.__VIP_SHOT = {
    showAdminList() {
      document.getElementById('adminMount').classList.add('on');
      document.getElementById('bossMount').classList.remove('on');
      const btn = document.createElement('button');
      btn.setAttribute('data-section','boss-levels');
      document.body.appendChild(btn);
      btn.click();
      btn.remove();
    },
    showAdminNew() {
      this.showAdminList();
      setTimeout(() => { const b = document.querySelector('[data-vip-new]'); if (b) b.click(); }, 80);
    },
    showAdminEdit() {
      this.showAdminList();
      setTimeout(() => {
        const b = document.querySelector('[data-vip-edit="lv1"]') || document.querySelector('[data-vip-edit]');
        if (b) b.click();
        setTimeout(() => { const add = document.querySelector('[data-vip-benefit-add]'); if (add) add.click(); }, 40);
      }, 80);
    },
    showBoss(key) {
      document.getElementById('adminMount').classList.remove('on');
      const boss = document.getElementById('bossMount');
      boss.classList.add('on');
      boss.innerHTML = '<p class="tag">LOCAL · Boss VIP card · ' + key + '</p>' +
        (window.MCJBossVipUI ? window.MCJBossVipUI.renderPanel(snaps[key]) : '');
    }
  };

  const ids = [
    ['A','admin-list'],
    ['B','admin-new'],
    ['C','admin-edit'],
    ['D','boss-0'],
    ['E','boss-600'],
    ['F','boss-2100'],
    ['G','boss-max'],
  ];
  const nav = document.getElementById('nav');
  ids.forEach(([label, key]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      if (key==='admin-list') window.__VIP_SHOT.showAdminList();
      if (key==='admin-new') window.__VIP_SHOT.showAdminNew();
      if (key==='admin-edit') window.__VIP_SHOT.showAdminEdit();
      if (key==='boss-0') window.__VIP_SHOT.showBoss('member0');
      if (key==='boss-600') window.__VIP_SHOT.showBoss('silver600');
      if (key==='boss-2100') window.__VIP_SHOT.showBoss('gold2100');
      if (key==='boss-max') window.__VIP_SHOT.showBoss('diamond99999');
    };
    nav.appendChild(b);
  });
  setTimeout(() => window.__VIP_SHOT.showAdminList(), 100);
</script>
</body></html>`;

fs.writeFileSync(path.join(outDir, "harness.html"), harness);

const PORT = 8788;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/artifacts/boss-vip-admin/harness.html";
  const file = path.join(root, rel.replace(/^\//, ""));
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const shots = [
  ["A", "01_LOCAL_admin_vip_list.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showAdminList())],
  ["B", "02_LOCAL_admin_vip_new.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showAdminNew())],
  ["C", "03_LOCAL_admin_vip_edit_benefits.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showAdminEdit())],
  ["D", "04_LOCAL_boss_member_0.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showBoss("member0"))],
  ["E", "05_LOCAL_boss_progress_600.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showBoss("silver600"))],
  ["F", "06_LOCAL_boss_auto_upgrade_gold.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showBoss("gold2100"))],
  ["G", "07_LOCAL_boss_max_level.png", async (page) => page.evaluate(() => window.__VIP_SHOT.showBoss("diamond99999"))],
];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/artifacts/boss-vip-admin/harness.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  for (const [, name, act] of shots) {
    await act(page);
    await page.waitForTimeout(700);
    const p1 = path.join(outDir, name);
    const p2 = path.join(optDir, name);
    await page.screenshot({ path: p1, fullPage: true });
    fs.copyFileSync(p1, p2);
    console.log("saved", name);
  }
  // mobile boss card
  const mob = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
  const mpage = await mob.newPage();
  await mpage.goto(`http://127.0.0.1:${PORT}/artifacts/boss-vip-admin/harness.html`, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(400);
  await mpage.evaluate(() => window.__VIP_SHOT.showBoss("silver600"));
  await mpage.waitForTimeout(250);
  const m1 = path.join(outDir, "08_LOCAL_boss_progress_mobile.png");
  await mpage.screenshot({ path: m1, fullPage: false });
  fs.copyFileSync(m1, path.join(optDir, "08_LOCAL_boss_progress_mobile.png"));
  console.log("saved 08_LOCAL_boss_progress_mobile.png");
} finally {
  await browser.close();
  server.close();
}

fs.writeFileSync(
  path.join(outDir, "VERIFY.json"),
  JSON.stringify(
    {
      environment: "LOCAL",
      productionPass: false,
      migrationRequired: true,
      sqlExecuted: false,
      existingBackend: true,
      adminEntry: "admin.html → Boss VIP 等级管理",
      validSpendSource: "payment_transactions CS-confirmed net_amount",
    },
    null,
    2
  )
);
fs.copyFileSync(path.join(outDir, "VERIFY.json"), path.join(optDir, "VERIFY.json"));
console.log("DONE");
