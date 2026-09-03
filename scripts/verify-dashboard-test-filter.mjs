/**
 * Offline verification for dashboard test-account exclusion (no DB / no network).
 * node scripts/verify-dashboard-test-filter.mjs
 */
import assert from "node:assert/strict";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";
import {
  isTestAccountRecord,
  isTestEmail,
  isTestUsername,
  shouldBlockTestIdentityOnProduction,
} from "../server/api/_test-accounts.js";

assert.equal(isTestEmail("boss@meow.test"), true);
assert.equal(isTestEmail("real@gmail.com"), false);
assert.equal(isTestUsername("ProdSmokeBoss2"), true);
assert.equal(isTestUsername("Smoke2374"), true);
assert.equal(isTestUsername("xiaohou"), false);
assert.equal(isTestAccountRecord({ email: "cs.smoke.1@meow.test", display_name: "CS" }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "ProdSmokeCS" }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "凝梦", is_test_account: true }), true);
assert.equal(isTestAccountRecord({ email: "x@gmail.com", display_name: "凝梦" }), false);

assert.equal(
  shouldBlockTestIdentityOnProduction({ email: "admin@meow.test" }, { VERCEL_ENV: "production" }),
  true
);
assert.equal(
  shouldBlockTestIdentityOnProduction({ email: "admin@meow.test" }, { VERCEL_ENV: "preview" }),
  false
);

const smokeBossId = "boss-smoke";
const realBossId = "boss-real";
const smokeCompId = "comp-smoke";
const realCompId = "comp-real";
const smokeCsId = "cs-smoke";
const realCsId = "cs-real";

const profiles = [
  { id: smokeBossId, role: "boss", email: "a@guerrillamailblock.com", display_name: "ProdSmokeBoss2" },
  { id: realBossId, role: "boss", email: "realboss@gmail.com", display_name: "xiaohou" },
  { id: "p0-boss", role: "boss", email: "boss@meow.test", display_name: "P0 Boss" },
  { id: smokeCompId, role: "companion", email: "c@guerrillamailblock.com", display_name: "ProdSmokeService2" },
  { id: realCompId, role: "companion", email: "comp@gmail.com", display_name: "凝梦" },
  { id: smokeCsId, role: "customer_service", email: "cs.smoke.1@meow.test", display_name: "ProdSmokeCS" },
  { id: realCsId, role: "customer_service", email: "cs.real@gmail.com", display_name: "MCJ客服-XY" },
];

const orders = [
  {
    id: "o1",
    status: "completed",
    total_amount: 6000,
    created_at: "2026-09-02T18:49:00.649Z",
    boss_id: smokeBossId,
    companion_id: smokeCompId,
    customer_service_id: smokeCsId,
    boss_name: "ProdSmokeBoss2",
    companion_name: "ProdSmokeService2",
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
    boss_name: "033",
  },
];

const { stats, filter } = buildDashboardStats({
  profiles,
  orders,
  withdrawals: [],
  now: new Date("2026-09-03T12:00:00.000Z"),
});

assert.equal(stats.bosses, 1, "only real boss counted");
assert.equal(stats.companions, 1, "only real companion counted");
assert.equal(stats.customerServices, 1, "only real CS counted");
assert.equal(stats.totalAmount, 0, "smoke completed 6000 excluded from revenue");
assert.equal(stats.completed, 0, "smoke completed order excluded");
assert.equal(stats.awaitingPayment, 1, "only real awaiting_payment remains");
assert.equal(filter.testAccountsExcluded, true);
assert.equal(filter.excludedBosses, 2);
assert.equal(filter.excludedCompanions, 1);
assert.equal(filter.excludedCustomerServices, 1);
assert.equal(filter.excludedOrders, 2);

console.log(
  JSON.stringify(
    {
      ok: true,
      stats,
      filter,
      message: "dashboard test-account filter verification passed",
    },
    null,
    2
  )
);
