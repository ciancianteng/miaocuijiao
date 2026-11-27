/**
 * CS proxy create-time charge helpers.
 * Debit boss wallet at create (not CS wallet); companion accept must skip via paid_at.
 */
import { debitWallet, creditWallet, getWallet, viewWallet } from "./_wallet.js";

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function normalizeProxyHours(rawHours, pricingUnit = "小时") {
  const unit = String(pricingUnit || "小时");
  const hourly = /小时|hour|hr/i.test(unit) && !/局|单次|每单|每局|场/.test(unit);
  const raw = money(rawHours);
  if (hourly) {
    const h = Math.max(1, Math.round(raw || 1));
    return { hours: h, quantity: h, billingMode: "hourly", pricingUnit: unit || "小时" };
  }
  const qty = Math.max(1, Math.round(raw || 1));
  return { hours: qty, quantity: qty, billingMode: "unit", pricingUnit: unit || "单位" };
}

export async function readBossWalletForCs(bossId) {
  const row = await getWallet(bossId);
  const w = viewWallet(row, bossId);
  return {
    bossId,
    availableBalance: money(w.availableBalance),
    heldBalance: money(w.heldBalance),
    totalBalance: money(w.totalBalance),
    paidBalance: money(w.paidBalance),
    bonusBalance: money(w.bonusBalance),
    frozen: !!w.frozen,
    totalSpent: money(w.totalSpent),
    totalRechargeRm: money(w.totalRechargeRm),
  };
}

/**
 * Debit boss then caller inserts order. On insert failure, credit back.
 * Idempotency key must be stable per create attempt.
 */
export async function debitBossForProxyCreate({
  bossId,
  amount,
  orderNo,
  orderId,
  operatorId,
  idempotencyKey,
}) {
  const amt = money(amount);
  if (!(amt > 0)) {
    const err = new Error("订单金额无效");
    err.code = "INVALID_AMOUNT";
    err.status = 400;
    throw err;
  }
  const wallet = await readBossWalletForCs(bossId);
  if (wallet.frozen) {
    const err = new Error("老板钱包已冻结，无法代下单扣款。");
    err.code = "WALLET_FROZEN";
    err.status = 400;
    throw err;
  }
  if (wallet.availableBalance + 0.001 < amt) {
    const err = new Error(
      `老板可用猫粮不足（可用 ${wallet.availableBalance.toFixed(2)}，需要 ${amt.toFixed(2)}）。`
    );
    err.code = "INSUFFICIENT_BALANCE";
    err.status = 400;
    throw err;
  }
  const key = String(idempotencyKey || `cs-proxy-create:${orderNo || orderId || bossId}:${amt}`).trim();
  try {
    await debitWallet({
      bossId,
      amount: amt,
      transactionType: "order_payment",
      idempotencyKey: key,
      reason: `客服代下单扣款 ${orderNo || orderId || ""}`.trim(),
      relatedOrderId: orderId || null,
      operatorId: operatorId || null,
      internalNote: "cs proxy charge on create",
    });
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (/不足|insufficient|balance/i.test(msg)) {
      const err = new Error("老板可用猫粮不足，无法代下单。");
      err.code = "INSUFFICIENT_BALANCE";
      err.status = 400;
      throw err;
    }
    if (/frozen|冻结/i.test(msg)) {
      const err = new Error("老板钱包已冻结，无法代下单扣款。");
      err.code = "WALLET_FROZEN";
      err.status = 400;
      throw err;
    }
    if (/idempotency|duplicate|already exists|23505/i.test(msg)) {
      return { ok: true, duplicate: true, amount: amt, idempotencyKey: key, walletBefore: wallet };
    }
    throw e;
  }
  return { ok: true, charged: true, amount: amt, idempotencyKey: key, walletBefore: wallet };
}

export async function refundProxyCreateDebit({
  bossId,
  amount,
  orderNo,
  orderId,
  operatorId,
  createIdempotencyKey,
}) {
  const amt = money(amount);
  if (!(amt > 0) || !bossId) return { ok: false, skipped: true };
  const key = `cs-proxy-create-rollback:${createIdempotencyKey || orderNo || orderId}`;
  try {
    await creditWallet({
      bossId,
      amount: amt,
      balanceType: "paid",
      transactionType: "order_refund",
      idempotencyKey: key,
      reason: `客服代下单失败回滚 ${orderNo || orderId || ""}`.trim(),
      relatedOrderId: orderId || null,
      operatorId: operatorId || null,
      internalNote: "rollback cs proxy create debit",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
