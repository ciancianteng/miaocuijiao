/**
 * P0 regression: test isolation + multi-order Game ID reuse (offline, no Production writes).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  excludeTestTouchedOnProduction,
  isAcceptanceFixtureName,
  isTestAccountRecord,
  shouldStampTestAccount,
  stampTestAccountPayload,
} from "../server/api/_test-accounts.js";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const teamSrc = readFileSync(path.join(root, "src/multi-companion-team.js"), "utf8");
const modalSrc = readFileSync(path.join(root, "src/place-order-modal.js"), "utf8");
const hallSrc = readFileSync(path.join(root, "src/companion-hall.js"), "utf8");
const presenceSrc = readFileSync(path.join(root, "src/companion-presence.js"), "utf8");
const ordersSrc = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
const placeMultiSrc = readFileSync(path.join(root, "server/api/_place-multi-order.js"), "utf8");
const adminOrdersSrc = readFileSync(path.join(root, "server/api/admin/orders.js"), "utf8");
const purgeSrc = readFileSync(path.join(root, "server/api/admin/purge-test-data.js"), "utf8");

// CASE 1–3: Game ID reuse in the same draft
assert.match(modalSrc, /inheritedAccountId|getSharedAccountId/);
assert.match(modalSrc, /data-po-game-id-edit/);
assert.match(modalSrc, /已沿用本次一起下单的游戏ID/);
assert.match(teamSrc, /sharedGameId/);
assert.match(teamSrc, /sharedIdContext/);
assert.match(teamSrc, /mcjMultiTeamSelection/);
assert.doesNotMatch(
  teamSrc.slice(teamSrc.indexOf("function continueToHall"), teamSrc.indexOf("function continueToHall") + 280),
  /clearTeam\(\);/
);

// CASE 4: different game / 区服 re-ask
assert.match(teamSrc, /function sameIdContext/);
assert.match(teamSrc, /getSharedAccountId/);

// CASE 5: hall + multi-select share presence SoT
assert.match(presenceSrc, /function fromCompanion/);
assert.match(presenceSrc, /canAcceptBossOrder/);
assert.match(teamSrc, /MCJCompanionPresence/);
assert.match(hallSrc, /MCJCompanionPresence|canAcceptBossOrder|availabilityStatus/);

// CASE 6–7: checkout goes to payment-confirm; insufficient balance is not an inline dead-end
assert.match(teamSrc, /payment-confirm\.html\?order=/);
assert.match(teamSrc, /place_multi_order/);
assert.doesNotMatch(teamSrc, /action:\s*["']pay_order["']/);

// CASE 8: Production test accounts stamped + excluded from official stats / admin list
assert.equal(shouldStampTestAccount({ email: "boss@meow.test", displayName: "P0 Boss" }), true);
assert.equal(stampTestAccountPayload({ role: "boss" }, { email: "boss@meow.test" }).is_test_account, true);
assert.equal(isAcceptanceFixtureName("InviteeBossFlow-1789912163362"), true);
assert.equal(
  isTestAccountRecord({ email: "x@example.com", display_name: "CompA-1" }, {}, { VERCEL_ENV: "production" }),
  true
);
assert.equal(
  isTestAccountRecord({ email: "x@example.com", display_name: "CompA-1" }, {}, { VERCEL_ENV: "preview" }),
  false
);
assert.match(adminOrdersSrc, /excludeTestTouchedOnProduction/);
assert.match(purgeSrc, /PROD_PURGE_BLOCKED/);
assert.match(ordersSrc, /PROD_TEST_ACCOUNT_BLOCKED/);

const realBoss = { id: "real-boss", role: "boss", email: "real@gmail.com", display_name: "凝梦", status: "active" };
const testBoss = { id: "test-boss", role: "boss", email: "boss@meow.test", display_name: "P0 Boss", status: "active" };
const realComp = { id: "real-comp", role: "companion", email: "comp@gmail.com", display_name: "小宏", status: "active" };
const { stats, filter } = buildDashboardStats({
  profiles: [realBoss, testBoss, realComp],
  orders: [
    { id: "real-o", status: "completed", total_amount: 35, boss_id: "real-boss", companion_id: "real-comp", created_at: new Date().toISOString() },
    { id: "test-o", status: "completed", total_amount: 6000, boss_id: "test-boss", companion_id: "real-comp", created_at: new Date().toISOString() },
  ],
  now: new Date(),
});
assert.equal(filter.testAccountsExcluded, true);
assert.equal(filter.excludedOrders >= 1, true);
assert.equal(stats.completed >= 1, true);

const hidden = excludeTestTouchedOnProduction(
  [
    { id: "test-o", boss_id: "test-boss", companion_id: "real-comp" },
    { id: "real-o", boss_id: "real-boss", companion_id: "real-comp" },
  ],
  [realBoss, testBoss, realComp],
  { VERCEL_ENV: "production" }
);
assert.equal(hidden.length, 1);
assert.equal(hidden[0].id, "real-o");

const stagingKept = excludeTestTouchedOnProduction(
  [
    { id: "test-o", boss_id: "test-boss", companion_id: "real-comp" },
    { id: "real-o", boss_id: "real-boss", companion_id: "real-comp" },
  ],
  [realBoss, testBoss, realComp],
  { VERCEL_ENV: "preview" }
);
assert.equal(stagingKept.length, 2);

// CASE 9: real user order is not classified as test
assert.equal(isTestAccountRecord(realBoss, {}, { VERCEL_ENV: "production" }), false);
assert.equal(isTestAccountRecord(realComp, {}, { VERCEL_ENV: "production" }), false);

assert.match(placeMultiSrc, /sharedGameId \|\| line\.gameId \|\| line\.game_id/);

console.log("verify-p0-isolation-and-multi-id: PASS");
