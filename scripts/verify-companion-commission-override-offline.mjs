/**
 * Offline unit checks for companion commission SoT.
 * Run: node scripts/verify-companion-commission-override-offline.mjs
 */
import {
  parseCompanionShareOverride,
  resolveEffectiveCompanionCommission,
  resolvePlatformCommission,
  splitByCompanionShare,
} from "../server/api/_commission-rates.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Case D: platform default 80% share (platform rate 20 on profile)
{
  const r = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20 },
    levelPlatformRate: 20,
  });
  assert(r.companionShareRate === 80, "D share should be 80");
  assert(r.source === "system", "D source system");
}

// Case E: club 70%
{
  const r = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20 },
    clubMeta: { companionShareRate: 70, name: "KC" },
    levelPlatformRate: 20,
  });
  assert(r.companionShareRate === 70, "E share 70");
  assert(r.source === "club", "E club");
}

// Case F: override 75 beats club 70
{
  const r = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20, commission_rate_override: 75 },
    clubMeta: { companionShareRate: 70, name: "KC" },
  });
  assert(r.companionShareRate === 75, "F override 75");
  assert(r.source === "override", "F override");
}

// Case G: clear override → back to club
{
  const r = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate: 20, commission_rate_override: null },
    clubMeta: { companionShareRate: 70, name: "KC" },
  });
  assert(r.companionShareRate === 70, "G inherit club 70");
}

// Case H: plain override 85
{
  const r = resolveEffectiveCompanionCommission({
    companionProfile: { commission_rate_override: 85 },
  });
  assert(r.companionShareRate === 85, "H 85");
}

// Case I: historical snapshot independence — split uses snapshotted rate
{
  const old = splitByCompanionShare(70, 80);
  const next = splitByCompanionShare(70, 70);
  assert(old.companionNet === 56, "I old 56");
  assert(next.companionNet === 49, "I new 49");
  assert(old.companionNet !== next.companionNet, "I must not mutate history math");
}

// Case J: multi allocation
{
  const a = splitByCompanionShare(35, 80);
  const b = splitByCompanionShare(35, 70);
  assert(a.companionNet === 28, "J A 28");
  assert(b.companionNet === 24.5, "J B 24.5");
  assert(a.companionNet + b.companionNet === 52.5, "J sum incomes");
  assert(a.amount + b.amount === 70, "J allocations still 70 total");
}

assert(parseCompanionShareOverride("") === null, "empty override null");
assert(parseCompanionShareOverride(101) === null, "101 invalid");
assert(parseCompanionShareOverride(80) === 80, "80 ok");
assert(resolvePlatformCommission(80).platformRate === 20, "legacy share 80→platform 20");

console.log("PASS verify-companion-commission-override-offline");
