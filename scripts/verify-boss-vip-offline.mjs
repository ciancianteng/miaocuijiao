/**
 * Offline Boss VIP spend / auto-upgrade cases (no DB / no network).
 * node scripts/verify-boss-vip-offline.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyRefundToTx,
  buildUpgradeNotice,
  isConfirmedPaidTx,
  isUpgrade,
  isVipEligibleSpend,
  netAmountFromTx,
  resolveVipLevel,
  sumEligibleSpend,
  viewBossVipSnapshot,
} from "../server/api/_boss-vip.js";
import { indexProfilesForStats } from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const levels = [
  { id: "lv0", name: "普通会员", spend_threshold: 0, benefits: "", sort_order: 0, is_active: true },
  { id: "lv1", name: "VIP1", spend_threshold: 500, benefits: "专属优惠", sort_order: 10, is_active: true },
  { id: "lv2", name: "VIP2", spend_threshold: 1500, benefits: "优先客服", sort_order: 20, is_active: true },
  { id: "lv3", name: "VIP3", spend_threshold: 3000, benefits: "专属活动", sort_order: 30, is_active: true },
];

const realBoss = { id: "boss-real", role: "boss", email: "vip.case@example.com", display_name: "验收老板" };
const smokeBoss = { id: "boss-smoke", role: "boss", email: "boss@meow.test", display_name: "ProdSmokeBoss2" };
const realCs = { id: "cs-real", role: "customer_service", email: "cs.real@example.com", display_name: "验收客服" };
const { byId, testIds } = indexProfilesForStats([realBoss, smokeBoss, realCs]);

function paidTx(amount, extra = {}) {
  return {
    payment_status: "paid",
    confirmed_by: "cs-real",
    confirmed_at: "2026-09-15T00:00:00.000Z",
    gross_amount: amount,
    refunded_amount: 0,
    net_amount: amount,
    ...extra,
  };
}

function realOrder(extra = {}) {
  return {
    id: extra.id || "ord-1",
    boss_id: realBoss.id,
    companion_id: "comp-real",
    customer_service_id: realCs.id,
    status: extra.status || "claimed",
    boss_name: realBoss.display_name,
    companion_name: "凝梦",
    ...extra,
  };
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    throw err;
  }
}

check("CASE 1 消费未客服确认 → VIP spend 不增加", () => {
  const tx = { payment_status: "paid", gross_amount: 100, net_amount: 100 };
  assert.equal(isConfirmedPaidTx(tx), false);
  const sum = sumEligibleSpend([{ tx, order: realOrder(), testIds, byId }]);
  assert.equal(sum.confirmedSpend, 0);
});

check("CASE 2 客服确认 100 → confirmed spend +100", () => {
  const sum = sumEligibleSpend([{ tx: paidTx(100), order: realOrder(), testIds, byId }]);
  assert.equal(sum.confirmedSpend, 100);
  assert.equal(sum.eligibleOrderCount, 1);
});

check("CASE 3 累计达到 VIP1 → 自动升级", () => {
  const resolved = resolveVipLevel(550, levels);
  assert.equal(resolved.current.id, "lv1");
  assert.equal(resolved.current.name, "VIP1");
  assert.equal(isUpgrade(levels[0], resolved.current), true);
});

check("CASE 4 一次消费跨多个等级 → 直接升最高符合等级", () => {
  const resolved = resolveVipLevel(100 + 3000, levels);
  assert.equal(resolved.current.id, "lv3");
  assert.equal(resolved.current.name, "VIP3");
});

check("CASE 5 取消但未付款订单 → VIP spend 不变化", () => {
  const sum = sumEligibleSpend([
    { tx: null, order: realOrder({ status: "cancelled" }), testIds, byId },
    {
      tx: { payment_status: "pending", gross_amount: 80, net_amount: 80 },
      order: realOrder({ status: "cancelled" }),
      testIds,
      byId,
    },
  ]);
  assert.equal(sum.confirmedSpend, 0);
});

check("CASE 6 测试订单 → VIP spend 不变化", () => {
  const order = {
    id: "ord-test",
    boss_id: smokeBoss.id,
    companion_id: "comp-real",
    status: "claimed",
    boss_name: smokeBoss.display_name,
  };
  const sum = sumEligibleSpend([{ tx: paidTx(999), order, testIds, byId }]);
  assert.equal(sum.confirmedSpend, 0);
});

check("CASE 7 真实退款 → confirmed spend 正确扣减", () => {
  const before = paidTx(100);
  const after = applyRefundToTx(before, 100);
  assert.equal(netAmountFromTx(after), 0);
  const sum = sumEligibleSpend([{ tx: after, order: realOrder({ status: "refunded" }), testIds, byId }]);
  assert.equal(sum.confirmedSpend, 0);
  const partial = applyRefundToTx(paidTx(100), 20);
  assert.equal(netAmountFromTx(partial), 80);
});

check("CASE 8 升级后站内通知文案", () => {
  const notice = buildUpgradeNotice({ spend: 1500, newLevel: levels[2] });
  assert.match(notice.title, /恭喜升级/);
  assert.match(notice.body, /1500/);
  assert.match(notice.body, /VIP2/);
  assert.match(notice.body, /优先客服/);
});

check("CASE 9 后台新增 VIP 等级 → 自动计算正常", () => {
  const plus = levels.concat([
    { id: "lv4", name: "VIP4", spend_threshold: 5000, benefits: "生日福利", sort_order: 40, is_active: true },
  ]);
  const resolved = resolveVipLevel(5000, plus);
  assert.equal(resolved.current.name, "VIP4");
});

check("CASE 10 修改门槛 → 已有 Boss 等级重新计算", () => {
  const raised = levels.map((lv) => (lv.id === "lv1" ? { ...lv, spend_threshold: 800 } : lv));
  const stillMember = resolveVipLevel(550, raised);
  assert.equal(stillMember.current.id, "lv0");
  const lowered = levels.map((lv) => (lv.id === "lv2" ? { ...lv, spend_threshold: 500 } : lv));
  const jumped = resolveVipLevel(550, lowered);
  assert.equal(jumped.current.id, "lv2");
});

check("CASE 11 停用某 VIP → 不再用于新等级计算", () => {
  const disabled = levels.map((lv) => (lv.id === "lv2" ? { ...lv, is_active: false } : lv));
  const resolved = resolveVipLevel(2000, disabled);
  assert.equal(resolved.current.id, "lv1");
  assert.notEqual(resolved.current.id, "lv2");
});

check("CASE 12 旧订单/旧财务数据不被计算函数改写", () => {
  const tx = Object.freeze({ ...paidTx(80) });
  const order = Object.freeze(realOrder({ status: "completed" }));
  const originalNet = tx.net_amount;
  const originalStatus = order.status;
  sumEligibleSpend([{ tx, order, testIds, byId }]);
  resolveVipLevel(80, levels);
  assert.equal(tx.net_amount, originalNet);
  assert.equal(order.status, originalStatus);
});

check("awaiting_payment 有 TX 也不计入", () => {
  const sum = sumEligibleSpend([
    { tx: paidTx(50), order: realOrder({ status: "awaiting_payment" }), testIds, byId },
  ]);
  assert.equal(sum.confirmedSpend, 0);
});

check("客服确认 80 / 原价 100 只计 80", () => {
  const tx = paidTx(80, { gross_amount: 80, net_amount: 80 });
  const sum = sumEligibleSpend([{ tx, order: realOrder({ total_amount: 100 }), testIds, byId }]);
  assert.equal(sum.confirmedSpend, 80);
});

check("Boss 前端 snapshot 字段", () => {
  const resolved = resolveVipLevel(760, levels);
  const snap = viewBossVipSnapshot({ confirmedSpend: 760, resolved });
  assert.equal(snap.currentLevelName, "VIP1");
  assert.equal(snap.confirmedSpend, 760);
  assert.equal(snap.currentThreshold, 500);
  assert.equal(snap.nextLevelName, "VIP2");
  assert.equal(snap.nextThreshold, 1500);
  assert.equal(snap.remaining, 740);
  assert.equal(snap.isMaxLevel, false);
});

check("CASE A 无消费 → 普通会员且非最高（有下一等级）", () => {
  const resolved = resolveVipLevel(0, levels);
  const snap = viewBossVipSnapshot({ confirmedSpend: 0, resolved });
  assert.equal(snap.currentLevelName, "普通会员");
  assert.equal(snap.isMaxLevel, false);
  assert.equal(snap.nextLevelName, "VIP1");
});

check("CASE B 达到 Level2 门槛 → 自动升级", () => {
  const resolved = resolveVipLevel(500, levels);
  assert.equal(resolved.current.name, "VIP1");
});

check("CASE C 差 1 猫粮 → 不能提前升级", () => {
  const resolved = resolveVipLevel(499, levels);
  assert.equal(resolved.current.name, "普通会员");
  assert.equal(resolved.next.name, "VIP1");
  assert.equal(resolved.remaining, 1);
});

check("CASE D 一次跨两级 → 进入正确最高符合等级", () => {
  const resolved = resolveVipLevel(1600, levels);
  assert.equal(resolved.current.name, "VIP2");
});

check("CASE J 真正最高等级 → isMaxLevel", () => {
  const resolved = resolveVipLevel(99999, levels);
  const snap = viewBossVipSnapshot({ confirmedSpend: 99999, resolved });
  assert.equal(snap.currentLevelName, "VIP3");
  assert.equal(snap.isMaxLevel, true);
  assert.equal(snap.nextLevelName, "");
});

check("进度分段公式 (600-500)/(2000-500)", () => {
  const custom = [
    { id: "a", name: "银卡", spend_threshold: 500, benefits: "优先", sort_order: 10, is_active: true },
    { id: "b", name: "金卡", spend_threshold: 2000, benefits: "专属", sort_order: 20, is_active: true },
  ];
  const resolved = resolveVipLevel(600, custom);
  const snap = viewBossVipSnapshot({ confirmedSpend: 600, resolved });
  assert.equal(snap.currentThreshold, 500);
  assert.equal(snap.nextThreshold, 2000);
  const pct = Math.round(((600 - 500) / (2000 - 500)) * 1000) / 10;
  assert.equal(pct, 6.7);
});

check("Admin UI source has multi-benefit + delete guards", () => {
  const admin = readFileSync(path.join(root, "src/admin-boss-vip.js"), "utf8");
  const api = readFileSync(path.join(root, "server/api/admin/boss-vip.js"), "utf8");
  const core = readFileSync(path.join(root, "server/api/_boss-vip.js"), "utf8");
  assert.match(admin, /data-vip-benefit-add/);
  assert.match(admin, /data-vip-delete/);
  assert.match(api, /action === "delete"/);
  assert.match(core, /deleteVipLevel/);
  assert.match(core, /该等级仍有老板使用/);
  assert.match(core, /currentThreshold/);
});

const failed = results.filter((row) => !row.pass);
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      passed: results.filter((row) => row.pass).length,
      failed: failed.length,
      cases: results,
    },
    null,
    2
  )
);
if (failed.length) process.exit(1);
