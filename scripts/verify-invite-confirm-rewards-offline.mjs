#!/usr/bin/env node
/**
 * Offline guards for invite / 直属 retirement + historical SoT retention.
 * 2026-11-24: 直属邀请 UI 已下线；API/表/历史逻辑保留且默认 flag 关闭。
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Migration / history retained (no DROP)
assert.ok(existsSync(path.join(root, "supabase/migrations/20260920_invite_confirm_and_rewards.sql")));
assert.ok(existsSync(path.join(root, "supabase/pending-prod/14_invite_confirm_and_rewards.sql")));
assert.ok(existsSync(path.join(root, "supabase/pending-prod/MIGRATION_PLAN_INVITE_CONFIRM.md")));

const mig = read("supabase/migrations/20260920_invite_confirm_and_rewards.sql");
assert.match(mig, /invite_attributions/);
assert.match(mig, /invite_reward_ledger/);
assert.match(mig, /invite_cash_wallets/);
assert.doesNotMatch(mig, /drop table public\.boss_companion_relations/i);

const attr = read("server/api/_invite-attribution.js");
assert.match(attr, /recognizeInviteAttribution/);
assert.match(attr, /confirmInviteAttribution/);
assert.match(attr, /isBossInviteLinksEnabled/);
assert.doesNotMatch(attr, /direct_invite_relations/);
assert.doesNotMatch(attr, /referral_relations/);

const links = read("server/api/_boss-invite-links.js");
assert.match(links, /isBossInviteLinksEnabled/);
assert.doesNotMatch(links, /bindRelation\(/); // no auto-bind on redeem

const flags = read("server/api/_feature-flags.js");
assert.match(flags, /isBossDirectRelationsEnabled/);
assert.match(flags, /BOSS_DIRECT_RELATIONS_ENABLED/);
assert.match(flags, /isBossInviteLinksEnabled/);

const bind = read("server/api/_boss-companion-relations.js");
assert.match(bind, /boss_companion_relations/);
assert.match(bind, /BOSS_DIRECT_RELATIONS_RETIRED|isBossDirectRelationsEnabled/);

const commission = read("server/api/_boss-commission.js");
assert.match(commission, /settleBossCommissionFromPlatformFee/);
assert.match(commission, /isBossDirectRelationsEnabled/);

// Invite page soft-retired — no live confirm CTA / API calls
const inviteHtml = read("invite.html");
assert.match(inviteHtml, /已下线/);
assert.doesNotMatch(inviteHtml, /invite\/confirm/);
assert.doesNotMatch(inviteHtml, /确认绑定/);
assert.doesNotMatch(inviteHtml, /注册成功后将自动绑定/);

// Soft-retired boss page must not fetch live APIs at top of mount
const myDirect = read("src/my-direct-companions.js");
assert.match(myDirect, /已下线/);
assert.match(myDirect, /return;/);

assert.ok(existsSync(path.join(root, "server/api/invite/confirm.js")));
assert.ok(existsSync(path.join(root, "server/api/companion/invite-links.js")));

// Admin menu must not expose 直属关系管理
const adminHtml = read("admin.html");
assert.doesNotMatch(adminHtml, /boss-companion-relations/);
assert.doesNotMatch(adminHtml, /直属关系管理/);
assert.doesNotMatch(adminHtml, /admin-boss-companion-relations/);

console.log("PASS verify-invite-confirm-rewards-offline (retired)");
