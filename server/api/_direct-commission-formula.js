/**
 * Locked money formula for 直属返点 / 老板佣金 / PLATFORM_PROFIT referral.
 *
 *   order_amount (customer payment)
 *     → platform_fee = order_amount × platform_rate / 100
 *     → direct_rebate / boss_commission = platform_fee × rebate_rate / 100
 *     → companion_income = order_amount − platform_fee   (unchanged by rebate)
 *
 * Canonical case:
 *   RM30 × 20% = platform RM6
 *   RM6 × 5%   = rebate RM0.30
 * Forbidden:
 *   RM30 × 5%  = RM1.50
 *
 * Does not touch wallets, schema, or settlement wiring — pure math only.
 */
import { money, roundMoney } from "./_commission-rates.js";

/**
 * @param {{
 *   orderAmount?: number,
 *   platformFeeRate?: number,
 *   platformFeeAmount?: number,
 *   rebateRate?: number,
 *   bossCommissionRate?: number,
 * }} input
 */
export function calcDirectCommissionFromPlatformFee(input = {}) {
  const orderAmount = roundMoney(input.orderAmount);
  const platformRate = Math.min(100, Math.max(0, money(input.platformFeeRate ?? 20)));
  const rebateRate = Math.min(
    100,
    Math.max(0, money(input.rebateRate ?? input.bossCommissionRate ?? 0))
  );

  const platformFeeAmount =
    input.platformFeeAmount != null && input.platformFeeAmount !== ""
      ? roundMoney(input.platformFeeAmount)
      : roundMoney((orderAmount * platformRate) / 100);

  // SAFETY: rebate ALWAYS from platform_fee — never from order gross / companion income
  const rebateAmount = roundMoney((platformFeeAmount * rebateRate) / 100);
  const forbiddenOrderBased = roundMoney((orderAmount * rebateRate) / 100);
  const companionIncomeAmount = roundMoney(Math.max(0, orderAmount - platformFeeAmount));

  return {
    orderAmount,
    platformFeeRate: platformRate,
    platformFeeAmount,
    rebateRate,
    bossCommissionRate: rebateRate,
    rebateAmount,
    bossCommissionAmount: rebateAmount,
    companionIncomeAmount,
    companionIncomeUnchanged: true,
    calculatedFrom: "platform_fee_only",
    formula: "rebate = platform_fee * rate / 100",
    // Explicit anti-regression signal for tests / audits
    forbiddenOrderBasedAmount: forbiddenOrderBased,
    isForbiddenOrderBased: Math.abs(rebateAmount - forbiddenOrderBased) > 0.001 && rebateRate > 0 && platformRate !== 100,
  };
}

/** Canonical Staging acceptance numbers */
export const CANONICAL_RM30 = Object.freeze({
  orderAmount: 30,
  platformFeeRate: 20,
  rebateRate: 5,
  expectPlatformFee: 6,
  expectRebate: 0.3,
  expectCompanionIncome: 24,
  forbidRebate: 1.5,
});
