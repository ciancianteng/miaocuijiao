#!/usr/bin/env node
/**
 * Offline verification for cert-badge statistics + unified commission.
 * No network: global fetch is stubbed to throw; settlement runs through the real
 * createOrderCompleteHelpers().settleCompanionIncome with an in-memory ledger.
 *
 *   node scripts/verify-cert-badge-offline.mjs
 */
process.env.SUPABASE_URL = "http://offline.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline";
process.env.SETTLEMENT_ENABLED = "true";
process.env.VERCEL_ENV = "preview";
globalThis.fetch = async () => {
  throw new Error("network disabled in offline verify");
};

const { resolveCommissionBadge, badgeSnapshotFrom, readOrderBadgeSnapshot } = await import("../server/api/_cert-badge-ledger.js");
const { orderFigures, sumFigures, rangeBounds, monthlyRows, parseClawbacks, inRange } = await import("../server/api/_cert-badge-stats.js");
const { createOrderCompleteHelpers } = await import("../server/api/_order-complete.js");

let pass = 0;
let fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else fail += 1;
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const PW_A = { user: "00000000-0000-4000-8000-00000000000a", profile: "10000000-0000-4000-8000-00000000000a" };
const PW_B = { user: "00000000-0000-4000-8000-00000000000b", profile: "10000000-0000-4000-8000-00000000000b" };
const BOSS = "00000000-0000-4000-8000-0000000000b0";

let catalog = [
  { id: "badge-a", name: "勋章A", enabled: true, sort: 1, companionShareRate: 70, commissionPriority: 10 },
  { id: "badge-b", name: "勋章B", enabled: true, sort: 2, companionShareRate: 80, commissionPriority: 20 },
];
let assignments = [
  { id: "as-a", companion_profile_id: PW_A.profile, tag_id: "badge-a", status: "active", is_commission_primary: false },
  { id: "as-b", companion_profile_id: PW_B.profile, tag_id: "badge-b", status: "active", is_commission_primary: false },
];
const snapFor = (pw, stage = "bind") =>
  badgeSnapshotFrom({
    openRows: assignments.filter((a) => a.companion_profile_id === pw.profile && ["active", "pending_removal"].includes(a.status)),
    catalog,
    companionUserId: pw.user,
    companionProfileId: pw.profile,
    stage,
  });

// ---------------------------------------------------------------- deterministic commission badge
{
  const two = [
    { tag_id: "badge-a", status: "active" },
    { tag_id: "badge-b", status: "active" },
  ];
  check("多勋章：按佣金优先级取数字小者 (A)", resolveCommissionBadge(two, catalog)?.tag.id === "badge-a");
  check(
    "多勋章：佣金主勋章优先 (B)",
    resolveCommissionBadge([{ tag_id: "badge-a", status: "active" }, { tag_id: "badge-b", status: "active", is_commission_primary: true }], catalog)?.rule === "primary"
  );
  check(
    "多勋章：停用勋章不参与佣金",
    resolveCommissionBadge(two, catalog.map((t) => (t.id === "badge-a" ? { ...t, enabled: false } : t)))?.tag.id === "badge-b"
  );
  check("待取消 (pending_removal) 审批前仍生效", resolveCommissionBadge([{ tag_id: "badge-a", status: "pending_removal" }], catalog)?.tag.id === "badge-a");
  check("已取消 (removed) 不再生效", resolveCommissionBadge([{ tag_id: "badge-a", status: "removed" }], catalog) === null);
  check("顺序无关：结果确定", resolveCommissionBadge([...two].reverse(), catalog)?.tag.id === "badge-a");
  check("无勋章陪玩不写快照 (badge_only)", badgeSnapshotFrom({ openRows: [], catalog, companionUserId: "x" }) === null);
}

