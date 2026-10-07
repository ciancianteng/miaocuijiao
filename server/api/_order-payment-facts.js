/**
 * What an order actually captured.
 * Refunds may use only this figure. Order price is not a payment.
 */
import { getWallet, money, restUrl, serviceHeaders, supabaseJson, viewWallet } from "./_wallet.js";

const PAYMENT_DEBIT_TYPES = new Set(["order_payment"]);
const REFUND_CREDIT_TYPES = new Set(["refund", "order_refund"]);

function round(n) {
  return Math.round(money(n) * 100) / 100;
}

async function rows(table, query) {
  try {
    const out = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
    return Array.isArray(out) ? out : [];
  } catch (err) {
    if (/PGRST|schema cache|Could not find|relation/i.test(String(err?.message || err))) return [];
    throw err;
  }
}

export async function loadOrderMoneyFacts(order = {}) {
  const id = String(order.id || "").trim();
  const empty = {
    orderId: id,
    debited: 0,
    manualPaid: 0,
    alreadyRefunded: 0,
    actualPaid: 0,
    refundable: 0,
    hasActiveHold: false,
    holdAmount: 0,
    hasSuccessfulPayment: false,
    debitIds: [],
    refundCreditIds: [],
  };
  if (!id) return empty;

  const [txs, payments, holds] = await Promise.all([
    rows(
      "wallet_transactions",
      `?related_order_id=eq.${encodeURIComponent(id)}&select=id,transaction_type,amount,direction&limit=100`
    ),
    rows(
      "payment_transactions",
      `?order_id=eq.${encodeURIComponent(id)}&payment_status=eq.paid&select=id,payment_status,gross_amount&limit=20`
    ),
    rows(
      "wallet_order_holds",
      `?order_id=eq.${encodeURIComponent(id)}&status=eq.held&select=id,amount,status&limit=5`
    ),
  ]);

  let debited = 0;
  let alreadyRefunded = 0;
  const debitIds = [];
  const refundCreditIds = [];
  for (const tx of txs) {
    const amt = round(tx.amount);
    const type = String(tx.transaction_type || "");
    const dir = String(tx.direction || "");
    if (dir === "debit" && PAYMENT_DEBIT_TYPES.has(type)) {
      debited = round(debited + amt);
      debitIds.push(tx.id);
    } else if (dir === "credit" && REFUND_CREDIT_TYPES.has(type)) {
      alreadyRefunded = round(alreadyRefunded + amt);
      refundCreditIds.push(tx.id);
    }
  }
  let manualPaid = 0;
  for (const p of payments) manualPaid = round(manualPaid + money(p.gross_amount));
  // Wallet debit and an off-wallet proof are alternate rails for the same order, not two payments.
  const actualPaid = debited > 0 ? debited : manualPaid;
  const holdAmount = round((holds || []).reduce((n, h) => n + money(h.amount), 0));
  const refundable = round(Math.max(0, actualPaid - alreadyRefunded));
  return {
    orderId: id,
    debited,
    manualPaid,
    alreadyRefunded,
    actualPaid,
    refundable,
    hasActiveHold: holdAmount > 0,
    holdAmount,
    hasSuccessfulPayment: actualPaid > 0,
    debitIds,
    refundCreditIds,
  };
}

/**
 * Admin/CS proxy orders charge when the companion confirms, not when the order is created.
 * Boss self-pay (hold, proof, test-pay stamp, or an existing debit) is left alone.
 */
export function needsProxyCharge(order = {}, facts = {}) {
  if (!order?.id || order.parent_order_id) return false;
  if (!order.customer_service_id) return false;
  if (facts.refundable > 0) return false;
  if (facts.hasActiveHold) return false;
  // paid_at without a reversed debit is an existing boss/test payment. A fully reversed debit may be charged again.
  const debitWasReversed = facts.debited > 0 && facts.alreadyRefunded + 0.001 >= facts.debited;
  if (order.paid_at && !debitWasReversed) return false;
  return true;
}

export async function chargeProxyOrderOnConfirm(order, { operatorId } = {}) {
  const facts = await loadOrderMoneyFacts(order);
  if (!needsProxyCharge(order, facts)) {
    return { ok: true, skipped: true, amount: 0, facts };
  }
  const amount = round(order.total_amount);
  if (!(amount > 0)) {
    return { ok: false, code: "INVALID_AMOUNT", message: "订单金额无效，付款失败。", facts };
  }
  const wallet = viewWallet(await getWallet(order.boss_id).catch(() => ({})), order.boss_id);
  if (round(wallet.availableBalance) + 0.001 < amount) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: "老板余额不足，付款失败，订单未成立。",
      facts,
    };
  }
  const { debitWallet } = await import("./_wallet.js");
  const baseKey = `order-accept-pay:${order.order_no || order.id}`;
  async function debit(key) {
    return debitWallet({
      bossId: order.boss_id,
      amount,
      transactionType: "order_payment",
      idempotencyKey: key,
      reason: `陪玩确认接单扣款 ${order.order_no || order.id}`,
      relatedOrderId: order.id,
      operatorId: operatorId || null,
      internalNote: "proxy charge on companion confirm",
    });
  }
  try {
    await debit(baseKey);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/不足|insufficient|balance/i.test(msg)) {
      return { ok: false, code: "INSUFFICIENT_BALANCE", message: "老板余额不足，付款失败，订单未成立。", facts };
    }
    if (!/idempotency|duplicate|already exists|23505/i.test(msg)) {
      return { ok: false, code: "PAYMENT_FAILED", message: "付款失败，订单未成立。", facts };
    }
    const after = await loadOrderMoneyFacts(order);
    if (after.refundable + 0.001 >= amount) {
      return { ok: true, charged: false, duplicate: true, amount, facts: after };
    }
    try {
      await debit(`${baseKey}:retry:${after.alreadyRefunded}`);
    } catch (err2) {
      const msg2 = String(err2?.message || err2 || "");
      if (/不足|insufficient|balance/i.test(msg2)) {
        return { ok: false, code: "INSUFFICIENT_BALANCE", message: "老板余额不足，付款失败，订单未成立。", facts: after };
      }
      if (/idempotency|duplicate|already exists|23505/i.test(msg2)) {
        return { ok: true, charged: false, duplicate: true, amount, facts: after };
      }
      return { ok: false, code: "PAYMENT_FAILED", message: "付款失败，订单未成立。", facts: after };
    }
  }
  return { ok: true, charged: true, amount, facts };
}
