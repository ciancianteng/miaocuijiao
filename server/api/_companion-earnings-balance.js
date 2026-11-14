/**
 * Companion earnings-center balance (read-only).
 *
 * Same buckets as server/api/companion.js summaryFrom / 收益中心:
 * - withdrawable: 当前可提现
 * - earningsLocked: 订单24h锁定（已入账、尚未计入可提现）
 * - withdrawing: 提现中（冻结中的申请，含待打款）
 * - withdrawn: status=completed 的已打款猫粮
 *
 * There is no independent pending_settlement column. pendingSettlement in the
 * companion payload is an alias of the withdrawal freeze and must not be summed
 * again. This module never derives balances from GMV or platform profit.
 */
import { partitionCompanionIncome, sumTxAmount } from "./_companion-income.js";
import { splitCompanionIncomeByWithdrawLock } from "./_earnings-windows.js";
import { PAYOUT_FROZEN_STATUSES } from "./_weekly-settlement.js";

const WITHDRAW_RELEASED = new Set(["rejected", "cancelled", "canceled", "pay_failed", "failed"]);
const WITHDRAW_FROZEN = PAYOUT_FROZEN_STATUSES;
const WITHDRAW_ACTIVE = new Set(
  [...WITHDRAW_FROZEN, "completed", "paid"].filter((status) => !WITHDRAW_RELEASED.has(status))
);

export function balanceMoney(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function roundBalance(value) {
  return Math.round(balanceMoney(value) * 100) / 100;
}

/**
 * @param {{ transactions?: object[], withdrawals?: object[], orders?: object[], nowMs?: number }} input
 */
export function companionEarningsBalance({
  transactions = [],
  withdrawals = [],
  orders = [],
  nowMs = Date.now(),
} = {}) {
  const { orderIncome, giftIncome, inviteIncome, rewardOther, orderMap } = partitionCompanionIncome(
    transactions,
    orders
  );
  const incomeRows = orderIncome;
  const giftRows = giftIncome || [];
  const inviteRows = inviteIncome || [];
  const orderIncomeIds = new Set(incomeRows.map((r) => String(r.order_id || "")).filter(Boolean));
  const refundRows = (transactions || []).filter((row) => {
    if (row.transaction_type !== "refund" || row.status === "cancelled") return false;
    const oid = row.order_id ? String(row.order_id) : "";
    if (!oid) return true;
    return orderIncomeIds.has(oid);
  });
  const withdrawing = (withdrawals || [])
    .filter((w) => WITHDRAW_FROZEN.has(w.status) && !WITHDRAW_RELEASED.has(w.status))
    .reduce((n, w) => n + balanceMoney(w.cat_food_amount || w.amount), 0);
  const withdrawn = (withdrawals || [])
    .filter((w) => w.status === "completed")
    .reduce((n, w) => n + balanceMoney(w.cat_food_amount || w.amount), 0);
  const locked = (withdrawals || [])
    .filter((w) => WITHDRAW_ACTIVE.has(w.status))
    .reduce((n, w) => n + balanceMoney(w.cat_food_amount || w.amount), 0);
  const orderGross = incomeRows.reduce((n, row) => n + balanceMoney(row.amount), 0);
  const giftGross = giftRows.reduce((n, row) => n + balanceMoney(row.amount), 0);
  const inviteGross = inviteRows.reduce((n, row) => n + balanceMoney(row.amount), 0);
  const refundTotal = refundRows.reduce((n, row) => n + balanceMoney(row.amount), 0);
  const orderNet = Math.max(0, roundBalance(orderGross - refundTotal));
  const withdrawableBase = Math.max(0, roundBalance(orderNet + giftGross + inviteGross));
  const bonus = sumTxAmount(rewardOther);

  let earningsLocked = 0;
  try {
    const { locked: lockedRows } = splitCompanionIncomeByWithdrawLock(incomeRows, orderMap, nowMs);
    const lockedGross = lockedRows.reduce((n, row) => n + balanceMoney(row.amount), 0);
    const lockedOrderIds = new Set(lockedRows.map((r) => String(r.order_id || "")).filter(Boolean));
    const lockedRefund = refundRows
      .filter((r) => lockedOrderIds.has(String(r.order_id || "")))
      .reduce((n, r) => n + balanceMoney(r.amount), 0);
    earningsLocked = Math.max(0, roundBalance(lockedGross - lockedRefund));
  } catch {
    earningsLocked = 0;
  }

  const withdrawable = Math.max(0, roundBalance(withdrawableBase - earningsLocked - locked));
  return {
    withdrawable: roundBalance(withdrawable),
    earningsLocked: roundBalance(earningsLocked),
    pendingSettlement: roundBalance(earningsLocked),
    withdrawing: roundBalance(withdrawing),
    withdrawn: roundBalance(withdrawn),
    withdrawalLocked: roundBalance(locked),
    withdrawableBase: roundBalance(withdrawableBase),
    orderNet: roundBalance(orderNet),
    giftGross: roundBalance(giftGross),
    inviteGross: roundBalance(inviteGross),
    bonus: roundBalance(bonus),
  };
}

export function emptyBalanceTotals() {
  return {
    withdrawable: 0,
    pendingSettlement: 0,
    withdrawing: 0,
    withdrawn: 0,
    companions: 0,
  };
}

export function addBalanceTotals(totals, row) {
  return {
    withdrawable: roundBalance(totals.withdrawable + balanceMoney(row.withdrawable)),
    pendingSettlement: roundBalance(totals.pendingSettlement + balanceMoney(row.pendingSettlement)),
    withdrawing: roundBalance(totals.withdrawing + balanceMoney(row.withdrawing)),
    withdrawn: roundBalance(totals.withdrawn + balanceMoney(row.withdrawn)),
    companions: (totals.companions || 0) + 1,
  };
}

/**
 * Current balances only. Date filters are ignored — there is no balance snapshot.
 */
export function balanceDatePolicy(query = {}) {
  const keys = ["range", "quick", "start", "end", "from", "to", "date", "startDate", "endDate"];
  const ignoredKeys = keys.filter((key) => {
    const value = query?.[key];
    return value != null && String(value).trim() !== "";
  });
  return {
    scope: "current",
    label: "当前余额",
    snapshot: false,
    dateFilterIgnored: true,
    ignoredKeys,
  };
}
