/**
 * Selftest: 直属返点 / 老板佣金 = 平台服务费 × 比例（禁止订单金额 × 比例）
 *
 * Canonical:
 *   RM30 × 20% = RM6 platform fee
 *   RM6 × 5%   = RM0.30 rebate
 * Forbidden:
 *   RM30 × 5%  = RM1.50
 *
 * Usage: node scripts/selftest-direct-commission-rm30.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  calcDirectCommissionFromPlatformFee,
  CANONICAL_RM30,
} from "../server/api/_direct-commission-formula.js";

function nearly(a, b, label) {
  const left = Math.round(Number(a) * 100) / 100;
  const right = Math.round(Number(b) * 100) / 100;
  assert.equal(left, right, label || `${left} !== ${right}`);
}

{
  const c = CANONICAL_RM30;
  const r = calcDirectCommissionFromPlatformFee({
    orderAmount: c.orderAmount,
    platformFeeRate: c.platformFeeRate,
    rebateRate: c.rebateRate,
  });
  nearly(r.platformFeeAmount, c.expectPlatformFee, "platform fee RM6");
  nearly(r.rebateAmount, c.expectRebate, "rebate RM0.30");
  nearly(r.bossCommissionAmount, c.expectRebate, "boss commission alias");
  nearly(r.companionIncomeAmount, c.expectCompanionIncome, "companion RM24");
  nearly(r.forbiddenOrderBasedAmount, c.forbidRebate, "forbidden RM1.50 computed for guard");
  assert.notEqual(r.rebateAmount, c.forbidRebate, "must NOT equal order×5%");
  assert.equal(r.calculatedFrom, "platform_fee_only");
  console.log("PASS canonical RM30 → fee RM6 → rebate RM0.30 (not RM1.50)");
}

{
  // Explicit platform fee override still uses fee×rate
  const r = calcDirectCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeAmount: 6,
    rebateRate: 5,
  });
  nearly(r.rebateAmount, 0.3);
  console.log("PASS explicit platformFeeAmount×5% = RM0.30");
}

{
  const r = calcDirectCommissionFromPlatformFee({
    orderAmount: 100,
    platformFeeRate: 20,
    bossCommissionRate: 10,
  });
  nearly(r.platformFeeAmount, 20);
  nearly(r.bossCommissionAmount, 2);
  nearly(r.companionIncomeAmount, 80);
  assert.notEqual(r.bossCommissionAmount, 10, "must not be order×10%");
  console.log("PASS RM100/20%/10% → fee20 → boss2 (companion 80 unchanged)");
}

{
  const r = calcDirectCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    rebateRate: 0,
  });
  nearly(r.rebateAmount, 0);
  nearly(r.companionIncomeAmount, 24);
  console.log("PASS zero rebate rate → RM0, companion still RM24");
}

// Mirror src/commission-engine referral snapshot semantics (PLATFORM_PROFIT base)
{
  const platformFee = 6;
  const rebateRate = 5;
  const rebateAmount = Math.round(((platformFee * rebateRate) / 100) * 100) / 100;
  nearly(rebateAmount, 0.3);
  assert.notEqual(Math.round(((30 * rebateRate) / 100) * 100) / 100, rebateAmount);
  console.log("PASS referral snapshot base=PLATFORM_PROFIT (fee×rate)");
}

// commission-engine.js browser bundle (vm)
{
  const enginePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/commission-engine.js");
  const code = fs.readFileSync(enginePath, "utf8");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const eng = sandbox.window.MCJCommissionEngine;
  assert.ok(eng, "MCJCommissionEngine loaded");
  const orderSnap = eng.calculateOrderSnapshot(
    { paid_amount: 30 },
    { platform_commission_rate: 20, player_income_rate: 80, inviter_rebate_rate: 5 }
  );
  nearly(orderSnap.platform_commission_amount, 6);
  nearly(orderSnap.inviter_rebate_amount, 0.3);
  assert.notEqual(orderSnap.inviter_rebate_amount, 1.5);
  const refSnap = eng.calculateReferralSnapshot(
    { paid_amount: 30, platform_commission_rate: 20 },
    { rebate_rate: 5, rebate_source: "PLATFORM_PROFIT" }
  );
  nearly(refSnap.base_amount, 6);
  nearly(refSnap.rebate_amount, 0.3);
  const direct = eng.calculateDirectCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    rebateRate: 5,
  });
  nearly(direct.rebate_amount, 0.3);
  nearly(direct.companion_income_amount, 24);
  console.log("PASS commission-engine.js RM30 snapshots");
}

console.log("ALL PASS — direct commission formula locked to platform_fee × rate");
