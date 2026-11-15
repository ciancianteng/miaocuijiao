/**
 * Same withdrawable math as companion earnings center (summaryFrom).
 * Read-only. Does not write balances or withdrawals.
 *
 * 可提现 = 已解锁订单净收入 + 礼物 + 邀请 − 提现中 − 已打款/已完成提现
 * 待结算 = 已入账但尚未解锁的订单收入（收益中心「订单24h锁定」）
 * 提现中 = 未终态提现申请（不含已驳回/已取消）
 * 已提现 = status=completed
 */
import { money, partitionCompanionIncome } from "./_companion-income.js";
import { splitCompanionIncomeByWithdrawLock } from "./_earnings-windows.js";
import { PAYOUT_FROZEN_STATUSES } from "./_weekly-settlement.js";

const WITHDRAW_RELEASED = new Set(["rejected", "cancelled", "canceled", "pay_failed", "failed"]);
const WITHDRAW_ACTIVE = new Set(
  [...PAYOUT_FROZEN_STATUSES, "completed", "paid"].filter((status) => !WITHDRAW_RELEASED.has(status))
);

function roundMoney(n) {
  return Math.round(money(n) * 100) / 100;
}

export function companionWalletBalances({
  transactions = [],
  withdrawals = [],
  orders = [],
  nowMs = Date.now(),
} = {}) {
  const { orderIncome, giftIncome, inviteIncome, orderMap } = partitionCompanionIncome(transactions, orders);
  const orderIncomeIds = new Set(orderIncome.map((r) => String(r.order_id || "")).filter(Boolean));
  const refundRows = (transactions || []).filter((row) => {
    if (row.transaction_type !== "refund" || row.status === "cancelled") return false;
    const oid = row.order_id ? String(row.order_id) : "";
    if (!oid) return true;
    return orderIncomeIds.has(oid);
  });
  const frozen = (withdrawals || [])
    .filter((w) => PAYOUT_FROZEN_STATUSES.has(w.status) && !WITHDRAW_RELEASED.has(w.status))
    .reduce((n, w) => n + money(w.cat_food_amount || w.amount), 0);
  const withdrawn = (withdrawals || [])
    .filter((w) => w.status === "completed")
    .reduce((n, w) => n + money(w.cat_food_amount || w.amount), 0);
  const locked = (withdrawals || [])
    .filter((w) => WITHDRAW_ACTIVE.has(w.status))
    .reduce((n, w) => n + money(w.cat_food_amount || w.amount), 0);
  const orderGross = orderIncome.reduce((n, row) => n + money(row.amount), 0);
  const giftGross = (giftIncome || []).reduce((n, row) => n + money(row.amount), 0);
  const inviteGross = (inviteIncome || []).reduce((n, row) => n + money(row.amount), 0);
  const refundTotal = refundRows.reduce((n, row) => n + money(row.amount), 0);
  const orderNet = Math.max(0, roundMoney(orderGross - refundTotal));
  const withdrawableBase = Math.max(0, roundMoney(orderNet + giftGross + inviteGross));
  let earningsLocked = 0;
  try {
    const { locked: lockedRows } = splitCompanionIncomeByWithdrawLock(orderIncome, orderMap, nowMs);
    const lockedGross = lockedRows.reduce((n, row) => n + money(row.amount), 0);
    const lockedOrderIds = new Set(lockedRows.map((r) => String(r.order_id || "")).filter(Boolean));
    const lockedRefund = refundRows
      .filter((r) => lockedOrderIds.has(String(r.order_id || "")))
      .reduce((n, r) => n + money(r.amount), 0);
    earningsLocked = Math.max(0, roundMoney(lockedGross - lockedRefund));
  } catch {
    earningsLocked = 0;
  }
  const withdrawable = Math.max(0, roundMoney(withdrawableBase - earningsLocked - locked));
  return {
    withdrawable,
    earningsLocked,
    frozen: roundMoney(frozen),
    withdrawn: roundMoney(withdrawn),
    lockedWithdrawals: roundMoney(locked),
    withdrawableBase,
    orderNet,
    giftGross: roundMoney(giftGross),
    inviteGross: roundMoney(inviteGross),
  };
}