// ---------------------------------------------------------------- in-memory ledger for settlement
const orders = new Map();
const txs = [];
const refunds = [];
let txSeq = 0;
function restUrl(table, query = "") {
  return `mem://${table}${query}`;
}
function param(url, key) {
  const m = new RegExp(`[?&]${key}=eq\\.([^&]+)`).exec(url);
  return m ? decodeURIComponent(m[1]) : "";
}
async function supabaseJson(url, init = {}) {
  const method = init.method || "GET";
  const table = url.slice(6).split("?")[0];
  if (table === "profiles") return [{ id: param(url, "id"), role: "user", email: "real.user@example.com", display_name: "Real" }];
  if (table === "companion_profiles") return [{ commission_rate_override: 50 }]; // badge must win over personal override
  if (table === "transactions") {
    if (method === "POST") {
      const row = { id: `tx-${++txSeq}`, ...JSON.parse(init.body) };
      txs.push(row);
      return [row];
    }
    const oid = param(url, "order_id");
    const uid = param(url, "user_id");
    return txs.filter((t) => t.order_id === oid && (!uid || t.user_id === uid) && t.transaction_type === "companion_income");
  }
  if (table === "orders" && method === "PATCH") {
    const id = param(url, "id");
    const cur = orders.get(id);
    Object.assign(cur, JSON.parse(init.body));
    return [cur];
  }
  return [];
}
const helpers = createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders: () => ({}), addSystemMessage: async () => {} });
// settleCompanionIncome is internal; reach it through the public completion surface if exported.
const settle = helpers.settleCompanionIncome || helpers.__settleCompanionIncome;
if (typeof settle !== "function") {
  console.log("FAIL  settleCompanionIncome not reachable from createOrderCompleteHelpers");
  process.exit(1);
}

let orderSeq = 0;
function makeOrder(pw, amount, extra = {}) {
  const id = `20000000-0000-4000-8000-${String(++orderSeq).padStart(12, "0")}`;
  const row = {
    id,
    order_no: `TEST-CB-${orderSeq}`,
    status: "completed",
    boss_id: BOSS,
    companion_id: pw.user,
    total_amount: amount,
    order_type: "open_grab",
    settlement_status: "",
    cert_badge_snapshot: snapFor(pw),
    completed_at: new Date().toISOString(),
    ...extra,
  };
  orders.set(id, row);
  return row;
}
async function settleOrder(row) {
  return settle(orders.get(row.id), row.completed_at, "test");
}
function figs() {
  return [...orders.values()].map((o) =>
    orderFigures(
      o,
      txs.filter((t) => t.order_id === o.id),
      refunds.filter((r) => r.order_id === o.id)
    )
  ).filter(Boolean);
}

// PW-A × 2, PW-B × 1
const a1 = makeOrder(PW_A, 100);
const a2 = makeOrder(PW_A, 200);
const b1 = makeOrder(PW_B, 100);
for (const o of [a1, a2, b1]) await settleOrder(o);
check("PW-A 订单1 按勋章A 70/30 结算", orders.get(a1.id).companion_income === 70 && orders.get(a1.id).platform_fee === 30, JSON.stringify({ c: orders.get(a1.id).companion_income, p: orders.get(a1.id).platform_fee }));
check("PW-A 订单2 按勋章A 70/30 结算", orders.get(a2.id).companion_income === 140 && orders.get(a2.id).platform_fee === 60);
check("PW-B 订单 按勋章B 80/20 结算", orders.get(b1.id).companion_income === 80 && orders.get(b1.id).platform_fee === 20);
check("勋章佣金优先于个人自定义 50%", orders.get(a1.id).companion_commission_rate_snapshot === 70);
check("结算备注记录佣金勋章", /"certBadgeId":"badge-a"/.test(orders.get(a1.id).settlement_note || ""));

{
  const all = figs();
  const A = sumFigures(all.filter((f) => f.badgeIds.includes("badge-a")));
  const B = sumFigures(all.filter((f) => f.badgeIds.includes("badge-b")));
  check("勋章A 完成单量 = 2", A.completedCount === 2, JSON.stringify(A));
  check("勋章A 营业额 = 300.00 / 陪玩 210.00 / 平台 90.00", A.actualSettled === 300 && A.companionIncome === 210 && A.platformCommission === 90);
  check("勋章B 完成单量 = 1，80/20", B.completedCount === 1 && B.companionIncome === 80 && B.platformCommission === 20);
}

