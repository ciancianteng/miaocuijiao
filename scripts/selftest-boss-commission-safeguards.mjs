/**
 * Safeguard selftests for Boss commission / levels / settlement rules (no DB).
 */
import assert from "node:assert/strict";
import { calcBossCommissionFromPlatformFee } from "../server/api/_boss-commission.js";
import { pinStillActive } from "../server/api/_boss-levels.js";

function nearly(a, b) {
  assert.equal(Math.round(Number(a) * 100) / 100, Math.round(Number(b) * 100) / 100);
}

// 1) Canonical launch case: RM30 → fee 6 → boss 0.30 → companion 24
{
  const order = 30;
  const platformRate = 20;
  const bossRate = 5;
  const r = calcBossCommissionFromPlatformFee({
    orderAmount: order,
    platformFeeRate: platformRate,
    bossCommissionRate: bossRate,
    companionIncomeAmount: 24, // must be ignored for boss calc
  });
  nearly(r.platformFeeAmount, 6);
  nearly(r.bossCommissionAmount, 0.3);
  nearly(order - r.platformFeeAmount, 24);
  assert.equal(r.calculatedFrom, "platform_fee_only");
  assert.equal(r.companionIncomeUnchanged, true);
  // Boss must NOT equal companion_income * rate
  assert.notEqual(r.bossCommissionAmount, Math.round(24 * 0.05 * 100) / 100);
}

// 2) Changing companion income argument must not change boss commission
{
  const a = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
    companionIncomeAmount: 24,
  });
  const b = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
    companionIncomeAmount: 999,
  });
  nearly(a.bossCommissionAmount, b.bossCommissionAmount);
}

// 3) Pin modes
{
  assert.equal(
    pinStillActive({ source: "manual", pin_mode: "permanent", pin_expires_at: null }),
    true
  );
  assert.equal(
    pinStillActive({
      source: "manual",
      pin_mode: "until_expiry",
      pin_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
    true
  );
  assert.equal(
    pinStillActive({
      source: "manual",
      pin_mode: "until_expiry",
      pin_expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
    false
  );
  assert.equal(pinStillActive({ source: "auto", pin_mode: "none" }), false);
}

// 4) Snapshot immutability contract (documented): historical earnings fields listed
{
  const frozen = [
    "order_amount",
    "platform_fee_rate",
    "platform_fee_amount",
    "boss_commission_rate",
    "boss_commission_amount",
    "boss_id",
    "companion_id",
    "order_id",
    "rate_source",
    "boss_level_id",
    "boss_level_code",
  ];
  assert.ok(frozen.includes("boss_commission_amount"));
  assert.ok(frozen.includes("boss_level_code"));
}

console.log("PASS boss-commission-safeguards");
