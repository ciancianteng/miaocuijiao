/**
 * Boss invite-links v1 — offline checks (flag + code + no commission_rate field).
 * node scripts/verify-boss-invite-links-v1.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripSqlComments(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

const sqlRaw = fs.readFileSync(path.join(root, "supabase/pending-prod/09_boss_invite_links.sql"), "utf8");
const sql = stripSqlComments(sqlRaw);
assert.match(sql, /create table if not exists public\.boss_invite_links/i);
assert.match(sql, /create table if not exists public\.boss_invite_redemptions/i);
assert.equal(/\bcommission_rate\b/i.test(sql), false);
assert.equal(/boss_companion_invitations/i.test(sql), false);
assert.equal(/invited_by/i.test(sql), false);

const helper = fs.readFileSync(path.join(root, "server/api/_boss-invite-links.js"), "utf8");
assert.match(helper, /redeemInviteAfterCompanionReady/);
assert.match(helper, /bindRelation/);
assert.match(helper, /commissionRate:\s*null/);

const api = fs.readFileSync(path.join(root, "server/api/boss/invite-links.js"), "utf8");
assert.match(api, /requireBoss/);
assert.match(api, /hasBossRole/);
assert.match(api, /FORBIDDEN_OTHER_BOSS/);
assert.match(api, /账号已停用/);

const companion = fs.readFileSync(path.join(root, "server/api/companion.js"), "utf8");
assert.match(companion, /redeemInviteAfterCompanionReady/);
assert.match(companion, /inviteCode/);
const regIdx = companion.indexOf('if (action === "register")');
const redeemIdx = companion.indexOf("redeemInviteAfterCompanionReady", regIdx);
const profileCreateIdx = companion.indexOf('restUrl("companion_profiles")', regIdx);
assert.ok(regIdx > 0 && redeemIdx > profileCreateIdx, "redeem must run after companion_profiles create");

const flags = fs.readFileSync(path.join(root, "server/api/_feature-flags.js"), "utf8");
assert.match(flags, /isBossInviteLinksEnabled/);
assert.match(flags, /BOSS_INVITE_LINKS_ENABLED/);

assert.ok(fs.existsSync(path.join(root, "supabase/pending-prod/09_boss_invite_links.sql")));
assert.ok(!fs.existsSync(path.join(root, "supabase/pending-prod/08_boss_invite_links.sql")));

const { generateInviteCode, publicInviteUrl, viewInviteLink } = await import(
  "../server/api/_boss-invite-links.js"
);
const c1 = generateInviteCode();
const c2 = generateInviteCode();
assert.ok(c1.length >= 16);
assert.notEqual(c1, c2);
assert.match(publicInviteUrl(c1), /invite\.html\?code=/);
const view = viewInviteLink({
  id: "x",
  code: c1,
  boss_id: "b",
  status: "active",
  max_uses: null,
  use_count: 0,
});
assert.equal(view.code, c1);
assert.ok(view.url.includes(c1));

console.log("PASS boss invite links v1 offline checks");
