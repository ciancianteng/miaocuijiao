/**
 * Offline regression for companion commission SoT.
 * Run: node scripts/verify-companion-commission-override-offline.mjs
 */
import assert from "node:assert/strict";
import {
  resolveEffectiveCompanionCommission,
  splitByCompanionShare,
  parseCompanionShareOverride,
  resolvePlatformCommission,
} from "../server/api/_commission-rates.js";

function caseD_systemDefault() {
  const e = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20 },
    fallbackPlatform: 20,
  });
  assert.equal(e.companionShareRate, 80);
  assert.equal(e.source, "system");
}

function caseE_clubDefault() {
  const e = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20 },
    clubMeta: { companionShareRate: 70, name: "KC" },
    fallbackPlatform: 20,
  });
  assert.equal(e.companionShareRate, 70);
  assert.equal(e.source, "club");
}

function caseF_override() {
  const e = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20, commission_rate_override: 75 },
    clubMeta: { companionShareRate: 70, name: "KC" },
  });
  assert.equal(e.companionShareRate, 75);
  assert.equal(e.source, "override");
}

function caseG_clearOverride() {
  const e = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20, commission_rate_override: null },
    clubMeta: { companionShareRate: 70, name: "KC" },
  });
  assert.equal(e.companionShareRate, 70);
  assert.equal(e.source, "club");
}

function caseH_plainOverride() {
  const e = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20, commission_rate_override: 85 },
  });
  assert.equal(e.companionShareRate, 85);
  assert.equal(e.platformRate, 15);
}

function caseJ_multiAllocation() {
  const a = splitByCompanionShare(35, 80);
  const b = splitByCompanionShare(35, 70);
  assert.equal(a.companionNet, 28);
  assert.equal(b.companionNet, 24.5);
  assert.equal(a.amount + b.amount, 70);
  // Must NOT double-count full order for each companion
  assert.ok(a.companionNet + b.companionNet < 70);
}

function caseNullInherit() {
  assert.equal(parseCompanionShareOverride(null), null);
  assert.equal(parseCompanionShareOverride(""), null);
  assert.equal(parseCompanionShareOverride(80), 80);
  const legacy = resolvePlatformCommission(80, 20);
  assert.equal(legacy.companionShareRate, 80);
  assert.equal(legacy.platformRate, 20);
}

function caseI_snapshotImmutabilityDoc() {
  // Settlement snapshots live on orders; changing override must not rewrite settled rows.
  // This asserts the split math for a locked 80% snapshot stays 56 on RM70.
  const snap = splitByCompanionShare(70, 80);
  assert.equal(snap.companionNet, 56);
  assert.equal(snap.platformFee, 14);
  const later = splitByCompanionShare(70, 70);
  assert.equal(later.companionNet, 49);
  assert.notEqual(snap.companionNet, later.companionNet);
}

const tests = [
  caseD_systemDefault,
  caseE_clubDefault,
  caseF_override,
  caseG_clearOverride,
  caseH_plainOverride,
  caseJ_multiAllocation,
  caseNullInherit,
  caseI_snapshotImmutabilityDoc,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log("PASS", t.name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", t.name, err?.message || err);
  }
}
if (failed) {
  console.error(`FAILED ${failed}/${tests.length}`);
  process.exit(1);
}
console.log(`OK ${tests.length}/${tests.length}`);
