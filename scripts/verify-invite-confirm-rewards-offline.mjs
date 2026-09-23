#!/usr/bin/env node
/**
 * Offline guards for invite confirm-before-bind + reward typing.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Migration present
assert.ok(existsSync(path.join(root, "supabase/migrations/20260920_invite_confirm_and_rewards.sql")));
assert.ok(existsSync(path.join(root, "supabase/pending-prod/14_invite_confirm_and_rewards.sql")));
assert.ok(existsSync(path.join(root, "supabase/pending-prod/MIGRATION_PLAN_INVITE_CONFIRM.md")));

const mig = read("supabase/migrations/20260920_invite_confirm_and_rewards.sql");
assert.match(mig, /invite_attributions/);
assert.match(mig, /invite_reward_ledger/);
assert.match(mig, /invite_cash_wallets/);
assert.match(mig, /owner_role/);
assert.match(mig, /pending_confirm/);
assert.doesNotMatch(mig, /drop table public\.boss_companion_relations/i);

const attr = read("server/api/_invite-attribution.js");
assert.match(attr, /recognizeInviteAttribution/);
assert.match(attr, /confirmInviteAttribution/);
assert.match(attr, /grantInviteRewardForAttribution/);
assert.match(attr, /meow_coin/);
assert.match(attr, /invite_cash_wallets|MCJ_INVITE/);
assert.match(attr, /invite_reward|referral_reward/);
assert.match(attr, /inviterRole === "companion"|inviter_role === "companion"|rewardType === "cash"/);
assert.match(attr, /awaiting_qualifying_order/);
// Must NOT invent parallel relation SoT name as primary
assert.doesNotMatch(attr, /direct_invite_relations/);
assert.doesNotMatch(attr, /referral_relations/);
// Confirm must not grant immediately
assert.doesNotMatch(attr, /const reward = await grantInviteRewardForAttribution\(confirmed\)/);

const links = read("server/api/_boss-invite-links.js");
assert.match(links, /recognizeInviteAttribution/);
assert.match(links, /pending_confirm/);
assert.doesNotMatch(links, /bindRelation\(/); // no auto-bind on redeem

const bind = read("server/api/_boss-companion-relations.js");
assert.match(bind, /skipCapabilityCheck/);

const inviteHtml = read("invite.html");
assert.match(inviteHtml, /确认绑定/);
assert.match(inviteHtml, /invite\/confirm/);
assert.doesNotMatch(inviteHtml, /注册成功后将自动绑定/);

assert.ok(existsSync(path.join(root, "server/api/invite/confirm.js")));
assert.ok(existsSync(path.join(root, "server/api/companion/invite-links.js")));

// #185 SoT still present
assert.match(read("server/api/_boss-companion-relations.js"), /boss_companion_relations/);
assert.match(read("server/api/_boss-commission.js"), /settleBossCommissionFromPlatformFee/);

console.log("PASS verify-invite-confirm-rewards-offline");
