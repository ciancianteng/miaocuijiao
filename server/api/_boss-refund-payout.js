/**
 * Boss refund → Friday bank payout queue (NOT instant wallet credit).
 * CS suggests approve/reject; final enqueue creates boss_refund_requests + payout_requests.
 * Admin marks paid with receipt → then credit wallet / update net revenue (idempotent).
 */
import {
  computeSettlementDate,
  formatSettlementHint,
  mergeWeeklySettings,
  nextSettlementFriday,
  buildBatchCode,
  weekRangeFromFriday,
  isoWeekParts,
} from "./_weekly-settlement.js";
import { upsertPayoutRequest, syncPayoutRequestStatus, loadFinanceWeeklySettings } from "./_payout-requests.js";

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
  approved_for_payout: "待周五退款",
  included_in_batch: "已进入本周批次",
  processing: "正在打款",
  paid: "退款已完成",
  rejected: "退款未通过",
  failed: "退款失败",
  carried_forward: "顺延下周",
  cancelled: "已取消",
};

export function viewBossRefund(row = {}) {
  return {
    id: row.id,
    refundNo: row.refund_no || "",
    orderId: row.order_id || "",
    orderNo: row.order_no || "",
    bossId: row.boss_id || "",
    bossUid: row.boss_uid || "",
    bossName: row.boss_name || "",
    amountRm: money(row.amount_rm),
    reason: row.reason || "",
    csSuggest: row.cs_suggest || "",
    csNote: row.cs_note || "",
    assignedCsId: row.assigned_cs_id || "",
    assignedCsName: row.assigned_cs_name || "",
    assignedCsAccount: row.assigned_cs_account || "",
    status: row.status || "pending_review",
    statusText: REFUND_STATUS_TEXT[row.status] || row.status || "-",
    settlementDate: row.settlement_date || "",
    settlementHint: formatSettlementHint(row.settlement_date),
    batchId: row.batch_id || "",
    bankReference: row.bank_reference || "",
    paidAt: row.paid_at || "",
    paidAmountRm: money(row.paid_amount_rm ?? row.amount_rm),
    rejectReason: row.reject_reason || "",
    failReason: row.fail_reason || "",
    canReapply: row.can_reapply !== false,
    receiptPath: row.receipt_path || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
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
    return { ok: true, refund: viewBossRefund(saved), message: "退款申请已提交，待客服审核。预计周五统一处理，不会即时到账。" };
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

  // approve → queue for Friday (no wallet credit yet)
  const weekly = mergeWeeklySettings(await loadFinanceWeeklySettings(db));
  const settlementDate = row.settlement_date || computeSettlementDate(new Date(), weekly);
  const patch = {
    status: "approved_for_payout",
    cs_suggest: "approve",
    cs_note: String(note).trim(),
    assigned_cs_id: csProfile.id,
    assigned_cs_name: csProfile.display_name || csProfile.nickname || "",
    assigned_cs_account: csProfile.email || csProfile.account || "",
    settlement_date: settlementDate,
    reviewed_at: nowIso(),
    reviewed_by: csProfile.id,
    updated_at: nowIso(),
  };
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const saved = patched?.[0] || { ...row, ...patch };

  const payout = await upsertPayoutRequest(db, {
    payoutNo: saved.refund_no || no("PO-RF"),
    applicantType: "boss",
    applicantId: saved.boss_id,
    applicantName: saved.boss_name,
    applicantUid: saved.boss_uid,
    amount: saved.amount_rm,
    currency: "MYR",
    settlementDate,
    status: "pending_friday",
    relatedTable: "boss_refund_requests",
    relatedRecordId: saved.id,
    sourceOrderIds: [saved.order_id],
    meta: {
      payout_type: "boss_refund",
      refund_no: saved.refund_no,
      order_no: saved.order_no,
      cs_id: csProfile.id,
      cs_name: patch.assigned_cs_name,
    },
  });
  if (payout?.id) {
    await db("boss_refund_requests", `?id=eq.${encodeURIComponent(saved.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ payout_request_id: payout.id, updated_at: nowIso() }),
    }).catch(() => null);
  }
  return {
    ok: true,
    message: "已建议批准并进入周五退款队列（不会即时到账）。",
    refund: viewBossRefund({ ...saved, payout_request_id: payout?.id || saved.payout_request_id }),
  };
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

export async function addRefundToBatch(db, refundId) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (!/approved_for_payout|carried_forward|failed/i.test(String(row.status))) {
    return { ok: false, message: "仅待周五退款/顺延/失败记录可加入批次。" };
  }
  if (row.batch_id) return { ok: true, message: "已在批次中", refund: viewBossRefund(row), duplicate: true };
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
  if (row.payout_request_id) {
    await syncPayoutRequestStatus(db, {
      relatedTable: "boss_refund_requests",
      relatedRecordId: refundId,
      status: "pending_payment",
      patch: { batch_id: batch.id },
    });
  }
  return { ok: true, batch, refund: viewBossRefund(patched?.[0] || { ...row, status: "included_in_batch", batch_id: batch.id }) };
}

export async function rolloverRefundToNextWeek(db, refundId, reason = "周五未完成打款，顺延下周") {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "记录不存在" };
  if (/paid|rejected|cancelled/i.test(String(row.status))) {
    return { ok: false, message: "已完成/驳回记录不可顺延。" };
  }
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
  return { ok: true, refund: viewBossRefund(patched?.[0]), message: `已顺延至 ${next}` };
}

/**
 * Complete Friday bank refund: require receipt path + bank ref; idempotent wallet credit.
 */
export async function completeBossRefundPayout(db, {
  refundId,
  paidAmount,
  bankReference,
  paidAt,
  receiptBucket,
  receiptPath,
  adminId,
  adminName,
} = {}) {
  const rows = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}&limit=1`);
  const row = rows?.[0];
  if (!row) return { ok: false, message: "退款记录不存在" };
  if (row.status === "paid") {
    return { ok: true, message: "已打款（幂等）", refund: viewBossRefund(row), duplicate: true };
  }
  if (!String(bankReference || "").trim()) {
    return { ok: false, message: "必须填写银行参考号 / Transaction Reference" };
  }
  if (!String(receiptPath || "").trim()) {
    return { ok: false, message: "没有上传打款凭证，不允许标记完成。" };
  }
  const amount = money(paidAmount != null ? paidAmount : row.amount_rm);
  const patch = {
    status: "paid",
    paid_amount_rm: amount,
    paid_at: paidAt || nowIso(),
    paid_by: adminId || null,
    bank_reference: String(bankReference).trim(),
    receipt_bucket: receiptBucket || "finance-receipts",
    receipt_path: String(receiptPath).trim(),
    updated_at: nowIso(),
  };
  const patched = await db("boss_refund_requests", `?id=eq.${encodeURIComponent(refundId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const saved = patched?.[0] || { ...row, ...patch };

  // Versioned receipt (never overwrite)
  try {
    const vers = await db(
      "payout_receipt_versions",
      `?related_table=eq.boss_refund_requests&related_record_id=eq.${encodeURIComponent(refundId)}&select=version&order=version.desc&limit=1`
    );
    const nextVer = (vers?.[0]?.version || 0) + 1;
    await db("payout_receipt_versions", "", {
      method: "POST",
      body: JSON.stringify({
        related_table: "boss_refund_requests",
        related_record_id: refundId,
        version: nextVer,
        storage_bucket: patch.receipt_bucket,
        storage_path: patch.receipt_path,
        bank_reference: patch.bank_reference,
        paid_amount_rm: amount,
        uploaded_by: adminId || null,
        created_at: nowIso(),
      }),
    });
  } catch {
    /* optional table */
  }

  await syncPayoutRequestStatus(db, {
    relatedTable: "boss_refund_requests",
    relatedRecordId: refundId,
    status: "completed",
    patch: {
      paid_at: patch.paid_at,
      paid_by: adminId || null,
      transaction_no: patch.bank_reference,
      receipt_url: patch.receipt_path,
    },
  });

  // Wallet credit only after bank payout confirmed (idempotent)
  try {
    const walletApi = await import("./_wallet.js");
    await walletApi.creditWallet({
      bossId: saved.boss_id,
      transactionType: "refund",
      amount,
      balanceType: "paid",
      idempotencyKey: `friday-refund-paid:${saved.id}`,
      reason: saved.cs_note || saved.reason || "周五退款到账",
      relatedOrderId: saved.order_id,
      operatorId: adminId,
    });
  } catch (e) {
    console.warn("[friday-refund] wallet credit:", e?.message || e);
  }

  // Order → refunded only after Friday bank payout
  if (saved.order_id) {
    try {
      await db("orders", `?id=eq.${encodeURIComponent(saved.order_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "refunded", updated_at: nowIso() }),
      });
    } catch (e) {
      console.warn("[friday-refund] order status:", e?.message || e);
    }
  }

  // Notify boss
  try {
    const { notifyBoss } = await import("./_wallet.js");
    await notifyBoss(
      saved.boss_id,
      "退款已完成",
      `订单 ${saved.order_no || ""} 退款 RM ${amount} 已打款。参考号：${patch.bank_reference}`,
      "refund",
      saved.id
    );
  } catch {
    /* optional */
  }

  return {
    ok: true,
    message: "退款打款完成",
    refund: viewBossRefund(saved),
    adminName: adminName || "",
  };
}

export async function listBossRefunds(db, { bossId, status, limit = 100 } = {}) {
  try {
    let q = `?order=created_at.desc&limit=${Number(limit) || 100}`;
    if (bossId) q = `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=${Number(limit) || 100}`;
    if (status) q += (q.includes("?") ? "&" : "?") + `status=eq.${encodeURIComponent(status)}`;
    // fix double ?
    q = q.replace(/\?([^?]*)&status/, "?status").replace(/^&/, "?");
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
