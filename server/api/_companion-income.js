/**
 * Companion earnings classification & clawback.
 * Order income ≠ gift/reward ≠ cancelled-order leftovers.
 */

const VOID_ORDER_STATUSES = new Set([
  "cancelled",
  "canceled",
  "refunded",
  "refund_requested",
]);

const COMPLETED_ORDER_STATUSES = new Set(["completed"]);

export function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function isSettlementIncomeNote(note = "") {
  return /MCJ_SETTLEMENT:/i.test(String(note || ""));
}

export function isGiftOrRewardNote(note = "") {
  return /打赏|礼物|gift|奖励|reward|tip/i.test(String(note || ""));
}

export function normalizeOrderStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

/**
 * @returns {'order_income'|'reward_other'|'void'}
 */
export function classifyCompanionIncomeTx(tx = {}, order = null) {
  const type = String(tx.transaction_type || tx.typeCode || "");
  if (type !== "companion_income") return "void";
  const txStatus = normalizeOrderStatus(tx.status);
  if (txStatus === "cancelled" || txStatus === "canceled") return "void";

  const note = String(tx.note || "");
  const orderStatus = normalizeOrderStatus(order?.status || order?.orderStatus || "");
  const orderId = tx.order_id || tx.orderId || "";

  // Linked to a voided/refunded order → never count as earnings.
  if (orderId && order && VOID_ORDER_STATUSES.has(orderStatus)) return "void";

  // Explicit gift/tip/reward notes → 奖励/其它 (not order income).
  if (isGiftOrRewardNote(note) && !isSettlementIncomeNote(note)) return "reward_other";

  // Settlement ledger: only valid when order is completed (or unknown order row but settlement note — still require completed if order loaded).
  if (isSettlementIncomeNote(note)) {
    if (orderId && order && !COMPLETED_ORDER_STATUSES.has(orderStatus)) return "void";
    if (orderId && !order) return "void"; // missing order: do not invent withdrawable income
    return "order_income";
  }

  // companion_income with order_id but no settlement marker: treat as order income only if completed.
  if (orderId) {
    if (!order) return "void";
    if (COMPLETED_ORDER_STATUSES.has(orderStatus)) return "order_income";
    if (VOID_ORDER_STATUSES.has(orderStatus)) return "void";
    return "void";
  }

  // No order_id → non-order credit (manual/test/reward).
  return "reward_other";
}

export function buildOrderStatusMap(orders = []) {
  const map = new Map();
  for (const o of orders || []) {
    const id = o?.id || o?.orderId;
    if (!id) continue;
    map.set(String(id), o);
  }
  return map;
}

/**
 * Split companion_income rows into order income vs reward/other, excluding voided.
 */
export function partitionCompanionIncome(transactions = [], orders = []) {
  const orderMap = buildOrderStatusMap(orders);
  const orderIncome = [];
  const rewardOther = [];
  const voided = [];
  for (const tx of transactions || []) {
    if (String(tx.transaction_type || "") !== "companion_income") continue;
    const order = tx.order_id ? orderMap.get(String(tx.order_id)) || null : null;
    const kind = classifyCompanionIncomeTx(tx, order);
    if (kind === "order_income") orderIncome.push(tx);
    else if (kind === "reward_other") rewardOther.push(tx);
    else voided.push({ tx, order, kind });
  }
  return { orderIncome, rewardOther, voided, orderMap };
}

export function sumTxAmount(rows = []) {
  return money(rows.reduce((n, row) => n + money(row.amount), 0));
}

/**
 * Claw back companion_income for an order that was cancelled/refunded after settlement.
 * Marks income txs cancelled and inserts a matching refund row if needed for audit.
 */
export async function clawbackCompanionIncomeForOrder(
  {
    supabaseJson,
    restUrl,
    serviceHeaders,
  },
  order,
  { reason = "订单取消/退款，扣回陪玩收入", mode = "cancel" } = {}
) {
  const orderId = order?.id;
  const companionId = order?.companion_id;
  if (!orderId || !companionId) {
    return { ok: false, skipped: true, reason: "missing_order_or_companion" };
  }

  const existing = await supabaseJson(
    restUrl(
      "transactions",
      `?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(companionId)}&transaction_type=eq.companion_income&status=neq.cancelled&select=id,amount,status,note&limit=20`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);

  const incomeRows = Array.isArray(existing) ? existing : [];
  if (!incomeRows.length) {
    return { ok: true, clawed: 0, message: "no_active_companion_income" };
  }

  let clawed = 0;
  for (const row of incomeRows) {
    const amount = money(row.amount);
    await supabaseJson(restUrl("transactions", `?id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        status: "cancelled",
        note: `${row.note || ""}\n[[CLAWBACK]]${JSON.stringify({
          mode,
          reason,
          clawedAt: new Date().toISOString(),
          orderStatus: order.status || "",
        })}`.slice(0, 1800),
      }),
    });

    // Audit refund row (summaryFrom subtracts refund from gross; cancelled income already excluded).
    const refundExists = await supabaseJson(
      restUrl(
        "transactions",
        `?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(companionId)}&transaction_type=eq.refund&select=id&limit=1`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    if (!Array.isArray(refundExists) || !refundExists.length) {
      await supabaseJson(restUrl("transactions"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          user_id: companionId,
          order_id: orderId,
          transaction_type: "refund",
          amount,
          status: "completed",
          note: `MCJ_CLAWBACK:${JSON.stringify({ mode, reason, sourceIncomeId: row.id })}`,
          created_at: new Date().toISOString(),
        }),
      });
    }
    clawed += amount;
  }

  return { ok: true, clawed: money(clawed), count: incomeRows.length };
}
