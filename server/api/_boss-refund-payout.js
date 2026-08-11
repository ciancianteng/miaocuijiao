/**
 * Boss refund → 猫粮余额 only (never cash / bank / DuitNow / TNG / original-path).
 * CS suggests approve/reject; admin confirms → creditWallet(transactionType: "refund") idempotently.
 */
import {
  computeSettlementDate,
  mergeWeeklySettings,
  nextSettlementFriday,
  buildBatchCode,
  weekRangeFromFriday,
  isoWeekParts,
} from "./_weekly-settlement.js";
import { syncPayoutRequestStatus, loadFinanceWeeklySettings } from "./_payout-requests.js";

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function nowIso() {
  return new Date().toISOString();
}
function no(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function isMissing(err) {
  const msg = `${err?.message || ""} ${JSON.stringify(err?.body || "")}`;
  return /Could not find the table|relation .* does not exist|PGRST205/i.test(msg);
}

export const REFUND_STATUS_TEXT = {
  pending_review: "待审核",
  approved_for_payout: "待退回猫粮",
  included_in_batch: "待退回猫粮",
  processing: "退款处理中",
  paid: "已退款（猫粮）",
  rejected: "退款未通过",
  failed: "退款失败",
  carried_forward: "待退回猫粮",
  cancelled: "已取消",
};

export function viewBossRefund(row = {}) {
  const amount = money(row.paid_amount_rm != null && row.status === "paid" ? row.paid_amount_rm : row.amount_rm);
  const refundMethod = "meowcoin";
  return {
    id: row.id,
    refundNo: row.refund_no || "",
    orderId: row.order_id || "",
    orderNo: row.order_no || "",
    bossId: row.boss_id || "",
    bossUid: row.boss_uid || "",
    bossName: row.boss_name || "",
    amountRm: amount,
    /** 订单金额按猫粮计；字段名历史遗留 amount_rm，实际为应退猫粮数量 */
    amountCatFood: amount,
    refundMethod,
    refundMethodText: "猫粮余额",
    reason: row.reason || "",
    csSuggest: row.cs_suggest || "",
    csNote: row.cs_note || "",
    assignedCsId: row.assigned_cs_id || "",
    assignedCsName: row.assigned_cs_name || "",
    assignedCsAccount: row.assigned_cs_account || "",
    status: row.status || "pending_review",
    statusText: REFUND_STATUS_TEXT[row.status] || row.status || "-",
    settlementDate: row.settlement_date || "",
    settlementHint: row.status === "paid" ? "已退回猫粮余额" : "审核通过后立即退回猫粮余额（不退现金）",
    batchId: row.batch_id || "",
    bankReference: row.bank_reference || "",
    paidAt: row.paid_at || "",
    paidAmountRm: money(row.paid_amount_rm ?? row.amount_rm),
    paidCatFood: money(row.paid_amount_rm ?? row.amount_rm),
    rejectReason: row.reject_reason || "",
    failReason: row.fail_reason || "",
    canReapply: row.can_reapply !== false,
    receiptPath: row.receipt_path || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    alreadyRefunded: String(row.status || "") === "paid",
  };
}

async function sumOpenOrPaidRefunds(db, orderId, excludeId = "") {
  try {
    const rows = await db(
      "boss_refund_requests",
      `?order_id=eq.${encodeURIComponent(orderId)}&status=neq.rejected&status=neq.cancelled&select=id,amount_rm,status&limit=50`
    );
    return (rows || [])
      .filter((r) => !excludeId || r.id !== excludeId)
      .filter((r) => !/rejected|cancelled/i.test(String(r.status || "")))
      .reduce((n, r) => n + money(r.amount_rm), 0);
  } catch (e) {
    if (isMissing(e)) return 0;
    throw e;
  }
}

export async function createBossRefundRequest(db, {
  order,
  boss,
  amount,
  reason,
  settings,
} = {}) {
  const paid = money(order.paid_cat_food || order.total_amount || order.amount || 0);
  const reqAmount = money(amount != null ? amount : paid);
  if (reqAmount <= 0) {
    return { ok: false, message: "退款金额必须大于 0。" };
  }
  if (reqAmount > paid + 0.001) {
    return { ok: false, message: "退款金额不能超过实际支付金额。" };
  }
  const already = await sumOpenOrPaidRefunds(db, order.id);
  if (already + reqAmount > paid + 0.001) {
    return { ok: false, message: "同一订单累计退款不能超过实付金额。" };
  }
  const weekly = mergeWeeklySettings(settings || (await loadFinanceWeeklySettings(db)));
  const settlementDate = computeSettlementDate(new Date(), weekly);
  const row = {
    refund_no: no("RF"),
    order_id: order.id,
    order_no: order.order_no || order.public_order_no || "",
    boss_id: boss.id || order.boss_id,
    boss_uid: boss.public_uid || boss.boss_uid || boss.uid || "",
    boss_name: boss.display_name || boss.nickname || boss.email || "",
    amount_rm: reqAmount,
    currency: "MYR",
    reason: String(reason || "").trim(),
    status: "pending_review",
    settlement_date: settlementDate,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  try {
    const created = await db("boss_refund_requests", "", {
      method: "POST",
      body: JSON.stringify(row),
    });
    const saved = Array.isArray(created) ? created[0] : created;
    return { ok: true, refund: viewBossRefund(saved), message: "退款申请已提交，待客服/后台审核。审核通过并确认后，退款将退回您的猫粮余额（不退现金）。" };
  } catch (e) {
    if (isMissing(e)) {
      return { ok: false, message: "退款结算表未就绪，请执行 friday_settlement_center migration。" };
    }
    throw e;
  }
}

export async function csSuggestRefund(db, {
  refundId,
  decision,
  note,
  csProfile,
} = {}) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "退款申请不存在。" };
  if (row.status !== "pending_review") {
    return { ok: false, message: "仅待审核状态可提交建议。" };
  }
  const suggest = decision === "approve" || decision === "reject" ? decision : "";
  if (!suggest) return { ok: false, message: "请选择建议批准或建议驳回。" };
  if (!String(note || "").trim()) return { ok: false, message: "必须填写备注。" };

  if (suggest === "reject") {
    const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "rejected",
        cs_suggest: "reject",
        cs_note: String(note).trim(),
        reject_reason: String(note).trim(),
        assigned_cs_id: csProfile.id,
        assigned_cs_name: csProfile.display_name || csProfile.nickname || "",
        assigned_cs_account: csProfile.email || csProfile.account || "",
        reviewed_at: nowIso(),
        reviewed_by: csProfile.id,
        updated_at: nowIso(),
      }),
    });
    return { ok: true, message: "已驳回退款申请。", refund: viewBossRefund(patched?.[0] || patched) };
  }

  // approve → 待后台确认退回猫粮（不再进入银行打款队列）
  const patch = {
    status: "approved_for_payout",
    cs_suggest: "approve",
    cs_note: String(note).trim(),
    assigned_cs_id: csProfile.id,
    assigned_cs_name: csProfile.display_name || csProfile.nickname || "",
    assigned_cs_account: csProfile.email || csProfile.account || "",
    reviewed_at: nowIso(),
    reviewed_by: csProfile.id,
    updated_at: nowIso(),
  };
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const saved = patched?.[0] || { ...row, ...patch };

  return {
    ok: true,
    message: "已建议批准。退款方式固定为猫粮余额，请后台点击「确认退款猫粮」后立即入账（不退现金）。",
    refund: viewBossRefund(saved),
  };
}

