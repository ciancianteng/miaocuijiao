/**
 * Smoke / unit coverage for Auth orphan heal + boss_uid sequence (A–I).
 * No network, no real OTP, no Production touches.
 */
import assert from "node:assert/strict";
import {
  classifyAuthPortalIntent,
  shouldHealAsBoss,
  repairDeniedMessage,
  maxBossUidNumberFromList,
  nextBossUidAfterMax,
  computeBossUidSeqSyncPlan,
  collectAuthRoleHints,
} from "../server/api/_auth-orphan-heal.js";
import { parseBossCodeNumber, formatBossCode } from "../server/api/_account-codes.js";
import fs from "node:fs";
import path from "node:path";

function section(name) {
  console.log(`\n== ${name} ==`);
}

/** Simulate trigger: nextval + unique retry only (no sync/setval). */
function simulateConcurrentNextvalAlloc(lastValue, existingUids = []) {
  let seq = Math.max(0, Number(lastValue) || 0);
  const taken = new Set(existingUids);
  function allocOne() {
    let guard = 0;
    while (guard++ < 64) {
      seq += 1; // nextval
      const candidate = formatBossCode(seq);
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw new Error("unable to allocate unique boss_uid");
  }
  return { allocOne, getSeq: () => seq };
}

section("A concurrent Boss register → distinct UIDs (nextval only)");
{
  const sim = simulateConcurrentNextvalAlloc(14, ["MCJ00014"]);
  const a = sim.allocOne();
  const b = sim.allocOne();
  assert.notEqual(a, b);
  assert.equal(a, "MCJ00015");
  assert.equal(b, "MCJ00016");
}

section("B seq=20 / max=14 → no regress; next stays 21");
{
  const plan = computeBossUidSeqSyncPlan(20, 14);
  assert.equal(plan.target, 20);
  assert.equal(plan.shouldSetval, false);
  assert.equal(plan.setvalTo, null);
  // Sequence stays at 20 → next nextval is 21
  assert.equal(nextBossUidAfterMax(plan.target), 21);
}

section("C seq=20 / no valid UID → no regress");
{
  const plan = computeBossUidSeqSyncPlan(20, 0);
  assert.equal(plan.target, 20);
  assert.equal(plan.shouldSetval, false);
  const maxEmpty = maxBossUidNumberFromList(["", "FOO", "mcj", "B"], parseBossCodeNumber);
  assert.equal(maxEmpty, 0);
  assert.equal(computeBossUidSeqSyncPlan(20, maxEmpty).shouldSetval, false);
}

section("D migration re-run idempotent + seq8/max14 bumps to 14 → next 15");
{
  const bump = computeBossUidSeqSyncPlan(8, 14);
  assert.equal(bump.target, 14);
  assert.equal(bump.shouldSetval, true);
  assert.equal(bump.setvalTo, 14);
  assert.equal(nextBossUidAfterMax(bump.setvalTo), 15);
  // Re-run after bump: last=14, max=14 → no-op
  const again = computeBossUidSeqSyncPlan(14, 14);
  assert.equal(again.shouldSetval, false);
  assert.equal(again.target, 14);
}

section("E empty metadata orphan → NOT Boss heal");
{
  const orphan = { id: "e1", user_metadata: {}, app_metadata: {} };
  assert.equal(classifyAuthPortalIntent(orphan), "unknown");
  assert.equal(shouldHealAsBoss(orphan), false);
  assert.match(repairDeniedMessage("unknown"), /客服|修复/);
}

section("F companion trace + empty metadata → NOT Boss heal");
{
  const emptyMeta = { id: "f1", user_metadata: {}, app_metadata: {} };
  assert.equal(shouldHealAsBoss(emptyMeta, { companionProfileExists: true }), false);
  assert.equal(classifyAuthPortalIntent(emptyMeta, { hasCompanionTrace: true }), "companion");
  assert.equal(shouldHealAsBoss({ id: "f2", app_metadata: { roles: ["companion"] } }), false);
  // Dual-role with companion trace still blocked
  assert.equal(
    shouldHealAsBoss({ id: "f3", user_metadata: { roles: ["boss", "companion"] } }),
    false
  );
}

section("G explicit Boss orphan → heal allowed");
{
  assert.equal(classifyAuthPortalIntent({ id: "g1", app_metadata: { roles: ["boss"] } }), "boss");
  assert.equal(shouldHealAsBoss({ id: "g1", app_metadata: { roles: ["boss"] } }), true);
  assert.equal(shouldHealAsBoss({ id: "g2", user_metadata: { role: "customer" } }), true);
  assert.equal(shouldHealAsBoss({ id: "g3", app_metadata: { roles: ["admin"] } }), false);
  assert.equal(shouldHealAsBoss({ id: "g4", app_metadata: { roles: ["customer_service"] } }), false);
  assert.deepEqual([...collectAuthRoleHints({ app_metadata: { roles: ["Boss"] } })], ["boss"]);
}

section("H trigger no longer calls sync/setval");
{
  const migPath = path.resolve("supabase/migrations/20260831_sync_boss_uid_seq.sql");
  const mig = fs.readFileSync(migPath, "utf8");
  assert.match(mig, /mcj_sync_boss_uid_seq/);
  assert.match(mig, /mcj_max_boss_uid_number/);
  assert.match(mig, /mcj_assign_boss_uid/);
  assert.doesNotMatch(mig, /setval\([^)]*14/);
  assert.match(mig, /select public\.mcj_sync_boss_uid_seq\(\)/);
  assert.match(mig, /greatest\(cur,\s*max_n\)/);
  // Extract trigger function body only
  const trigMatch = mig.match(
    /create or replace function public\.mcj_assign_boss_uid\(\)[\s\S]*?\$\$;/
  );
  assert.ok(trigMatch, "trigger function present");
  const trigBody = trigMatch[0];
  assert.doesNotMatch(trigBody, /mcj_sync_boss_uid_seq/);
  assert.doesNotMatch(trigBody, /setval\s*\(/);
  assert.doesNotMatch(trigBody, /\bmax\s*\(/i);
  assert.match(trigBody, /nextval\('public\.boss_uid_seq'\)/);
}

section("I OTP: mail not sent → frontend must not countdown");
{
  const auth = fs.readFileSync("server/api/auth.js", "utf8");
  assert.match(auth, /mailSent:\s*true/);
  assert.match(auth, /mailSent:\s*false/);
  assert.match(auth, /privacy/);
  // Prod mail failure returns privacy (mailSent false), not fake success with countdown
  assert.match(auth, /\[auth\/send_login_otp\] mail failed/);
  assert.doesNotMatch(auth, /假成功|fake.?success/i);

  const gates = fs.readFileSync("src/role-gates.js", "utf8");
  assert.match(gates, /mailSent === true/);
  assert.match(gates, /var mailed = j\.mailSent === true \|\| !!j\.devCode/);
}

section("Rollback + heal wiring markers");
{
  const auth = fs.readFileSync("server/api/auth.js", "utf8");
  assert.match(auth, /rollbackCreatedAuthUser/);
  assert.match(auth, /AUTH_ROLLBACK_FAILED/);
  assert.match(auth, /createdAuthId/);
  assert.match(auth, /Auth user still present after DELETE/);
  assert.match(auth, /assertCanHealBossOrThrow/);
  assert.match(auth, /loadHealExtrasForAuthUser/);
  assert.match(auth, /ACCOUNT_NEEDS_REPAIR/);
  assert.match(auth, /ensureBossProfileForAuthUser/);
  assert.match(auth, /MAIL_SEND_FAILED/);
}

console.log("\nOK smoke-auth-orphan-heal (A–I)");
