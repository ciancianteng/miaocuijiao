/**
 * Offline verification for dashboard stats reconciliation (no DB / no network).
 * node scripts/verify-dashboard-test-filter.mjs
 */
import assert from "node:assert/strict";
import {
  buildDashboardStats,
  countApprovedCompanions,
  isBusinessOrderRoot,
} from "../server/api/admin/dashboard.js";
import {
  isTestAccountRecord,
  isTestEmail,
  isTestUsername,
  shouldBlockTestIdentityOnProduction,
} from "../server/api/_test-accounts.js";

assert.equal(isTestEmail("boss@meow.test"), true);
assert.equal(isTestEmail("real@gmail.com"), false);
assert.equal(isTestEmail("vip.deploy.boss.123@meowcuijiao.com"), true);
assert.equal(isTestUsername("ProdSmokeBoss2"), true);
assert.equal(isTestUsername("Smoke2374"), true);
assert.equal(isTestUsername("xiaohou"), false);
assert.equal(isTestAccountRecord({ email: "cs.smoke.1@meow.test", display_name: "CS" }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "ProdSmokeCS" }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "凝梦", is_test_account: true }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "凝梦" }), false);

assert.equal(
  isTestAccountRecord({ email: "a@example.com", display_name: "InviteeBossFlow-1" }, {}, { VERCEL_ENV: "production" }),
  true
);
assert.equal(
  isTestAccountRecord({ email: "a@example.com", display_name: "InviteeBossFlow-1" }, {}, { VERCEL_ENV: "preview" }),
  false
);
assert.equal(
  isTestAccountRecord({ email: "real@gmail.com", display_name: "凝梦" }, {}, { VERCEL_ENV: "production" }),
  false
);

assert.equal(
  shouldBlockTestIdentityOnProduction({ email: "admin@meow.test" }, { VERCEL_ENV: "production" }),
  true
);
assert.equal(
  shouldBlockTestIdentityOnProduction({ email: "admin@meow.test" }, { VERCEL_ENV: "preview" }),
  false
);

assert.equal(isBusinessOrderRoot({ parent_order_id: null }), true);
assert.equal(isBusinessOrderRoot({ parent_order_id: "p1" }), false);

const smokeBossId = "boss-smoke";
const realBossId = "boss-real";
const smokeCompId = "comp-smoke";
const realCompId = "comp-real";
const dualRoleId = "dual-boss-companion";
const smokeCsId = "cs-smoke";
const realCsId = "cs-real";
const vipBossId = "vip-deploy-boss";

const profiles = [
  { id: smokeBossId, role: "boss", email: "a@guerrillamailblock.com", display_name: "ProdSmokeBoss2", status: "active" },
  { id: realBossId, role: "boss", email: "realboss@gmail.com", display_name: "xiaohou", status: "active" },
  { id: "p0-boss", role: "boss", email: "boss@meow.test", display_name: "P0 Boss", status: "active" },
  { id: dualRoleId, role: "boss", email: "xiaohong@gmail.com", display_name: "小宏", status: "active" },
  { id: smokeCompId, role: "companion", email: "c@guerrillamailblock.com", display_name: "ProdSmokeService2", status: "active" },
  { id: realCompId, role: "companion", email: "comp@gmail.com", display_name: "凝梦", status: "active" },
  { id: smokeCsId, role: "customer_service", email: "cs.smoke.1@meow.test", display_name: "ProdSmokeCS", status: "active" },
  { id: realCsId, role: "customer_service", email: "cs.real@gmail.com", display_name: "MCJ客服-XY", status: "active" },
  { id: vipBossId, role: "boss", email: "vip.deploy.boss.1@meowcuijiao.com", display_name: "VIP Shot", status: "active" },
];

const companionProfiles = [
  { user_id: smokeCompId, nickname: "ProdSmokeService2", verification_status: "approved", is_test_account: true },
  { user_id: realCompId, nickname: "凝梦", verification_status: "approved" },
  { user_id: dualRoleId, nickname: "小宏", verification_status: "approved" },
  { user_id: realBossId, nickname: "pending-only", verification_status: "pending" },
];

assert.equal(countApprovedCompanions({ profiles, companionProfiles }), 2, "hall-aligned companions");

