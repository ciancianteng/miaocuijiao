/**
 * Companion earnings classification & clawback.
 * Order income ≠ gift net ≠ invite ≠ reward/other ≠ cancelled-order leftovers.
 *
 * Owner lock (§10–12):
 *   - gift_income is a separate channel and IS withdrawable (source=gift)
 *   - never merge gift into order_income
 *   - reward_other stays non-withdrawable (manual/test rewards)
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

/** Explicit gift / tip settlement (catfood or approved external). */
export function isGiftIncomeNote(note = "") {
  const n = String(note || "");
  if (/MCJ_GIFT:/i.test(n)) return true;
  // Prefer explicit gift/tip income wording; avoid bare "reward".
  return /礼物收益|礼物\/打赏|打赏收入|gift\s*income|tip\s*income/i.test(n) || /礼物|打赏|^tip$|kind=gift/i.test(n);
}

export function isInviteIncomeNote(note = "") {
  const n = String(note || "");
  if (/MCJ_INVITE:/i.test(n)) return true;
  return /邀请佣金|邀请返点|邀请奖励|invite\s*(cash|commission|reward)/i.test(n);
}

/** Legacy helper: gift OR generic reward wording (used by offline gift tests). */
export function isGiftOrRewardNote(note = "") {
  return isGiftIncomeNote(note) || /奖励|reward/i.test(String(note || ""));
}

export function normalizeOrderStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

/**
 * @returns {'order_income'|'gift_income'|'invite_income'|'reward_other'|'void'}
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

  // Gift / tip (must not become order_income).
  if (isGiftIncomeNote(note) && !isSettlementIncomeNote(note)) return "gift_income";

  // Invite commission (catfood ledger rows if any).
  if (isInviteIncomeNote(note) && !isSettlementIncomeNote(note)) return "invite_income";

  // Explicit non-gift reward wording → reward_other (not withdrawable by default).
  if (/奖励|reward/i.test(note) && !isSettlementIncomeNote(note)) return "reward_other";

  // Settlement ledger: only valid when order is completed.
  if (isSettlementIncomeNote(note)) {
    if (orderId && order && !COMPLETED_ORDER_STATUSES.has(orderStatus)) return "void";
    if (orderId && !order) return "void";
    return "order_income";
  }

  // companion_income with order_id but no settlement marker: treat as order income only if completed.
  if (orderId) {
    if (!order) return "void";
    if (COMPLETED_ORDER_STATUSES.has(orderStatus)) return "order_income";
    if (VOID_ORDER_STATUSES.has(orderStatus)) return "void";
    return "void";
  }

  // No order_id → non-order credit (manual/test).
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
 * Split companion_income rows by channel.
 */
export function partitionCompanionIncome(transactions = [], orders = []) {
  const orderMap = buildOrderStatusMap(orders);
  const orderIncome = [];
  const giftIncome = [];
  const inviteIncome = [];
  const rewardOther = [];
  const voided = [];
  for (const tx of transactions || []) {
    if (String(tx.transaction_type || "") !== "companion_income") continue;
    const order = tx.order_id ? orderMap.get(String(tx.order_id)) || null : null;
    const kind = classifyCompanionIncomeTx(tx, order);
    if (kind === "order_income") orderIncome.push(tx);
    else if (kind === "gift_income") giftIncome.push(tx);
    else if (kind === "invite_income") inviteIncome.push(tx);
    else if (kind === "reward_other") rewardOther.push(tx);
    else voided.push({ tx, order, kind });
  }
  return { orderIncome, giftIncome, inviteIncome, rewardOther, voided, orderMap };
}

export function sumTxAmount(rows = []) {
  return money(rows.reduce((n, row) => n + money(row.amount), 0));
}

/**
 * Claw back companion_income for an order that was cancelled/refunded after settlement.
 * Marks income txs cancelled and inserts a matching refund row if needed for audit.
 * @param {{ amount?: number }} opts - when amount set and < full income, only claw that slice (partial refund).
 */
export async function clawbackCompanionIncomeForOrder(
  {
    supabaseJson,
    restUrl,
    serviceHeaders,
  },
  order,
  { reason = "订单取消/退款，扣回陪玩收入", mode = "cancel", amount = null } = {}
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

  const fullIncome = money(incomeRows.reduce((n, r) => n + money(r.amount), 0));
  const targetClaw =
    amount != null && Number.isFinite(Number(amount)) && money(amount) > 0
      ? Math.min(fullIncome, money(amount))
      : fullIncome;
  if (targetClaw <= 0) {
    return { ok: true, clawed: 0, message: "zero_claw_target" };
  }

  let remaining = targetClaw;
  let clawed = 0;
  for (const row of incomeRows) {
    if (remaining <= 0.0001) break;
    const rowAmt = money(row.amount);
    const take = Math.min(rowAmt, remaining);
    const fullRow = take >= rowAmt - 0.0001;

    if (fullRow) {
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
            clawAmount: take,
          })}`.slice(0, 1800),
        }),
      });
    } else {
      await supabaseJson(restUrl("transactions", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          note: `${row.note || ""}\n[[PARTIAL_CLAWBACK]]${JSON.stringify({
            mode,
            reason,
            clawedAt: new Date().toISOString(),
            clawAmount: take,
          })}`.slice(0, 1800),
        }),
      });
    }

    const refundIdem = `companion-clawback:${orderId}:${row.id}:${take}`;
    const refundExists = await supabaseJson(
      restUrl(
        "transactions",
        `?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(companionId)}&transaction_type=eq.refund&note=like.*${encodeURIComponent(row.id)}*&select=id&limit=5`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    const already = Array.isArray(refundExists)
      ? refundExists.find((r) => String(r.note || "").includes(String(row.id)))
      : null;
    if (!already) {
      await supabaseJson(restUrl("transactions"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          user_id: companionId,
          order_id: orderId,
          transaction_type: "refund",
          amount: take,
          status: "completed",
          note: `MCJ_CLAWBACK:${JSON.stringify({ mode, reason, sourceIncomeId: row.id, clawAmount: take, idem: refundIdem })}`,
          created_at: new Date().toISOString(),
        }),
      }).catch(() => null);
    }
    clawed += take;
    remaining = money(remaining - take);
  }

  return { ok: true, clawed: money(clawed), count: incomeRows.length, target: targetClaw };
}