// 70 → 75: old orders keep snapshot, new orders use 75
catalog = catalog.map((t) => (t.id === "badge-a" ? { ...t, companionShareRate: 75 } : t));
const aOldUnsettled = orders.get(a1.id); // already settled: must not change
const aBoundBefore = makeOrder(PW_A, 100, { cert_badge_snapshot: a1.cert_badge_snapshot }); // bound before change, settles after
const aNew = makeOrder(PW_A, 100);
await settleOrder(aBoundBefore);
await settleOrder(aNew);
check("改 70→75 后已结算旧单仍为 70", aOldUnsettled.companion_income === 70);
check("改价前绑定、改价后完成的订单仍按快照 70", orders.get(aBoundBefore.id).companion_income === 70);
check("改价后新绑定订单按 75 结算", orders.get(aNew.id).companion_income === 75 && orders.get(aNew.id).platform_fee === 25);

// remove PW-A from badge A: history stays in A
assignments = assignments.map((a) => (a.id === "as-a" ? { ...a, status: "removed" } : a));
const afterRemoval = makeOrder(PW_A, 100);
check("取消勋章后新订单不再写入勋章快照", afterRemoval.cert_badge_snapshot === null);
await settleOrder(afterRemoval);
check("取消勋章后新订单回落默认规则 (个人自定义 50%)", orders.get(afterRemoval.id).companion_income === 50);
{
  const A = sumFigures(figs().filter((f) => f.badgeIds.includes("badge-a")));
  check("取消勋章后历史订单仍归属勋章A (4 单)", A.completedCount === 4, JSON.stringify(A));
}

// duplicate settlement: second call is a no-op; ledger duplicate rows never double count
const before = txs.length;
const dup = await settleOrder(b1);
check("重复结算不新增收入流水", dup?.duplicate === true && txs.length === before);
txs.push({ ...txs.find((t) => t.order_id === b1.id), id: "tx-dup-forced" });
{
  const fB = figs().filter((f) => f.badgeIds.includes("badge-b"));
  const B = sumFigures(fB);
  check("重复收入流水不重复计单量/金额", B.completedCount === 1 && B.actualSettled === 100 && B.companionIncome === 80, JSON.stringify(B));
  check("重复流水被标记供核查", fB[0].duplicateIncomeTx === true);
  check("同一订单在合计中只计一次", sumFigures([...fB, ...fB]).completedCount === 1);
}

// refunds
const full = makeOrder(PW_B, 100);
await settleOrder(full);
orders.get(full.id).status = "refunded";
txs.filter((t) => t.order_id === full.id).forEach((t) => {
  t.status = "cancelled";
  t.note += "\n[[CLAWBACK]]{}";
});
refunds.push({ order_id: full.id, status: "paid", amount_rm: 100, paid_amount_rm: 100 });
const partial = makeOrder(PW_B, 100);
await settleOrder(partial);
refunds.push({ order_id: partial.id, status: "paid", amount_rm: 30, paid_amount_rm: 30 });
const ptx = txs.find((t) => t.order_id === partial.id);
ptx.note += `\n[[PARTIAL_CLAWBACK]]${JSON.stringify({ clawAmount: 24 })}`;
refunds.push({ order_id: partial.id, status: "rejected", amount_rm: 50 });
{
  const fFull = figs().find((f) => f.orderId === full.id);
  const fPart = figs().find((f) => f.orderId === partial.id);
  check("全额退款订单不计入完成单量/营业额", fFull && fFull.effective === false && fFull.refund === 100);
  check("部分退款按实际结算 70.00 计营业额", fPart.actualSettled === 70 && fPart.effective === true);
  check("部分退款陪玩收入扣回后 56.00，平台 14.00", fPart.companionIncome === 56 && fPart.platformCommission === 14, JSON.stringify(fPart));
  check("驳回的退款申请不计入", fPart.refund === 30);
  const B = sumFigures(figs().filter((f) => f.badgeIds.includes("badge-b")));
  check("勋章B 退款合计 130.00 / 2 单", B.refundAmount === 130 && B.refundedOrders === 2, JSON.stringify(B));
  check("勋章B 完成单量 = 2 (原单 + 部分退款单)", B.completedCount === 2);
}
check("PARTIAL_CLAWBACK 解析累加", parseClawbacks('x\n[[PARTIAL_CLAWBACK]]{"clawAmount":5}\n[[PARTIAL_CLAWBACK]]{"clawAmount":2.5}').partial === 7.5);

