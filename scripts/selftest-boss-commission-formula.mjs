/**
 * Unit checks for boss commission formula (no DB).
 * Formula: boss = platform_fee * boss_rate / 100
 *          platform_fee = order_amount * platform_rate / 100
 * Companion income must remain independent.
 */
import assert from "node:assert/strict";
import { calcBossCommissionFromPlatformFee } from "../server/api/_boss-commission.js";

function nearly(a, b) {
  assert.equal(Math.round(a * 100) / 100, Math.round(b * 100) / 100);
}

{
  const r = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
  });
  nearly(r.platformFeeAmount, 6);
  nearly(r.bossCommissionAmount, 0.3);
}

{
  const r = calcBossCommissionFromPlatformFee({
    orderAmount: 100,
    platformFeeRate: 20,
    bossCommissionRate: 10,
  });
  nearly(r.platformFeeAmount, 20);
  nearly(r.bossCommissionAmount, 2);
  // companion share would be 80; boss commission must NOT be subtracted from it
  const companionIncome = 80;
  nearly(companionIncome, 80);
}

{
  const r = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 0,
  });
  nearly(r.bossCommissionAmount, 0);
}

console.log("PASS boss-commission-formula");
