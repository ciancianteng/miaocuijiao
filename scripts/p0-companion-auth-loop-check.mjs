/**
 * Offline checks for companion auth-loop guards (no live login required).
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const files = {
  early: "public/portal-early-gate.js",
  gates: "src/role-gates.js",
  wb: "src/companion-workbench.js",
  boss: "src/boss-header.js",
};

for (const [k, p] of Object.entries(files)) {
  assert.ok(fs.existsSync(p), `missing ${p}`);
  files[k] = fs.readFileSync(p, "utf8");
}

assert.match(files.early, /companion_soft_pending/);
assert.match(files.early, /__mcjCompanionAuthRedirectAt/);
assert.match(files.early, /Never location\.replace\(self\)/);

assert.match(files.gates, /healCompanionSoftSession/);
assert.match(files.gates, /refreshCompanionAccessToken/);
assert.match(files.gates, /companionAuthRedirectLatch/);
assert.match(files.gates, /正在恢复陪玩登录状态/);

assert.match(files.wb, /resumeAfterVerifiedLogin/);
assert.match(files.wb, /ensureFreshSession/);
assert.match(files.wb, /never bounce login→dashboard on unverified storage/i);
assert.match(files.wb, /location\.replace\('\/companion\/login\/'\)/);

assert.match(files.boss, /hasPortalSession\("companion"\)/);
assert.match(files.boss, /companion_session_/);

console.log("p0-companion-auth-loop-check: ALL PASS");
