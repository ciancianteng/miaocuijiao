/**
 * Dual-role capability smoke (A–I) + lawrachel fixture.
 * No network, no Production SQL, no real OTP.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeCapabilities,
  evaluateBossEvidence,
  preferredPrimaryRole,
  resolveRoles,
  publicRolesPayload,
  companionActivationProfilePatch,
  hasBossRole,
  hasCompanionRole,
} from "../server/api/_account-roles.js";

function section(name) {
  console.log(`\n== ${name} ==`);
}

section("A pure Boss");
{
  const caps = computeCapabilities({ id: "a", role: "boss", boss_uid: "MCJ00001" });
  assert.equal(caps.hasBoss, true);
  assert.equal(caps.hasCompanion, false);
}

section("B Boss apply Companion → dual");
{
  const caps = computeCapabilities(
    { id: "b", role: "boss", roles: ["boss", "companion"], boss_uid: "MCJ00002" },
    { companion: { id: "cp-b" } }
  );
  assert.equal(caps.hasBoss, true);
  assert.equal(caps.hasCompanion, true);
  assert.equal(preferredPrimaryRole({ id: "b", role: "boss" }, { companion: { id: "cp-b" } }), "boss");
}

section("C activation must not demote Boss primary");
{
  const patch = companionActivationProfilePatch({ hasBossCapability: true });
  assert.equal(patch.role, undefined);
  assert.equal(patch.status, "active");
  const listing = fs.readFileSync("server/api/_companion-listing-sync.js", "utf8");
  assert.match(listing, /export function activeCompanionProfilePatch/);
  assert.doesNotMatch(
    listing.match(/export function activeCompanionProfilePatch\(\)[\s\S]*?^}/m)?.[0] || "",
    /role:\s*["']companion["']/
  );
}

section("D pure Companion → no Boss; no UID allocation gate");
{
  const caps = computeCapabilities({ id: "d", role: "companion" }, { companion: { id: "cp-d" } });
  assert.equal(caps.hasBoss, false);
  assert.equal(caps.hasCompanion, true);
  // boss_uid alone is NOT enough
  const uidOnly = computeCapabilities(
    { id: "d2", role: "companion", boss_uid: "MCJ00099" },
    { companion: { id: "cp-d2" } }
  );
  assert.equal(uidOnly.hasBoss, false);
  assert.equal(uidOnly.bossUidAlone, true);
}

section("E historical broken: companion + cp + Boss orders → dual");
{
  const caps = computeCapabilities(
    { id: "e", role: "companion", boss_uid: "MCJ00013", roles: ["companion"] },
    { companion: { id: "cp-e" }, evidence: { hasBossOrders: true, bossOrderCount: 2 } }
  );
  assert.equal(caps.hasBoss, true);
  assert.equal(caps.hasCompanion, true);
  assert.equal(caps.primaryRole, "boss");
}

section("F companion + boss_uid, no Boss evidence → do NOT promote");
{
  const caps = computeCapabilities(
    { id: "f", role: "companion", boss_uid: "MCJ00013" },
    { companion: { id: "cp-f" }, evidence: { hasBossOrders: false, bossOrderCount: 0 } }
  );
  assert.equal(caps.hasBoss, false);
  assert.equal(caps.hasCompanion, true);
  assert.equal(evaluateBossEvidence({}), false);
}

section("G Boss portal gates (dual-role)");
{
  const dual = publicRolesPayload(
    { id: "g", role: "companion", boss_uid: "MCJ00013", roles: ["companion"] },
    { companion: { id: "cp-g" }, evidence: { hasBossOrders: true } }
  );
  assert.equal(dual.hasBoss, true);
  // Mirror auth userHasPortalAccess(boss)
  const canBoss = !!(dual.hasBoss === true);
  assert.equal(canBoss, true);
  const auth = fs.readFileSync("server/api/auth.js", "utf8");
  assert.match(auth, /hasBoss === true/);
  assert.match(auth, /allocate only when Boss capability/);
}

section("H Companion portal gates (dual with primary boss)");
{
  const dual = computeCapabilities(
    { id: "h", role: "boss", roles: ["boss", "companion"], boss_uid: "MCJ00010" },
    { companion: { id: "cp-h" } }
  );
  assert.equal(dual.hasCompanion, true);
  assert.equal(hasCompanionRole({ id: "h", role: "boss" }, { companion: { id: "cp-h" } }), true);
  const pub = fs.readFileSync("server/api/public/companions.js", "utf8");
  // Hall must not require role=eq.companion only
  assert.doesNotMatch(pub, /role=eq\.companion&status=eq\.active/);
}

section("I enrichProfileRoles no longer strips Boss");
{
  const src = fs.readFileSync("server/api/_account-roles.js", "utf8");
  assert.doesNotMatch(src, /filter\(\(r\) => r !== ["']boss["']\)/);
  assert.match(src, /Additive|additive|capabilities may include boss \+ companion/i);
  // roles with boss+companion and primary companion still resolve hasBoss
  const roles = resolveRoles(
    { id: "i", role: "companion", roles: ["companion", "boss"] },
    { companion: { id: "cp-i" } }
  );
  assert.ok(roles.includes("boss"));
  assert.ok(roles.includes("companion"));
  assert.equal(hasBossRole({ id: "i", role: "companion", roles: ["companion", "boss"] }), true);
}

section("lawrachel fixture");
{
  const fixture = {
    email: "lawrachel0853@gmail.com",
    profile: {
      id: "fixture-lawrachel",
      role: "companion",
      status: "active",
      boss_uid: "MCJ00013",
      roles: ["companion"],
    },
    companion: { id: "cp-lawrachel", user_id: "fixture-lawrachel" },
    evidence: { hasBossOrders: true, bossOrderCount: 3 },
  };
  const before = computeCapabilities(fixture.profile, {
    companion: fixture.companion,
    evidence: { hasBossOrders: false },
  });
  assert.equal(before.hasBoss, false, "without order evidence must not be Boss");

  const after = computeCapabilities(fixture.profile, {
    companion: fixture.companion,
    evidence: fixture.evidence,
  });
  assert.equal(after.hasBoss, true);
  assert.equal(after.hasCompanion, true);
  assert.equal(after.primaryRole, "boss");
  assert.equal(fixture.profile.boss_uid, "MCJ00013", "UID unchanged");
  // Simulated portal access
  assert.equal(!!after.hasBoss, true);
  assert.equal(!!after.hasCompanion, true);
}

section("Migration design present");
{
  const mig = fs.readFileSync("supabase/migrations/20260831_dual_role_capability_repair.sql", "utf8");
  assert.match(mig, /DRY-RUN SELECT/);
  assert.match(mig, /orders\.boss_id/);
  assert.match(mig, /UPDATE public\.profiles/);
  assert.match(mig, /role = 'boss'/);
  assert.match(mig, /NEVER promote based on boss_uid alone/);
  assert.match(mig, /exists \(SELECT 1 FROM public\.orders o WHERE o\.boss_id = p\.id\)/);
  // UPDATE must require order evidence or roles boss — not UID-only
  assert.match(mig, /OR \(p\.roles IS NOT NULL AND 'boss' = ANY \(p\.roles\)\)/);
}

section("Markers: apply_companion / ensureBossUid / withdraw script");
{
  const companion = fs.readFileSync("server/api/companion.js", "utf8");
  assert.match(companion, /preferredPrimaryRole/);
  assert.match(companion, /Never overwrite Boss primary/);
  const auth = fs.readFileSync("server/api/auth.js", "utf8");
  assert.match(auth, /hasBossRole/);
  const withdraw = fs.readFileSync("scripts/ensure-companion-withdraw-ready.mjs", "utf8");
  assert.match(withdraw, /Never demote an existing Boss primary/);
}

console.log("\nOK smoke-dual-role-capability (A–I + lawrachel)");