const parentId = "parent-70";
const orders = [
  {
    id: "o1",
    status: "completed",
    total_amount: 6000,
    created_at: "2026-09-02T18:49:00.649Z",
    boss_id: smokeBossId,
    companion_id: smokeCompId,
    customer_service_id: smokeCsId,
  },
  {
    id: "o2",
    status: "awaiting_payment",
    total_amount: 30,
    created_at: "2026-09-02T18:48:56.563Z",
    boss_id: smokeBossId,
    companion_id: smokeCompId,
  },
  {
    id: "o3",
    status: "awaiting_payment",
    total_amount: 40,
    created_at: "2026-08-29T09:10:11.331Z",
    boss_id: realBossId,
    companion_id: null,
  },
  {
    id: parentId,
    status: "awaiting_payment",
    total_amount: 70,
    created_at: "2026-09-03T04:00:00.000Z",
    boss_id: realBossId,
    companion_id: null,
    order_type: "multi_group",
    parent_order_id: null,
  },
  {
    id: "child-a",
    status: "awaiting_payment",
    total_amount: 35,
    created_at: "2026-09-03T04:00:01.000Z",
    boss_id: realBossId,
    companion_id: realCompId,
    parent_order_id: parentId,
    order_type: "direct_companion",
  },
  {
    id: "child-b",
    status: "awaiting_payment",
    total_amount: 35,
    created_at: "2026-09-03T04:00:02.000Z",
    boss_id: realBossId,
    companion_id: dualRoleId,
    parent_order_id: parentId,
    order_type: "direct_companion",
  },
  {
    id: "vip-shot",
    status: "completed",
    total_amount: 5500,
    created_at: "2026-09-21T08:29:03.520Z",
    boss_id: vipBossId,
    companion_id: realCompId,
  },
  {
    id: "paid-real",
    status: "completed",
    total_amount: 30,
    paid_at: "2026-09-03T08:00:00.000Z",
    paid_cat_food: 30,
    created_at: "2026-09-03T08:00:00.000Z",
    boss_id: realBossId,
    companion_id: realCompId,
    platform_fee: 6,
  },
  {
    id: "claimed-1",
    status: "claimed",
    total_amount: 35,
    paid_at: "2026-09-03T09:00:00.000Z",
    paid_cat_food: 35,
    created_at: "2026-09-03T09:00:00.000Z",
    boss_id: realBossId,
    companion_id: dualRoleId,
  },
  {
    id: "confirmed-1",
    status: "confirmed",
    total_amount: 35,
    paid_at: "2026-09-03T10:00:00.000Z",
    paid_cat_food: 35,
    created_at: "2026-09-03T10:00:00.000Z",
    boss_id: realBossId,
    companion_id: realCompId,
  },
];

const withdrawals = [
  { id: "w1", status: "completed", companion_id: realCompId, net_amount_rm: 12.5 },
  { id: "w2", status: "pending", companion_id: realCompId, net_amount_rm: 3 },
];

const { stats, filter } = buildDashboardStats({
  profiles,
  orders,
  withdrawals,
  companionProfiles,
  now: new Date("2026-09-03T12:00:00.000Z"),
});

assert.equal(stats.bosses, 2, "real boss + dual-role boss");
assert.equal(stats.companions, 2, "hall-aligned approved companions");
assert.equal(stats.customerServices, 1, "only real CS counted");
assert.equal(stats.totalAmount, 30 + 35 + 35, "vip.deploy + smoke excluded; CS-approved parent GMV only");
assert.equal(stats.validOrders, 3, "three CS-approved parent payments");
assert.equal(stats.completed, 1, "only real completed (vip excluded)");
assert.equal(stats.awaitingPayment, 2, "real awaiting + multi parent only (not 2 children)");
assert.equal(stats.pendingOrders, 1, "claimed counts as waiting companion confirm");
assert.equal(stats.inProgress, 1, "confirmed counts as in progress");
assert.equal(stats.withdrawPaid, 12.5);
assert.equal(stats.withdrawPending, 3);
assert.equal(stats.platformProfit, 6 + Math.round((35 + 35) * 0.2 * 100) / 100);
assert.equal(filter.testAccountsExcluded, true);
assert.equal(filter.parentOrdersOnly, true);
assert.equal(filter.revenueSource, "cs_approved_parent_payment");
assert.equal(filter.childOrdersSkipped, 2);

console.log(
  JSON.stringify(
    {
      ok: true,
      stats,
      filter,
      message: "dashboard reconcile verification passed",
    },
    null,
    2
  )
);
