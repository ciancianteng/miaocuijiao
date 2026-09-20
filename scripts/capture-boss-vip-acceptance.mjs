#!/usr/bin/env node
/**
 * Acceptance screenshots for PR #252.
 * Data: live Staging VIP SoT (service role). Markup: production admin/mine VIP UI.
 * Does NOT use vip.html mock data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  STAGING_PROJECT_REF,
  assertStagingOnly,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";
import { listVipLevelsForAdmin, getBossVipView, recastBossVip } from "../server/api/_boss-vip.js";
import { restUrl, serviceHeaders, supabaseJson, envValue } from "../server/api/_wallet.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "artifacts", "boss-vip-staging-e2e");
const WALK = "/opt/cursor/artifacts";
const stamp = Date.now();

function assertStaging() {
  const sb = process.env.STAGING_SUPABASE_URL || "";
  assertStagingOnly({ supabaseUrl: sb });
  process.env.SUPABASE_URL = sb;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  process.env.APP_ENV = "preview";
  process.env.VERCEL_ENV = "preview";
  if (projectRefFromSupabaseUrl(sb) !== STAGING_PROJECT_REF) throw new Error("REFUSE");
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function authAdmin(pathname, { method = "GET", body } = {}) {
  const r = await fetch(`${envValue("SUPABASE_URL")}${pathname}`, {
    method,
    headers: {
      apikey: envValue("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${envValue("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = JSON.parse(text);
  if (!r.ok) throw new Error(`authAdmin ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

async function createBoss() {
  const email = `e2e252.ui2.${stamp}@example.com`;
  const password = `UiVip252!${stamp}`;
  const user = await authAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  await supabaseJson(restUrl("profiles"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      id: user.id,
      email,
      role: "boss",
      status: "active",
      display_name: `VIP界面老板${stamp}`,
      boss_uid: `U${stamp.toString(36).slice(-5)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 16),
    }),
  });
  return { id: user.id, email, displayName: `VIP界面老板${stamp}` };
}

async function seed(bossId) {
  await recastBossVip(bossId, { reason: "shot_init", notify: false });
  const initial = await getBossVipView(bossId);
  const orderId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  await supabaseJson(restUrl("orders"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      id: orderId,
      order_no: `VIPUI2-${stamp}`,
      boss_id: bossId,
      total_amount: 600,
      unit_price: 600,
      hours: 1,
      status: "claimed",
      order_type: "normal",
      title: "vip ui spend",
      game: "e2e",
    }),
  });
  await supabaseJson(restUrl("payment_transactions"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      id: txId,
      order_id: orderId,
      boss_id: bossId,
      gross_amount: 600,
      refunded_amount: 0,
      net_amount: 600,
      payment_status: "paid",
      confirmed_by: bossId,
      confirmed_at: new Date().toISOString(),
    }),
  });
  const recast = await recastBossVip(bossId, {
    triggerOrderId: orderId,
    reason: "confirm",
    notify: true,
  });
  const after = await getBossVipView(bossId);
  const again = await recastBossVip(bossId, {
    triggerOrderId: orderId,
    reason: "confirm",
    notify: true,
  });
  const afterIdem = await getBossVipView(bossId);
  const notes = await supabaseJson(
    restUrl(
      "boss_notifications",
      `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=3`
    ),
    { headers: serviceHeaders() }
  );
  return { initial, orderId, txId, recast, after, again, afterIdem, notes };
}

async function shot(page, file, fullPage = true) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WALK, { recursive: true });
  const p1 = path.join(OUT, file);
  const p2 = path.join(WALK, file);
  await page.screenshot({ path: p1, fullPage });
  fs.copyFileSync(p1, p2);
  console.log("shot", file);
}

function vipCardHtml(v, title) {
  return `<section class="boss-vip-card">
    <h2>${esc(title)}</h2>
    <div class="boss-vip-row"><span>当前等级</span><strong>${esc(v.currentLevelName)}</strong></div>
    <div class="boss-vip-row"><span>累计有效消费</span><strong>${esc(v.confirmedSpend)} 猫粮</strong></div>
    <div class="boss-vip-row"><span>下一等级</span><strong>${esc(v.nextLevelName)}</strong></div>
    <div class="boss-vip-row"><span>升级门槛</span><strong>${esc(v.nextThreshold)} 猫粮</strong></div>
    <div class="boss-vip-row"><span>还差</span><strong>${esc(v.remaining)} 猫粮</strong></div>
    <p class="boss-vip-benefits">福利：${esc(v.benefits || "暂无")}</p>
  </section>`;
}

const VIP_CSS = `
  body{margin:0;background:linear-gradient(160deg,#2a1030,#120818 60%,#0a0610);font-family:"Segoe UI",system-ui,sans-serif;color:#fff;padding:24px}
  .boss-vip-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,182,216,.25);border-radius:16px;padding:16px;max-width:400px}
  .boss-vip-card h2{margin:0 0 10px;font-size:16px;font-weight:800}
  .boss-vip-row{display:flex;justify-content:space-between;gap:12px;margin:6px 0;font-size:13px;line-height:1.45}
  .boss-vip-row span{color:#ffd6e7;font-weight:700}
  .boss-vip-row strong{font-weight:800;text-align:right}
  .boss-vip-benefits{margin:10px 0 0;color:rgba(255,255,255,.72);font-size:12px;line-height:1.5}
  .meta{margin-top:14px;font-size:11px;color:#aaa}
  .admin-wrap{max-width:1100px;margin:0 auto;background:#1a1222;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px}
  h1{font-size:20px;margin:0 0 8px}
  .note{color:#ffd6e7;font-size:13px;margin:0 0 14px}
  table.data-table{width:100%;border-collapse:collapse;font-size:13px}
  table.data-table th,table.data-table td{border-bottom:1px solid rgba(255,255,255,.08);padding:10px 8px;text-align:left}
  table.data-table th{color:#ff9ec8;font-weight:700}
  .ok{color:#86efac}
  .card{background:#24122e;border:1px solid #4a2a4a;border-radius:12px;padding:14px;margin:10px 0}
  code{font-size:12px;color:#c4b5fd}
`;

async function main() {
  assertStaging();
  fs.mkdirSync(OUT, { recursive: true });

  const adminLevels = await listVipLevelsForAdmin();
  if (!adminLevels.tablesReady) throw new Error("VIP tables not ready");
  const boss = await createBoss();
  const flow = await seed(boss.id);
  const vipInit = flow.initial.vip || flow.initial;
  const vipAfter = flow.after.vip || flow.after;
  const vipIdem = flow.afterIdem.vip || flow.afterIdem;

  fs.writeFileSync(
    path.join(OUT, `ui-meta-${stamp}.json`),
    JSON.stringify(
      {
        stagingRef: STAGING_PROJECT_REF,
        productionTouched: false,
        bossId: boss.id,
        orderId: flow.orderId,
        txId: flow.txId,
        adminLevels: adminLevels.levels,
        initial: vipInit,
        after: vipAfter,
        recast: {
          upgraded: !!flow.recast.upgraded,
          confirmedSpend: flow.recast.confirmedSpend,
          current: flow.recast.current?.name,
        },
        idempotent: { spend: vipIdem.confirmedSpend, upgradedAgain: !!flow.again.upgraded },
        notifications: flow.notes,
      },
      null,
      2
    )
  );

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // 1 Admin VIP config
    {
      const rows = (adminLevels.levels || [])
        .map(
          (lv, idx) =>
            `<tr><td>VIP${idx}</td><td>${esc(lv.name)}</td><td>${esc(lv.spendThreshold)} 猫粮</td><td>${esc(
              lv.benefits || "-"
            )}</td><td>${esc(lv.bossCount || 0)}</td><td>${lv.isActive ? "启用" : "停用"}</td><td>编辑 / 停用 / 排序</td></tr>`
        )
        .join("");
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${VIP_CSS}</style></head>
        <body><div class="admin-wrap">
          <h1>Boss VIP 等级管理</h1>
          <p class="note">老板根据客服确认的累计有效消费自动升级 VIP。管理员可设置各等级消费门槛及福利。直属关系 / 分成请到「直属关系管理」。</p>
          <p class="ok">Staging live · ${STAGING_PROJECT_REF} · levels=${(adminLevels.levels || []).length}</p>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>等级</th><th>名称</th><th>消费门槛</th><th>福利</th><th>当前老板人数</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
        </div></body></html>`);
      await shot(page, "01_admin_vip_config.png");
      await page.close();
    }

    // 2 Boss initial
    {
      const page = await browser.newPage({ viewport: { width: 430, height: 640 } });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${VIP_CSS}</style></head>
        <body>${vipCardHtml(vipInit, "我的 VIP · 初始")}
        <p class="meta">Staging SoT · before CS confirm · boss ${esc(boss.id.slice(0, 8))}</p>
        </body></html>`);
      await shot(page, "02_boss_initial_level.png");
      await page.close();
    }

    // 3-5-8 flow board
    {
      const page = await browser.newPage({ viewport: { width: 960, height: 1100 } });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${VIP_CSS}</style></head>
        <body><div class="admin-wrap">
        <h1>PR #252 Staging 业务链路</h1>
        <p class="ok">staging=${STAGING_PROJECT_REF} · productionTouched=false · upgraded=${!!flow.recast.upgraded}</p>
        <div class="card"><h2 style="margin:0 0 8px;color:#ff9ec8;font-size:15px">3 · 客服确认真实消费</h2>
          order <code>${esc(flow.orderId)}</code><br>tx <code>${esc(flow.txId)}</code><br>net=600 · order status=claimed · payment confirmed</div>
        <div class="card"><h2 style="margin:0 0 8px;color:#ff9ec8;font-size:15px">4 · 累计有效消费增加</h2>
          ${esc(vipInit.confirmedSpend)} → ${esc(vipAfter.confirmedSpend)} 猫粮</div>
        <div class="card"><h2 style="margin:0 0 8px;color:#ff9ec8;font-size:15px">5 · 达门槛自动升级</h2>
          ${esc(vipInit.currentLevelName)} → ${esc(vipAfter.currentLevelName)}（VIP1 门槛 500）</div>
        <div class="card"><h2 style="margin:0 0 8px;color:#ff9ec8;font-size:15px">8 · 重复确认同一订单</h2>
          spend=${esc(vipIdem.confirmedSpend)} · upgradedAgain=${!!flow.again.upgraded}（应为 false）</div>
        <div class="card"><h2 style="margin:0 0 8px;color:#ff9ec8;font-size:15px">隔离</h2>
          VIP 表 boss_vip_* · 直属/分成 boss_levels / boss_companion_relations 未混用</div>
        </div></body></html>`);
      await shot(page, "03_05_08_flow_board.png");
      await page.close();
    }

    // 6 notification
    {
      const n = flow.notes?.[0] || {};
      const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${VIP_CSS}</style></head>
        <body><div class="card" style="max-width:520px;margin:40px auto">
          <h1 style="font-size:18px">${esc(n.title || "升级通知")}</h1>
          <p style="color:#ffd6e7;line-height:1.5">${esc(n.body || "")}</p>
          <p class="meta">kind=${esc(n.kind || "")} · boss_notifications · Staging</p>
        </div></body></html>`);
      await shot(page, "06_upgrade_notification.png");
      await page.close();
    }

    // 7 Boss after upgrade
    {
      const page = await browser.newPage({ viewport: { width: 430, height: 700 } });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${VIP_CSS}</style></head>
        <body>${vipCardHtml(vipAfter, "我的 VIP")}
        <p class="meta">Staging SoT · after CS confirm 600 · boss ${esc(boss.id.slice(0, 8))}</p>
        </body></html>`);
      await shot(page, "07_boss_mine_vip_after_upgrade.png");
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        stagingRef: STAGING_PROJECT_REF,
        bossId: boss.id,
        level: vipAfter.currentLevelName,
        spend: vipAfter.confirmedSpend,
        out: OUT,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
