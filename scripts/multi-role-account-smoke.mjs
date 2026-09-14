/**
 * Offline smoke: multi-role account wiring (no live mailbox / no secrets).
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

// Dual-role resolution: companion row + boss primary
const dual = roles.resolveRoles(
  { id: "u1", role: "boss", roles: ["boss", "companion"] },
  { companion: { id: "cp1" } }
);
assert.ok(dual.includes("boss"));
assert.ok(dual.includes("companion"));

// Companion-only must NOT auto-gain boss
const companionOnly = roles.resolveRoles(
  { id: "u2", role: "companion", roles: ["companion"] },
  { companion: { id: "cp2" }, grantBossWithCompanion: false }
);
assert.ok(companionOnly.includes("companion"));
assert.equal(companionOnly.includes("boss"), false);

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
]) {
  assert.match(auth, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "auth missing " + needle);
}

const gates = readFileSync(path.join(root, "src/role-gates.js"), "utf8");
assert.match(gates, /BOSS_ROLE_NOT_OPENED/);
assert.match(gates, /delivery === "sent"/);

const workbench = readFileSync(path.join(root, "src/companion-workbench.js"), "utf8");
assert.match(workbench, /data-open-boss-role/);
assert.match(workbench, /open_boss_role/);

console.log("MULTI_ROLE_ACCOUNT_SMOKE: PASS");