/**
 * P0：确认退款猫粮 — 真实 creditWallet + 幂等 + 更新订单。
 * 禁止现金/银行/原路退款。
 */
export async function confirmBossCatFoodRefund(db, {
  refundId,
  amount,
  adminId,
  adminName,
  reason,
} = {}) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "退款记录不存在" };

  if (String(row.status || "") === "paid") {
    let wallet = null;
    try {
      const walletApi = await import("./_wallet.js");
      wallet = await walletApi.getWallet(row.boss_id);
    } catch {
      /* optional */
    }
    return {
      ok: true,
      message: "已退款（幂等，未重复入账）",
      refund: viewBossRefund(row),
      duplicate: true,
      alreadyRefunded: true,
      wallet,
    };
  }

  if (/rejected|cancelled/i.test(String(row.status || ""))) {
    return { ok: false, message: "已驳回/取消的退款不可确认。" };
  }

  const creditAmount = money(amount != null ? amount : row.amount_rm);
  if (creditAmount <= 0) {
    return { ok: false, message: "退款猫粮必须大于 0。" };
  }
  if (!row.boss_id) {
    return { ok: false, message: "退款记录缺少老板 ID，无法入账。" };
  }

  const idempotencyKey = `refund-meow:${row.id}`;
  const walletApi = await import("./_wallet.js");
  let creditResult;
  try {
    creditResult = await walletApi.creditWallet({
      bossId: row.boss_id,
      transactionType: "refund",
      amount: creditAmount,
      balanceType: "paid",
      idempotencyKey,
      reason: String(reason || row.cs_note || row.reason || "订单退款退回猫粮").slice(0, 240),
      internalNote: `confirmBossCatFoodRefund by ${adminName || adminId || "admin"}`,
      relatedOrderId: row.order_id || null,
      operatorId: adminId || null,
    });
  } catch (e) {
    return { ok: false, message: `猫粮入账失败：${e?.message || e}` };
  }

  const duplicateCredit = !!(creditResult && (creditResult.duplicate === true || creditResult.ok === true && creditResult.duplicate));

  const patch = {
    status: "paid",
    paid_amount_rm: creditAmount,
    paid_at: nowIso(),
    paid_by: adminId || null,
    bank_reference: "MEOW_WALLET",
    receipt_bucket: "",
    receipt_path: "meowcoin-wallet",
    fail_reason: "",
    updated_at: nowIso(),
  };
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const saved = patched?.[0] || { ...row, ...patch };

  // Cancel any legacy Friday payout queue rows (cash path retired).
  try {
    await syncPayoutRequestStatus(db, {
      relatedTable: "boss_refund_requests",
      relatedRecordId: refundId,
      status: "completed",
      patch: {
        paid_at: patch.paid_at,
        paid_by: adminId || null,
        transaction_no: "MEOW_WALLET",
        receipt_url: "meowcoin-wallet",
        meta: { refund_method: "meowcoin", cash_refund: false },
      },
    });
  } catch {
    /* optional */
  }

  if (saved.order_id) {
    // orders 表无 refund_amount / updated_at 列；只写 status，避免 PATCH 静默失败导致仍为售后中。
    try {
      await db("orders", `?id=eq.${encodeURIComponent(saved.order_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "refunded" }),
      });
    } catch (e) {
      console.warn("[refund-meow] order status:", e?.message || e);
      try {
        const walletApiForOrder = await import("./_wallet.js");
        await walletApiForOrder.supabaseJson(
          walletApiForOrder.restUrl("orders", `?id=eq.${encodeURIComponent(saved.order_id)}`),
          {
            method: "PATCH",
            headers: walletApiForOrder.serviceHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({ status: "refunded" }),
          }
        );
      } catch (e2) {
        console.warn("[refund-meow] order status fallback:", e2?.message || e2);
      }
    }
    try {
      const txs = await db(
        "payment_transactions",
        `?order_id=eq.${encodeURIComponent(saved.order_id)}&select=id,gross_amount,refunded_amount,net_amount&limit=1`
      );
      const tx = txs?.[0];
      if (tx?.id) {
        const refunded = Math.min(money(tx.gross_amount), money(tx.refunded_amount) + creditAmount);
        const net = Math.max(0, money(tx.gross_amount) - refunded);
        await db("payment_transactions", `?id=eq.${encodeURIComponent(tx.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ refunded_amount: refunded, net_amount: net }),
        });
      }
    } catch (e) {
      console.warn("[refund-meow] payment_transactions:", e?.message || e);
    }
  }

  if (saved.batch_id || row.batch_id) {
    try {
      await refreshBatchTotals(db, saved.batch_id || row.batch_id);
    } catch {
      /* optional */
    }
  }

  let wallet = creditResult?.wallet || null;
  try {
    wallet = (await walletApi.getWallet(row.boss_id)) || wallet;
  } catch {
    /* optional */
  }

  try {
    await walletApi.notifyBoss(
      saved.boss_id,
      "退款成功",
      `订单 ${saved.order_no || ""} 已退回 ${creditAmount} 猫粮到您的平台余额，可继续用于平台消费，不支持提现或现金退款。`,
      "refund",
      saved.id
    );
  } catch {
    /* optional */
  }

  return {
    ok: true,
    message: duplicateCredit
      ? "已退款（幂等，未重复入账）"
      : `已确认退回 ${creditAmount} 猫粮到老板账户`,
    refund: viewBossRefund(saved),
    duplicate: !!duplicateCredit,
    alreadyRefunded: !!duplicateCredit,
    wallet,
    creditedCatFood: creditAmount,
    adminName: adminName || "",
  };
}

