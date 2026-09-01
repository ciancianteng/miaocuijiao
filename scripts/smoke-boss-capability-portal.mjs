/**
 * Boss capability / portal gate unit smoke (no network).
 */
import assert from "node:assert/strict";
import {
  computeCapabilities,
  hasBossRole,
  hasCompanionRole,
  userCanAccessPortal,
  enrichProfileRoles,
  collectRoleHints,
} from "../server/api/_account-roles.js";

function section(n) {
  console.log(`\n== ${n} ==`);
}

section("profiles.role=boss + active → hasBoss");
{
  const caps = computeCapabilities({ id: "1", role: "boss", status: "active", boss_uid: "MCJ00015" });
  assert.equal(caps.hasBoss, true);
  assert.equal(userCanAccessPortal({ ...caps, role: "boss" }, "boss"), true);
}

section("auth metadata boss role → hasBoss even if primary companion");
{
  const caps = computeCapabilities(
    { id: "2", role: "companion", status: "active" },
    { authUser: { app_metadata: { roles: ["boss", "companion"] }, user_metadata: { roles: ["boss", "companion"] } } }
  );
  assert.equal(caps.hasBoss, true);
  assert.equal(caps.hasCompanion, true);
}

section("pure companion → no Boss portal");
{
  const caps = computeCapabilities(
    { id: "3", role: "companion", status: "active" },
    { companion: { id: "cp" }, authUser: { app_metadata: { roles: ["companion"] } } }
  );
  assert.equal(caps.hasBoss, false);
  assert.equal(caps.hasCompanion, true);
  assert.equal(userCanAccessPortal({ hasBoss: false, hasCompanion: true, role: "companion" }, "boss"), false);
  assert.equal(userCanAccessPortal({ hasBoss: false, hasCompanion: true, role: "companion" }, "companion"), true);
}

section("boss_uid alone → NOT hasBoss");
{
  const caps = computeCapabilities({ id: "4", role: "companion", boss_uid: "MCJ00013" }, { companion: { id: "cp" } });
  assert.equal(caps.hasBoss, false);
}

section("enrichProfileRoles never strips boss");
{
  const enriched = await enrichProfileRoles(
    { id: "5", role: "companion", status: "active" },
    { id: "5", app_metadata: { roles: ["boss", "companion"] }, user_metadata: { roles: ["boss"] } },
    { companion: { id: "cp5" } }
  );
  assert.equal(enriched.hasBoss, true);
  assert.equal(enriched.hasCompanion, true);
  assert.equal(String(enriched.profile.role).toLowerCase(), "boss");
}

section("collectRoleHints reads singular metadata role");
{
  const hints = collectRoleHints(
    { role: "companion" },
    { app_metadata: { role: "boss" }, user_metadata: {} }
  );
  assert.ok(hints.includes("boss"));
  assert.ok(hints.includes("companion"));
}

section("hasBossRole mirrors computeCapabilities");
{
  assert.equal(hasBossRole({ role: "boss" }), true);
  assert.equal(hasCompanionRole({ role: "companion" }, { companion: { id: "x" } }), true);
}

console.log("\nOK smoke-boss-capability-portal");
