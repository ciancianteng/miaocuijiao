/**
 * Offline verification for G5/G6/G8 settlement & points guards (no DB / no network).
 * node scripts/verify-settlement-guards.mjs
 */
import assert from "node:assert/strict";
import {
  isSettlementEnabled,
  isPointsAwardEnabled,
  settlementDisabledReason,
  pointsAwardDisabledReason,
} from "../server/api/_feature-flags.js";
import {
  assertNotTestPartiesForSettlement,
  companionIncomeTestPartyDecision,
  isTestAccountRecord,
  isTestEmail,
} from "../server/api/_test-accounts.js";

const prod = { VERCEL_ENV: "production" };
const preview = { VERCEL_ENV: "preview" };

assert.equal(isSettlementEnabled(prod), false, "prod unset SETTLEMENT → disabled");
assert.equal(isPointsAwardEnabled(prod), false, "prod unset POINTS → disabled");
assert.equal(settlementDisabledReason(prod), "settlement_flag_disabled");
assert.equal(pointsAwardDisabledReason(prod), "points_award_flag_disabled");

assert.equal(isSettlementEnabled(preview), true, "preview unset → enabled for local/e2e");
assert.equal(isPointsAwardEnabled(preview), true);

assert.equal(
  isSettlementEnabled({ ...prod, SETTLEMENT_ENABLED: "true" }),
  true,
  "explicit true wins"
);
assert.equal(
  isSettlementEnabled({ ...preview, SETTLEMENT_ENABLED: "false" }),
  false,
  "explicit false wins on preview"
);
assert.equal(
  isPointsAwardEnabled({ ...prod, POINTS_AWARD_ENABLED: "0" }),
  false
);

assert.equal(isTestEmail("ijogepcg@guerrillamailblock.com"), true);
assert.equal(isTestAccountRecord({ email: "admin@meow.test", role: "admin" }), true);
assert.equal(
  isTestAccountRecord({ email: "ops@company.com", role: "admin", display_name: "Real Admin" }),
  false,
  "real admin must not be treated as test"
);

const blocked = assertNotTestPartiesForSettlement({
  bossProfile: { id: "b1", email: "qemvmuma@guerrillamailblock.com", display_name: "ProdSmokeBoss" },
  companionProfile: { id: "c1", email: "real@gmail.com", display_name: "凝梦" },
  order: { boss_name: "ProdSmokeBoss", companion_name: "凝梦", total_amount: 6000 },
});
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, "test_boss");

const allowed = assertNotTestPartiesForSettlement({
  bossProfile: { id: "b2", email: "boss@gmail.com", display_name: "xiaohou" },
  companionProfile: { id: "c2", email: "comp@gmail.com", display_name: "凝梦" },
  order: { boss_name: "xiaohou", companion_name: "凝梦", total_amount: 40 },
});
assert.equal(allowed.ok, true);

// P0 regression: REAL boss + REAL companion + CS flagged test → companion income MUST run
const realWithTestCs = companionIncomeTestPartyDecision({
  bossProfile: { id: "b3", email: "1717@gmail.com", display_name: "1717", is_test_account: false },
  companionProfile: { id: "c3", email: "qingzi@gmail.com", display_name: "晴子", is_test_account: false },
  customerServiceProfile: {
    id: "cs1",
    email: "cs@gmail.com",
    display_name: "MCJ客服-小喵",
    is_test_account: true,
    role: "customer_service",
  },
  order: { boss_name: "1717", companion_name: "晴子", total_amount: 30 },
});
assert.equal(realWithTestCs.skip, false, "CS test flag alone must not block companion income");
assert.equal(realWithTestCs.warnCsTest, true);

// True test order (test boss) → still blocked
const testBossBlocked = companionIncomeTestPartyDecision({
  bossProfile: { id: "b4", email: "smoke@meow.test", display_name: "ProdSmokeBoss", is_test_account: true },
  companionProfile: { id: "c4", email: "comp@gmail.com", display_name: "凝梦", is_test_account: false },
  customerServiceProfile: { id: "cs2", email: "cs@gmail.com", is_test_account: false },
  order: { boss_name: "ProdSmokeBoss", companion_name: "凝梦", total_amount: 6000 },
});
assert.equal(testBossBlocked.skip, true);
assert.equal(testBossBlocked.reason, "test_boss");

// Test companion → still blocked
const testCompanionBlocked = companionIncomeTestPartyDecision({
  bossProfile: { id: "b5", email: "boss@gmail.com", is_test_account: false },
  companionProfile: { id: "c5", email: "comp@meow.test", display_name: "TestComp", is_test_account: true },
  customerServiceProfile: { id: "cs3", email: "cs@gmail.com", is_test_account: true },
  order: { total_amount: 30 },
});
assert.equal(testCompanionBlocked.skip, true);
assert.match(String(testCompanionBlocked.reason), /test_companion|test_party/);

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "settlement/points feature flags + test party guards verification passed",
      prodSettlementDefault: isSettlementEnabled(prod),
      prodPointsDefault: isPointsAwardEnabled(prod),
      csTestFlagAllowsRealCompanionIncome: !realWithTestCs.skip,
      testBossStillBlocked: testBossBlocked.skip,
    },
    null,
    2
  )
);