// multi-companion: parent excluded, each child by its own snapshot
assignments = assignments.map((a) => (a.id === "as-a" ? { ...a, id: "as-a2", status: "active" } : a));
const parent = makeOrder(PW_A, 300, { order_type: "multi_group", companion_id: null, cert_badge_snapshot: null });
const childA = makeOrder(PW_A, 150, { parent_order_id: parent.id, order_type: "multi_child" });
const childB = makeOrder(PW_B, 150, { parent_order_id: parent.id, order_type: "multi_child" });
await settleOrder(childA);
await settleOrder(childB);
{
  const all = figs();
  check("多人订单父单不计入统计", !all.some((f) => f.orderId === parent.id));
  check("多人子单A 按勋章A 75% (重新授予后)", orders.get(childA.id).companion_income === 112.5);
  check("多人子单B 按勋章B 80%", orders.get(childB.id).companion_income === 120);
  const group = sumFigures(all.filter((f) => f.parentOrderId === parent.id));
  check("多人订单合计 = 子单之和 300.00，不重复父单", group.completedCount === 2 && group.actualSettled === 300);
}

// ranges + monthly
{
  const fixed = new Date("2026-10-05T03:00:00Z"); // Mon 11:00 MYT
  const t = rangeBounds({ range: "today", now: fixed });
  check("今日范围按马来西亚时间 00:00 起", t.fromIso === "2026-10-04T16:00:00.000Z" && t.toIso === "2026-10-05T16:00:00.000Z");
  const w = rangeBounds({ range: "week", now: fixed });
  check("本周从周一开始", w.fromIso === "2026-10-04T16:00:00.000Z");
  const mo = rangeBounds({ range: "month", now: fixed });
  check("本月范围", mo.fromIso === "2026-09-30T16:00:00.000Z" && mo.toIso === "2026-10-31T16:00:00.000Z");
  const c = rangeBounds({ range: "custom", from: "2026-09-01", to: "2026-09-30" });
  check("自定义范围含结束日", inRange("2026-09-30T15:59:00Z", c) && !inRange("2026-09-30T16:00:00Z", c));
  check("年/月导出范围", rangeBounds({ year: 2026, month: 2 }).toIso === "2026-02-28T16:00:00.000Z");
  let threw = false;
  try {
    rangeBounds({ range: "custom", from: "2026-09-10", to: "2026-09-01" });
  } catch {
    threw = true;
  }
  check("自定义范围结束早于开始时拒绝", threw);
  const rows = monthlyRows([
    { orderId: "1", completedAt: "2026-09-30T17:00:00Z", effective: true, gross: 10, actualSettled: 10, companionIncome: 7, platformCommission: 3, refund: 0 },
    { orderId: "2", completedAt: "2026-09-30T15:00:00Z", effective: true, gross: 10, actualSettled: 10, companionIncome: 7, platformCommission: 3, refund: 0 },
  ]);
  check("月度汇总按马来西亚月份切分", rows.length === 2 && rows[0].month === "2026-10" && rows[1].month === "2026-09");
}

check("快照解析拒绝无效 JSON", readOrderBadgeSnapshot({ cert_badge_snapshot: "{bad" }) === null);

console.log(`\nTotal ${pass + fail}  PASS ${pass}  FAIL ${fail}`);
if (process.argv.includes("--json")) console.log(JSON.stringify({ total: pass + fail, pass, fail, results }, null, 2));
process.exit(fail ? 1 : 0);
