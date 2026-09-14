/**
 * Offline smoke: multi-role account wiring (no live mailbox / no secrets).
 * Static guarantees for A–H product rules in PR #249.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roles = await import(pathToFileURL(path.join(root, "server/api/_account-roles.js")).href);

assert.equal(typeof roles.addRoleToUser, "function");
assert.equal(typeof roles.enrichProfileRoles, "function");
assert.equal(typeof roles.resolveRoles, "function");
assert.equal(typeof roles.assertNotSelfTrade, "function");
assert.equal(typeof roles.isSelfOrderBlockedCode, "function");

const dual = roles.resolveRoles(
  { id: "u1", role: "boss", roles: ["boss", "companion"] },
  { companion: { id: "cp1" } }
);
assert.ok(dual.includes("boss"));
assert.ok(dual.includes("companion"));

const companionOnly = roles.resolveRoles(
  { id: "u2", role: "companion", roles: ["companion"] },
  { companion: { id: "cp2" }, grantBossWithCompanion: false }
);
assert.ok(companionOnly.includes("companion"));
assert.equal(companionOnly.includes("boss"), false);

assert.throws(
  () => roles.assertNotSelfTrade("same-id", "same-id", "给自己下单"),
  (err) => err && err.code === "SELF_ORDER_NOT_ALLOWED"
);
assert.doesNotThrow(() => roles.assertNotSelfTrade("boss-1", "companion-2", "下单"));
assert.equal(roles.isSelfOrderBlockedCode("SELF_ORDER_NOT_ALLOWED"), true);
assert.equal(roles.isSelfOrderBlockedCode("SELF_TRADE_FORBIDDEN"), true);

const auth = readFileSync(path.join(root, "server/api/auth.js"), "utf8");
for (const needle of [
  "classifyLoginPortalAccount",
  "BOSS_ROLE_NOT_OPENED",
  "COMPANION_ROLE_NOT_OPENED",
  "ROLE_NOT_OPENED",
  "open_boss_role",
  "handleOpenBossRole",
  "COMPANION_EXISTS_OPEN_BOSS",
  "createdNewAuthUser: false",
  'delivery: mailOk ? "sent"',
]) {
  assert.match(auth, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "auth missing " + needle);
}

const gates = readFileSync(path.join(root, "src/role-gates.js"), "utf8");
assert.match(gates, /BOSS_ROLE_NOT_OPENED/);
assert.match(gates, /delivery === "sent"/);
assert.match(gates, /delivered \? Number\(j\.retryAfterSec/);

const applyPage = readFileSync(path.join(root, "src/companion-application.js"), "utf8");
assert.match(applyPage, /delivery === "sent"/);
assert.match(applyPage, /if \(delivered\) startAuthCooldown/);
assert.match(applyPage, /if \(loginDelivered\) startAuthCooldown/);

const workbench = readFileSync(path.join(root, "src/companion-workbench.js"), "utf8");
assert.match(workbench, /data-open-boss-role/);
assert.match(workbench, /open_boss_role/);
assert.match(workbench, /hasBoss/);

const marketplace = readFileSync(path.join(root, "server/api/boss/marketplace.js"), "utf8");
assert.match(marketplace, /assertNotSelfTrade/);
assert.match(marketplace, /SELF_ORDER_NOT_ALLOWED/);
assert.match(marketplace, /不能向自己的陪玩账号下单/);

const orders = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
assert.match(orders, /assertNotSelfTrade/);
assert.match(orders, /SELF_ORDER_NOT_ALLOWED/);

const companionApi = readFileSync(path.join(root, "server/api/companion.js"), "utf8");
assert.match(companionApi, /assertNotSelfTrade/);
assert.match(companionApi, /boss_id[\s\S]{0,120}profile\.id/);
assert.match(companionApi, /抢自己的订单/);

console.log("MULTI_ROLE_ACCOUNT_SMOKE: PASS");
console.log(
  JSON.stringify(
    {
      A_open_boss: "static-PASS",
      B_apply_companion_path: "static-PASS",
      C_boss_otp_delivery_sent: "static-PASS",
      D_companion_otp_delivery_sent: "static-PASS",
      E_no_second_auth_user: "static-PASS",
      F_self_order_block: "static-PASS",
      G_self_grab_block: "static-PASS",
      H_same_profile_id: "static-PASS",
    },
    null,
    2
  )
);
