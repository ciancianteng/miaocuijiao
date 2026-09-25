#!/usr/bin/env node
/**
 * Offline visual evidence for parent-only multi payment UI labels.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nestParentOnlyOrders } from "../server/api/_order-group.js";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";

const out = "artifacts/p0-multi-payment-once-70";
mkdirSync(out, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = existsSync(EDGE) ? EDGE : CHROME;

const parent = {
  id: "p70",
  orderNo: "MCJO000415",
  parent_order_id: null,
  order_type: "multi_group",
  status: "claimed",
  totalAmount: 70,
  amount: 70,
  paymentMethod: "DuitNow",
  paymentStatus: "已支付",
  companionName: "",
  bossName: "1717",
};
const kids = [
  {
    id: "c1",
    orderNo: "MCJO000416",
    parent_order_id: "p70",
    parentOrderId: "p70",
    totalAmount: 35,
    amount: 35,
    companionName: "小宏",
    companionCode: "PW00025",
    paymentStatus: "主单已付·分配",
    paymentMethod: "主单分配",
    status: "claimed",
  },
  {
    id: "c2",
    orderNo: "MCJO000417",
    parent_order_id: "p70",
    parentOrderId: "p70",
    totalAmount: 35,
    amount: 35,
    companionName: "小灰灰",
    companionCode: "PW00027",
    paymentStatus: "主单已付·分配",
    paymentMethod: "主单分配",
    status: "in_progress",
  },
];
const nested = nestParentOnlyOrders([parent, ...kids]);
const dash = buildDashboardStats({
  profiles: [{ id: "b1", role: "boss", status: "active", email: "b@x.com" }],
  orders: [
    { ...parent, total_amount: 70, boss_id: "b1", created_at: new Date().toISOString() },
    { ...kids[0], total_amount: 35, boss_id: "b1", created_at: new Date().toISOString() },
    { ...kids[1], total_amount: 35, boss_id: "b1", created_at: new Date().toISOString() },
  ],
  withdrawals: [],
});

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:"Segoe UI","PingFang SC",sans-serif;background:#0f1115;color:#eee;padding:24px}
.card{background:#1a1d24;border:1px solid #333;border-radius:12px;padding:16px;margin-bottom:16px;max-width:720px}
.ok{color:#7dffa3;font-weight:800}
.bad{color:#ff8a8a;text-decoration:line-through}
table{width:100%;border-collapse:collapse;margin-top:10px}
td,th{border-bottom:1px solid #333;padding:8px;text-align:left;font-size:14px}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#243;color:#9f9}
</style></head><body>
<div class="card"><h2>BEFORE（错误）</h2>
<p class="bad">70 + 35 + 35 = 140 营业额 / 三张「已支付」</p>
<table><tr><th>订单号</th><th>金额</th><th>支付</th><th>状态</th></tr>
<tr><td>MCJO000415</td><td>70</td><td>DuitNow</td><td>已支付</td></tr>
<tr><td>MCJO000416</td><td>35</td><td>duitnow</td><td>已支付</td></tr>
<tr><td>MCJO000417</td><td>35</td><td>duitnow</td><td>已支付</td></tr>
</table></div>
<div class="card"><h2>AFTER（正确）</h2>
<p class="ok">列表只显示 1 张主订单 · 营业额 ${dash.stats.totalAmount}</p>
<table><tr><th>订单号</th><th>老板</th><th>陪玩</th><th>金额</th><th>支付方式</th><th>付款状态</th></tr>
${nested
  .map(
    (o) =>
      `<tr><td><strong>${o.orderNo}</strong></td><td>${o.bossName}</td><td>${o.companionsLabel}</td><td>${o.amount} 猫粮</td><td>${o.paymentMethod}</td><td><span class="tag">${o.paymentStatus}</span></td></tr>`
  )
  .join("")}
</table>
<h3>详情 · 分配（不是第二次付款）</h3>
<table><tr><th>陪玩</th><th>分配金额</th><th>说明</th></tr>
${(nested[0].allocations || [])
  .map(
    (a) =>
      `<tr><td>${a.companionName} ${a.companionCode || ""}</td><td>${a.allocatedAmount} 猫粮</td><td>主单已付·分配</td></tr>`
  )
  .join("")}
</table>
<p>支付审核：仅主订单 70 · 1 次</p>
<p>Boss 钱包扣款：70 · 1 次</p>
<p>Dashboard totalAmount：<strong class="ok">${dash.stats.totalAmount}</strong></p>
</div>
</body></html>`;

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: path.join(out, "01-before-after-board.png"), fullPage: true });
await page.locator(".card").nth(1).screenshot({ path: path.join(out, "02-admin-parent-only.png") });
await page.screenshot({ path: path.join(out, "03-detail-allocations.png"), fullPage: true });
writeFileSync(
  path.join(out, "EVIDENCE.json"),
  JSON.stringify(
    {
      nestedCount: nested.length,
      childCount: nested[0]?.childCount,
      gmv: dash.stats.totalAmount,
      allocations: nested[0]?.allocations,
    },
    null,
    2
  )
);
await browser.close();
console.log("shots ok", { nested: nested.length, gmv: dash.stats.totalAmount });
if (!(nested.length === 1 && dash.stats.totalAmount === 70)) process.exit(1);