/** @deprecated Use confirmBossCatFoodRefund — cash/bank path removed. */
export async function completeBossRefundPayout(db, params = {}) {
  return confirmBossCatFoodRefund(db, {
    refundId: params.refundId,
    amount: params.paidAmount != null ? params.paidAmount : params.amount,
    adminId: params.adminId,
    adminName: params.adminName,
    reason: params.reason || params.bankReference || "订单退款退回猫粮",
  });
}

export async function ensureSettlementBatch(db, settlementFriday) {
  const friday = String(settlementFriday || "").slice(0, 10);
  const code = buildBatchCode(friday);
  const { weekYear, weekNumber } = isoWeekParts(friday);
  const { weekStart, weekEnd } = weekRangeFromFriday(friday);
  try {
    const existing = await db("settlement_batches", `?batch_code=eq.${encodeURIComponent(code)}&limit=1`);
    if (existing?.[0]) return existing[0];
    const created = await db("settlement_batches", "", {
      method: "POST",
      body: JSON.stringify({
        batch_code: code,
        week_year: weekYear,
        week_number: weekNumber,
        week_start: weekStart,
        week_end: weekEnd,
        status: "open",
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    return Array.isArray(created) ? created[0] : created;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export async function refreshBatchTotals(db, batchId) {
  if (!batchId) return null;
  try {
    const [refunds, withdrawals, payrolls] = await Promise.all([
      db("boss_refund_requests", `?batch_id=eq.${encodeURIComponent(batchId)}&select=id,amount_rm,paid_amount_rm,status&limit=2000`).catch(() => []),
      db("companion_withdrawals", `?batch_id=eq.${encodeURIComponent(batchId)}&select=id,net_amount_rm,status&limit=2000`).catch(() => []),
      db("staff_payrolls", `?batch_id=eq.${encodeURIComponent(batchId)}&select=id,net_salary_rm,status&limit=2000`).catch(() => []),
    ]);
    const refundRows = refunds || [];
    const wdRows = withdrawals || [];
    const payRows = payrolls || [];
    const refundTotal = refundRows.reduce((n, r) => n + money(r.amount_rm), 0);
    const companionTotal = wdRows.reduce((n, r) => n + money(r.net_amount_rm), 0);
    const csTotal = payRows.reduce((n, r) => n + money(r.net_salary_rm), 0);
    const all = [
      ...refundRows.map((r) => ({ status: r.status, paid: money(r.paid_amount_rm || r.amount_rm), amount: money(r.amount_rm) })),
      ...wdRows.map((r) => ({ status: r.status, paid: money(r.net_amount_rm), amount: money(r.net_amount_rm) })),
      ...payRows.map((r) => ({ status: r.status, paid: money(r.net_salary_rm), amount: money(r.net_salary_rm) })),
    ];
    const paidItems = all.filter((r) => /^(paid|completed)$/i.test(String(r.status)));
    const failedItems = all.filter((r) => /failed|pay_failed/i.test(String(r.status)));
    const pendingItems = all.filter((r) => !/^(paid|completed|rejected|cancelled)$/i.test(String(r.status)));
    const patch = {
      refund_total_rm: refundTotal,
      companion_wage_total_rm: companionTotal,
      cs_wage_total_rm: csTotal,
      total_count: all.length,
      paid_count: paidItems.length,
      failed_count: failedItems.length,
      pending_amount_rm: pendingItems.reduce((n, r) => n + money(r.amount), 0),
      paid_amount_rm: paidItems.reduce((n, r) => n + money(r.paid), 0),
      updated_at: nowIso(),
    };
    const updated = await db("settlement_batches", `?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return updated?.[0] || { id: batchId, ...patch };
  } catch (e) {
    if (isMissing(e)) return null;
    console.warn("[friday-batch] refreshBatchTotals:", e?.message || e);
    return null;
  }
}

export async function addRefundToBatch(db, refundId) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (!/approved_for_payout|carried_forward|failed/i.test(String(row.status))) {
    return { ok: false, message: "仅待周五退款/顺延/失败记录可加入批次。" };
  }
  if (row.batch_id) {
    await refreshBatchTotals(db, row.batch_id);
    return { ok: true, message: "已在批次中", refund: viewBossRefund(row), duplicate: true };
  }
  const batch = await ensureSettlementBatch(db, row.settlement_date);
  if (!batch?.id) return { ok: false, message: "无法创建结算批次" };
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "included_in_batch",
      batch_id: batch.id,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: "boss_refund_requests",
    relatedRecordId: refundId,
    status: "pending_payment",
    patch: { batch_id: batch.id, payout_type: "boss_refund" },
  });
  const refreshed = await refreshBatchTotals(db, batch.id);
  return {
    ok: true,
    message: "已加入本周批次",
    batch: refreshed || batch,
    refund: viewBossRefund(patched?.[0] || { ...row, status: "included_in_batch", batch_id: batch.id }),
  };
}

export async function rolloverRefundToNextWeek(db, refundId, reason = "周五未完成打款，顺延下周") {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (/paid|rejected|cancelled/i.test(String(row.status))) {
    return { ok: false, message: "已完成/驳回记录不可顺延。" };
  }
  const prevBatchId = row.batch_id || null;
  const next = nextSettlementFriday(row.settlement_date || computeSettlementDate(new Date(), {}));
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "carried_forward",
      settlement_date: next,
      batch_id: null,
      fail_reason: reason,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: "boss_refund_requests",
    relatedRecordId: refundId,
    status: "rolled_over",
    patch: { settlement_date: next, batch_id: null },
  });
  if (prevBatchId) await refreshBatchTotals(db, prevBatchId);
  return { ok: true, refund: viewBossRefund(patched?.[0]), message: `已顺延至 ${next}` };
}

export async function markRefundProcessing(db, refundId) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (!/approved_for_payout|included_in_batch|carried_forward|failed/i.test(String(row.status))) {
    return { ok: false, message: "当前状态不可标记处理中" };
  }
  let batchId = row.batch_id;
  if (!batchId) {
    const batch = await ensureSettlementBatch(db, row.settlement_date);
    batchId = batch?.id || null;
  }
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "processing",
      batch_id: batchId,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: "boss_refund_requests",
    relatedRecordId: refundId,
    status: "processing",
    patch: batchId ? { batch_id: batchId } : {},
  });
  if (batchId) await refreshBatchTotals(db, batchId);
  return { ok: true, message: "已标记处理中", refund: viewBossRefund(patched?.[0] || { ...row, status: "processing" }) };
}

export async function markRefundFailed(db, refundId, reason = "打款失败") {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (/paid|rejected|cancelled/i.test(String(row.status))) {
    return { ok: false, message: "已完成/驳回记录不可标记失败" };
  }
  const note = String(reason || "打款失败").trim() || "打款失败";
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "failed",
      fail_reason: note,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: "boss_refund_requests",
    relatedRecordId: refundId,
    status: "failed",
    patch: { fail_reason: note },
  });
  if (row.batch_id) await refreshBatchTotals(db, row.batch_id);
  try {
    const { notifyBoss } = await import("./_wallet.js");
    await notifyBoss(
      row.boss_id,
      "退款打款失败",
      `订单 ${row.order_no || ""} 退款打款失败：${note}。可联系客服或等待重新入队。`,
      "refund",
      row.id
    );
  } catch {
    /* optional */
  }
  return { ok: true, message: "已标记打款失败", refund: viewBossRefund(patched?.[0] || { ...row, status: "failed" }) };
}

const WAGE_TABLE = {
  companion_wage: {
    table: "companion_withdrawals",
    amountCol: "net_amount_rm",
    open: /pending_friday|submitted|reviewing|approved|pending_payment|rolled_over|failed/i,
    payoutType: "companion_wage",
  },
  cs_wage: {
    table: "staff_payrolls",
    amountCol: "net_salary_rm",
    open: /pending_friday|submitted|reviewing|approved|pending_payment|rolled_over|failed|draft|pending_review/i,
    payoutType: "cs_wage",
  },
};

export async function addWageToBatch(db, { kind, id } = {}) {
  const cfg = WAGE_TABLE[kind === "cs_wage" || kind === "payroll" ? "cs_wage" : "companion_wage"];
  const rows = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (!cfg.open.test(String(row.status || ""))) {
    return { ok: false, message: "当前状态不可加入本周批次" };
  }
  if (row.batch_id) {
    await refreshBatchTotals(db, row.batch_id);
    return { ok: true, message: "已在批次中", item: row, duplicate: true };
  }
  const settlementDate = row.settlement_date || computeSettlementDate(new Date(), {});
  const batch = await ensureSettlementBatch(db, settlementDate);
  if (!batch?.id) return { ok: false, message: "无法创建结算批次" };
  const patched = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "pending_payment",
      batch_id: batch.id,
      settlement_date: settlementDate,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: cfg.table,
    relatedRecordId: id,
    status: "pending_payment",
    patch: { batch_id: batch.id, payout_type: cfg.payoutType },
  });
  const refreshed = await refreshBatchTotals(db, batch.id);
  return {
    ok: true,
    message: "已加入本周批次",
    batch: refreshed || batch,
    item: patched?.[0] || { ...row, batch_id: batch.id, status: "pending_payment" },
  };
}

export async function rolloverWageToNextWeek(db, { kind, id, reason = "周五未完成打款，顺延下周" } = {}) {
  const cfg = WAGE_TABLE[kind === "cs_wage" || kind === "payroll" ? "cs_wage" : "companion_wage"];
  const rows = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (/paid|completed|rejected|cancelled/i.test(String(row.status || ""))) {
    return { ok: false, message: "已完成/驳回记录不可顺延" };
  }
  const prevBatchId = row.batch_id || null;
  const next = nextSettlementFriday(row.settlement_date || computeSettlementDate(new Date(), {}));
  const patched = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "rolled_over",
      settlement_date: next,
      batch_id: null,
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: cfg.table,
    relatedRecordId: id,
    status: "rolled_over",
    patch: { settlement_date: next, batch_id: null },
  });
  if (prevBatchId) await refreshBatchTotals(db, prevBatchId);
  return { ok: true, message: `已顺延至 ${next}`, item: patched?.[0] || row, reason };
}

export async function markWageFailed(db, { kind, id, reason = "打款失败" } = {}) {
  const cfg = WAGE_TABLE[kind === "cs_wage" || kind === "payroll" ? "cs_wage" : "companion_wage"];
  const rows = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (/paid|completed|rejected|cancelled/i.test(String(row.status || ""))) {
    return { ok: false, message: "已完成/驳回记录不可标记失败" };
  }
  const note = String(reason || "打款失败").trim() || "打款失败";
  const patched = await db(cfg.table, `?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "failed",
      updated_at: nowIso(),
    }),
  });
  await syncPayoutRequestStatus(db, {
    relatedTable: cfg.table,
    relatedRecordId: id,
    status: "failed",
    patch: { fail_reason: note },
  });
  if (row.batch_id) await refreshBatchTotals(db, row.batch_id);
  return { ok: true, message: "已标记打款失败", item: patched?.[0] || { ...row, status: "failed" }, reason: note };
}

export async function listBossRefunds(db, { bossId, status, limit = 100 } = {}) {
  try {
    let q = `?order=created_at.desc&limit=${Number(limit) || 100}`;
    if (bossId && status) {
      q = `?boss_id=eq.${encodeURIComponent(bossId)}&status=eq.${encodeURIComponent(status)}&order=created_at.desc&limit=${Number(limit) || 100}`;
    } else if (bossId) {
      q = `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=${Number(limit) || 100}`;
    } else if (status) {
      q = `?status=eq.${encodeURIComponent(status)}&order=created_at.desc&limit=${Number(limit) || 100}`;
    }
    const rows = await db("boss_refund_requests", q);
    return (rows || []).map(viewBossRefund);
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

export async function getCurrentBatchPanel(db, settlementFriday) {
  const friday = String(settlementFriday || computeSettlementDate(new Date(), {})).slice(0, 10);
  const batch = await ensureSettlementBatch(db, friday);
  if (!batch?.id) return null;
  const refreshed = (await refreshBatchTotals(db, batch.id)) || batch;
  return {
    id: refreshed.id || batch.id,
    batchCode: refreshed.batch_code || batch.batch_code || buildBatchCode(friday),
    weekStart: refreshed.week_start || batch.week_start,
    weekEnd: refreshed.week_end || batch.week_end,
    status: refreshed.status || batch.status,
    refundTotalRm: money(refreshed.refund_total_rm),
    companionWageTotalRm: money(refreshed.companion_wage_total_rm),
    csWageTotalRm: money(refreshed.cs_wage_total_rm),
    totalCount: Number(refreshed.total_count || 0),
    paidCount: Number(refreshed.paid_count || 0),
    failedCount: Number(refreshed.failed_count || 0),
    pendingAmountRm: money(refreshed.pending_amount_rm),
    paidAmountRm: money(refreshed.paid_amount_rm),
  };
}
