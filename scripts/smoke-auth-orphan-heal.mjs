/**
 * Smoke / unit coverage for Auth orphan heal + boss_uid sequence math.
 * No network, no real OTP, no Production touches.
 */
import assert from "node:assert/strict";
import {
  classifyAuthPortalIntent,
  shouldHealAsBoss,
  repairDeniedMessage,
  maxBossUidNumberFromList,
  nextBossUidAfterMax,
  collectAuthRoleHints,
} from "../server/api/_auth-orphan-heal.js";
import { parseBossCodeNumber, formatBossCode } from "../server/api/_account-codes.js";
import fs from "node:fs";
import path from "node:path";

function section(name) {
  console.log(`\n== ${name} ==`);
}

section("G/H classify + anti Boss escalation");
assert.equal(classifyAuthPortalIntent({ id: "1", app_metadata: { roles: ["companion"] } }), "companion");
assert.equal(shouldHealAsBoss({ id: "1", app_metadata: { roles: ["companion"] } }), false);
assert.equal(classifyAuthPortalIntent({ id: "2", app_metadata: { roles: ["admin"] } }), "staff");
assert.equal(shouldHealAsBoss({ id: "2", app_metadata: { roles: ["customer_service"] } }), false);
assert.equal(classifyAuthPortalIntent({ id: "3", app_metadata: { roles: ["boss"] } }), "boss");
assert.equal(shouldHealAsBoss({ id: "3", user_metadata: {} }), true); // empty roles ⇒ boss-eligible orphan
assert.equal(classifyAuthPortalIntent({ id: "4", user_metadata: { roles: ["boss", "companion"] } }), "boss");
assert.match(repairDeniedMessage("companion"), /陪玩/);
assert.match(repairDeniedMessage("staff"), /管理员|提权/);
assert.deepEqual([...collectAuthRoleHints({ app_metadata: { roles: ["Boss"] } })], ["boss"]);

section("I/J boss_uid sequence math (dynamic max, no hardcode 14)");
const maxFromProfiles = maxBossUidNumberFromList(
  ["MCJ00008", "MCJ00014", "MCJ00009", "B100003", ""],
  parseBossCodeNumber
);
assert.equal(maxFromProfiles, 14);
assert.equal(nextBossUidAfterMax(maxFromProfiles), 15);
assert.equal(formatBossCode(nextBossUidAfterMax(8)), "MCJ00009");
assert.equal(formatBossCode(nextBossUidAfterMax(14)), "MCJ00015");
// Re-run safe: same max ⇒ same next
assert.equal(nextBossUidAfterMax(maxBossUidNumberFromList(["MCJ00014"], parseBossCodeNumber)), 15);

section("Migration file present + dynamic sync (no hardcoded setval 14)");
const migPath = path.resolve("supabase/migrations/20260831_sync_boss_uid_seq.sql");
const mig = fs.readFileSync(migPath, "utf8");
assert.match(mig, /mcj_sync_boss_uid_seq/);
assert.match(mig, /mcj_max_boss_uid_number/);
assert.match(mig, /mcj_assign_boss_uid/);
assert.doesNotMatch(mig, /setval\([^)]*14/);
assert.match(mig, /select public\.mcj_sync_boss_uid_seq\(\)/);

section("A–F code path markers in auth.js + role-gates");
const auth = fs.readFileSync("server/api/auth.js", "utf8");
assert.match(auth, /rollbackCreatedAuthUser/);
assert.match(auth, /AUTH_ROLLBACK_FAILED/);
assert.match(auth, /findAuthUserByEmail/);
assert.match(auth, /shouldHealAsBoss/);
assert.match(auth, /ACCOUNT_NEEDS_REPAIR/);
assert.match(auth, /mailSent:\s*true/);
assert.match(auth, /mailSent:\s*false/);
assert.match(auth, /MAIL_SEND_FAILED/);
assert.match(auth, /ensureBossProfileForAuthUser/);
// Register: orphan heal before create; strict rollback after create
assert.match(auth, /preexistingAuth/);
assert.match(auth, /createdAuthId/);
assert.match(auth, /orphan heal failed/);
// Password login heal
assert.match(auth, /\[auth\/login\] orphan heal failed/);
// send_register_otp checks Auth
assert.match(auth, /authExisting/);

const gates = fs.readFileSync("src/role-gates.js", "utf8");
assert.match(gates, /mailSent === true/);
assert.match(gates, /ACCOUNT_NEEDS_REPAIR|PROFILE_MISSING/);

section("Simulated flows (logical)");
// B: profile fail ⇒ rollback must verify deletion (function exists + throws if still present)
assert.match(auth, /Auth user still present after DELETE/);
// C: rollback failure returns code
assert.match(auth, /code: rollbackErr\?\.code \|\| \"AUTH_ROLLBACK_FAILED\"/);
// D: Auth exists + no profile ⇒ register OTP blocked
assert.match(auth, /该邮箱已有登录账号但资料不完整/);
// E: login OTP heals boss orphan then sends; false mail does not pretend success on prod
assert.match(auth, /\[auth\/send_login_otp\] orphan heal failed/);
assert.match(auth, /验证码发送失败，请稍后重试/);
// F: password path calls ensureBossProfileForAuthUser
assert.ok(auth.includes("ensureBossProfileForAuthUser(authUser)"));

console.log("\nOK smoke-auth-orphan-heal (A–J markers + unit asserts)");
