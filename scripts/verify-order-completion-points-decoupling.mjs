#!/usr/bin/env node
/**
 * Offline verification: boss points decoupled from companion settlement
 * + all completion paths route through finalizeOrderCompletion.
 *
 * Does NOT touch Production DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPointsAwardEnabled,
  isSettlementEnabled,
  pointsAwardDisabledReason,
} from "../server/api/_feature-flags.js";
import {
  orderPointsIdempotencyKey,
  computeOrderRewardPoints,
  defaultBossPointsSettings,
} from "../server/api/_user-points.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const completeSrc = read("server/api/_order-complete.js");
const csSrc = read("server/api/customer-service.js");
const adminOrdersSrc = read("server/api/admin/orders.js");
const pointsSrc = read("server/api/_user-points.js");
const ordersSrc = read("server/api/orders.js");
const cronSrc = read("server/api/cron/order-auto-complete.js");

// --- A: settlement gate removed ---
assert.doesNotMatch(
  completeSrc,
  /if\s*\(\s*settlementOk\s*&&\s*!settlement\?\.skipped\s*\)\s*\{[\s\S]*?awardBossPointsForCompletedOrder/
);
assert.match(completeSrc, /safeAwardBossPoints/);
assert.match(completeSrc, /Boss loyalty points: independent of settlement/);
assert.match(completeSrc, /boss_points_exception/);
assert.match(completeSrc, /boss_points_skipped/);
assert.doesNotMatch(completeSrc, /catch\s*\(\s*_\s*\)\s*\{\s*\}\s*\n\s*return \{\s*ok:\s*true,\s*duplicate:\s*true/);

// Force methods include cs_force
assert.match(completeSrc, /isForceCompleteMethod/);
assert.match(completeSrc, /cs_force/);
assert.match(pointsSrc, /order_complete_cs/);

// --- B: CS / admin / boss / cron use finalize ---
assert.match(csSrc, /method:\s*"cs_force"/);
assert.match(csSrc, /finalizeOrderCompletion/);
assert.match(csSrc, /Canonical completion: never bare-patch status=completed/);
// CS completed path must not fall through to bare transitionOrderStatus for completed
{
  const idx = csSrc.indexOf('if (action === "update_order_status")');
  assert.ok(idx > 0);
  const chunk = csSrc.slice(idx, idx + 5500);
  assert.match(chunk, /transition\.to === "completed"/);
  assert.match(chunk, /createOrderCompleteHelpers/);
}

assert.match(adminOrdersSrc, /normalizeOrderStatus\(patch\.status\) === "completed"/);
assert.match(adminOrdersSrc, /finalizeOrderCompletion/);
assert.match(adminOrdersSrc, /method:\s*"admin_force"/);

assert.match(ordersSrc, /confirm_completion|confirm_complete/);
assert.match(ordersSrc, /finalizeOrderCompletion/);

assert.match(cronSrc, /expireCompletionAutoConfirms/);
assert.match(completeSrc, /expireCompletionAutoConfirms/);
assert.match(completeSrc, /system_auto_24h/);

// Companion complete_order must NOT finalize to completed (request only)
{
  const companionSrc = read("server/api/companion.js");
  const idx = companionSrc.indexOf('if (action === "complete_order"');
  assert.ok(idx > 0);
  const chunk = companionSrc.slice(idx, idx + 3500);
  assert.match(chunk, /markCompletionPending|awaitingBossConfirm/);
  assert.doesNotMatch(chunk, /finalizeOrderCompletion/);
}

// --- C: idempotency key shape ---
assert.equal(
  orderPointsIdempotencyKey("6ea4e05d-cced-4581-a5c2-ffe9d0be8f4a"),
  "order_points:6ea4e05d-cced-4581-a5c2-ffe9d0be8f4a"
);
assert.match(pointsSrc, /order_points:\$\{/);

// --- flags / formula for tests 1,9,10 ---
const prod = { VERCEL_ENV: "production", NODE_ENV: "production" };
assert.equal(isPointsAwardEnabled(prod), false);
assert.equal(isSettlementEnabled(prod), false);
assert.equal(isPointsAwardEnabled({ ...prod, POINTS_AWARD_ENABLED: "1" }), true);
assert.equal(isSettlementEnabled({ ...prod, SETTLEMENT_ENABLED: "0" }), false);
assert.ok(pointsAwardDisabledReason(prod));

const settingsOn = { ...defaultBossPointsSettings(), enabled: true, pointsPerCatFood: 10 };
assert.equal(computeOrderRewardPoints(30, settingsOn), 300);
const settingsOff = { ...settingsOn, enabled: false };
assert.equal(computeOrderRewardPoints(30, settingsOff), 0);

// Source-level: award still attempted after settlement skip block
{
  const awardIdx = completeSrc.indexOf("const bossPoints = await safeAwardBossPoints(saved");
  const settleErrIdx = completeSrc.indexOf("settlement error");
  assert.ok(awardIdx > settleErrIdx, "points award must come after settlement attempt");
}

console.log("verify-order-completion-points-decoupling: PASS");
