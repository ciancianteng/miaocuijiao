/** One fixed RM0.80 fee per withdrawal request. Never per order. */
export const WITHDRAW_FEE_CENTS = 80;

const RELEASED = new Set(["rejected", "cancelled", "canceled", "pay_failed", "failed"]);

export function withdrawalLocksBalance(status) {
  const key = String(status || "").trim();
  if (!key || RELEASED.has(key)) return false;
  return true;
}

export function quoteWithdrawal({ amount, exchangeRate = 1 } = {}) {
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;
  const grossCents = Math.round(Number(amount) * rate * 100);
  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    return { ok: false, status: 400, message: "提现金额必须大于 0" };
  }
  if (grossCents <= WITHDRAW_FEE_CENTS) {
    return { ok: false, status: 400, message: "本次申请金额必须高于 RM0.80" };
  }
  return {
    ok: true,
    grossCents,
    feeCents: WITHDRAW_FEE_CENTS,
    gross: grossCents / 100,
    fee: WITHDRAW_FEE_CENTS / 100,
    net: (grossCents - WITHDRAW_FEE_CENTS) / 100,
  };
}

/**
 * Balance check for one withdrawal. Fee is always 0.80 and ignores any client fee.
 * openWithdrawalCount is other in-flight requests. existingByKey short-circuits retries.
 */
export function assessWithdrawalRequest({
  amount,
  exchangeRate = 1,
  withdrawable = 0,
  openWithdrawalCount = 0,
  idempotencyKey = "",
  existingByKey = null,
} = {}) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(key)) {
    return { ok: false, status: 400, message: "缺少提现幂等标识，请刷新页面后重新提交" };
  }
  if (existingByKey) {
    return { ok: true, duplicate: true, idempotencyKey: key };
  }
  const quote = quoteWithdrawal({ amount, exchangeRate });
  if (!quote.ok) return quote;
  if (Number(openWithdrawalCount) > 0) {
    return { ok: false, status: 400, message: "已有待处理的提现申请，请等待处理后再提交" };
  }
  const availableCents = Math.round(Number(withdrawable) * 100);
  if (!Number.isFinite(availableCents) || quote.grossCents > availableCents) {
    return { ok: false, status: 400, message: "可提现余额不足" };
  }
  return { ok: true, duplicate: false, idempotencyKey: key, ...quote };
}
