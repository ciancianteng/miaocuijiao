#!/usr/bin/env node
/**
 * Offline guards: invite antifraud (§16–17) — confirm binds only; reward needs qualifying order.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateInviteOrderEligibility,
} from "../server/api/_invite-attribution.js";
import { classifyCompanionIncomeTx } from "../server/api/_companion-income.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

assert.ok(existsSync(path.join(root, "supabase/migrations/20260920_invite_confirm_and_rewards.sql")));

const attr = read("server/api/_invite-attribution.js");
assert.match(attr, /recognizeInviteAttribution/);
assert.match(attr, /confirmInviteAttribution/);
assert.match(attr, /grantInviteRewardForAttribution/);
assert.match(attr, /maybeGrantInviteRewardForOrder/);
assert.match(attr, /sweepPendingInviteRewards/);
assert.match(attr, /referral_reward:\$\{/);
assert.match(attr, /awaiting_qualifying_order/);
assert.match(attr, /self_invite/);
assert.match(attr, /MCJ_INVITE/);
// Confirm must NOT auto-grant
assert.match(attr, /do NOT grant on confirm|awaiting_qualifying_order/);
assert.doesNotMatch(attr, /const reward = await grantInviteRewardForAttribution\(confirmed\)/);

const orderComplete = read("server/api/_order-complete.js");
assert.match(orderComplete, /maybeGrantInviteRewardForOrder/);
assert.match(orderComplete, /sweepPendingInviteRewards/);

const completedClosed = {
  id: "o1",
  status: "completed",
  boss_id: "boss1",
  companion_id: "comp1",
  paid_at: "2026-09-01T00:00:00Z",
  completed_at: "2026-09-01T00:00:00Z",
  note: "[[AFTER_SALE_CLOSED]] boss_manual",
  completion_method: "boss_manual",
};
const attrBoss = {
  id: "a1",
  status: "confirmed",
  reward_granted: false,
  inviter_role: "boss",
  invitee_user_id: "boss1",
};
assert.equal(
  evaluateInviteOrderEligibility(completedClosed, {
    attribution: attrBoss,
    inviteeProfile: { id: "boss1", email: "real@example.com" },
    bossProfile: { id: "boss1", email: "real@example.com" },
    companionProfile: { id: "comp1", email: "comp@example.com" },
  }).ok,
  true
);
assert.equal(
  evaluateInviteOrderEligibility(
    { ...completedClosed, status: "cancelled" },
    { attribution: attrBoss, inviteeProfile: { id: "boss1" }, bossProfile: { id: "boss1" }, companionProfile: { id: "comp1" } }
  ).ok,
  false
);
assert.equal(
  evaluateInviteOrderEligibility(
    { ...completedClosed, status: "refunded", note: "" },
    { attribution: attrBoss, inviteeProfile: { id: "boss1" }, bossProfile: { id: "boss1" }, companionProfile: { id: "comp1" } }
  ).reason,
  "order_refunded_or_canceled"
);
assert.equal(
  evaluateInviteOrderEligibility(completedClosed, {
    attribution: attrBoss,
    inviteeProfile: { id: "boss1", email: "boss@meow.test", is_test_account: true },
    bossProfile: { id: "boss1", email: "boss@meow.test", is_test_account: true },
    companionProfile: { id: "comp1" },
  }).reason,
  "test_data"
);
assert.equal(
  classifyCompanionIncomeTx(
    {
      transaction_type: "companion_income",
      amount: 5,
      status: "completed",
      note: '邀请佣金 MCJ_INVITE:{"source":"invite"}',
    },
    null
  ),
  "invite_income"
);

const testAccounts = read("server/api/_test-accounts.js");
assert.match(testAccounts, /cursor_acceptance/);
assert.match(testAccounts, /is_test_account/);
assert.match(testAccounts, /authUser/);

const auth = read("server/api/auth.js");
assert.match(auth, /blockedProfile/);
assert.match(auth, /PROD_TEST_ACCOUNT_BLOCKED/);

console.log("PASS verify-invite-antifraud-offline");
