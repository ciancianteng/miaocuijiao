#!/usr/bin/env node
/**
 * Guard: PWA install auto-prompt must stay enabled (MCJ-PWA-INSTALL-PROMPT-V1).
 * Fails if scheduleAutoShow / waitBriefly are early-returned / disabled again.
 */
import fs from "node:fs";

const TAG = "MCJ-PWA-INSTALL-PROMPT-V1";
let failed = 0;
function ok(m) {
  console.log(`  OK  ${m}`);
}
function fail(m) {
  failed += 1;
  console.error(`  FAIL  ${m}`);
}

function check(path) {
  const s = fs.readFileSync(path, "utf8");
  if (/never auto-popup install sheet/.test(s)) fail(`${path}: auto-popup still disabled comment`);
  else ok(`${path}: no disable comment`);
  if (/Auto install prompts disabled/.test(s)) fail(`${path}: waitBriefly disabled comment`);
  else ok(`${path}: waitBriefly active`);

  const sched = s.match(/function scheduleAutoShow\(\)\s*\{([\s\S]*?)\n  function /);
  if (!sched) fail(`${path}: scheduleAutoShow missing`);
  else if (/^\s*return;\s*$/m.test(sched[1].split("if (autoScheduled)")[0])) {
    fail(`${path}: scheduleAutoShow has early return before logic`);
  } else ok(`${path}: scheduleAutoShow runnable`);

  const wait = s.match(/function waitBrieflyForBipThenSchedule\(\)\s*\{([\s\S]*?)\n  function /);
  if (!wait) fail(`${path}: waitBriefly missing`);
  else if (/^\s*return;\s*$/m.test(wait[1].split("var platform")[0])) {
    fail(`${path}: waitBriefly has early return before logic`);
  } else ok(`${path}: waitBriefly runnable`);

  if (!/beforeinstallprompt/.test(s)) fail(`${path}: missing beforeinstallprompt`);
  else ok(`${path}: beforeinstallprompt`);
  if (!/appinstalled/.test(s)) fail(`${path}: missing appinstalled`);
  else ok(`${path}: appinstalled`);
  if (!/mcj_pwa_prompt_dismissed_at/.test(s)) fail(`${path}: missing dismiss LS key`);
  else ok(`${path}: dismiss cooldown key`);
  if (!/7 \* 24 \* 60 \* 60 \* 1000/.test(s)) fail(`${path}: missing 7-day dismiss`);
  else ok(`${path}: 7-day dismiss`);
}

console.log(`[${TAG}] offline check`);
check("src/pwa-install-prompt.js");
if (fs.existsSync("public/src/pwa-install-prompt.js")) check("public/src/pwa-install-prompt.js");

const boot = fs.readFileSync("pwa-boot.js", "utf8");
if (/loadInstallGuide/.test(boot) && /pwa-install-prompt\.js/.test(boot)) ok("pwa-boot loads install guide");
else fail("pwa-boot missing loadInstallGuide");

if (failed) {
  console.error(`[${TAG}] FAILED (${failed})`);
  process.exit(1);
}
console.log(`[${TAG}] PASS`);
