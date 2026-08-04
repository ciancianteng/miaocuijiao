/**
 * Unified payout_requests write helpers + source locks (freeze / release / settle).
 */
import {
  computeSettlementDate,
  mergeWeeklySettings,
  normalizePayoutStatus,
  PAYOUT_STATUS_TEXT,
  statusText,
  viewWeeklyRules,
} from "./_weekly-settlement.js";

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

function isMissingRelation(err) {
  const msg = `${err?.message || ""} ${JSON.stringify(err?.body || "")}`;
  return /Could not find the table|relation .* does not exist|PGRST205/i.test(msg);
}

/**
 * @param {Function} db - companionDb(table, query, opts)
 */
export async function loadFinanceWeeklySettings(db) {
  try {
    const rows = await db("finance_settings", "?id=eq.1&limit=1");
    return mergeWeeklySettings(rows?.[0] || {});
  } catch (e) {
    if (isMissingRelation(e)) return mergeWeeklySettings({});
    throw e;
  }
}

export async function upsertPayoutRequest(db, payload = {}) {
  const body = {
    payout_no: payload.payoutNo || payload.payout_no || no("PO"),
    applicant_type: payload.applicantType || payload.applicant_type,
    applicant_id: payload.applicantId || payload.applicant_id,
    applicant_name: String(payload.applicantName || payload.applicant_name || ""),
    applicant_uid: String(payload.applicantUid || payload.applicant_uid || ""),
    amount: money(payload.amount),
    currency: payload.currency || "MYR",
    payout_method: payload.payoutMethod || payload.payout_method || "bank",
    bank_name: String(payload.bankName || payload.bank_name || ""),
    account_name: String(payload.accountName || payload.account_name || ""),
    account_number_masked: String(payload.accountNumberMasked || payload.account_number_masked || ""),
    tng_account: String(payload.tngAccount || payload.tng_account || ""),
    source_period_start: payload.sourcePeriodStart || payload.source_period_start || null,
    source_period_end: payload.sourcePeriodEnd || payload.source_period_end || null,
    source_order_ids: payload.sourceOrderIds || payload.source_order_ids || [],
    source_ledger_ids: payload.sourceLedgerIds || payload.source_ledger_ids || [],
    settlement_date: payload.settlementDate || payload.settlement_date,
    status: normalizePayoutStatus(payload.status || "pending_friday"),
    submitted_at: payload.submittedAt || payload.submitted_at || nowIso(),
    related_table: payload.relatedTable || payload.related_table || "",
    related_record_id: payload.relatedRecordId || payload.related_record_id || null,
    meta: payload.meta || {},
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  try {
    const rows = await db("payout_requests", "", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return rows?.[0] || null;
  } catch (err) {
    if (isMissingRelation(err)) return null;
    // Column soft-fail
    const msg = `${err?.message || ""}`;
    const m = msg.match(/Could not find the '([^']+)' column/i);
    if (m && m[1] in body) {
      delete body[m[1]];
      const rows = await db("payout_requests", "", { method: "POST", body: JSON.stringify(body) });
      return rows?.[0] || null;
    }
    console.warn("[payout] upsertPayoutRequest:", err?.message || err);
    return null;
  }
}

export async function syncPayoutRequestStatus(db, { relatedTable, relatedRecordId, status, patch = {} } = {}) {
  if (!relatedTable || !relatedRecordId) return null;
  const canonical = normalizePayoutStatus(status);
  const body = {
    status: canonical,
    updated_at: nowIso(),
    ...patch,
  };
  try {
    const rows = await db(
      "payout_requests",
      `?related_table=eq.${encodeURIComponent(relatedTable)}&related_record_id=eq.${encodeURIComponent(relatedRecordId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    return rows?.[0] || null;
  } catch (err) {
    if (!isMissingRelation(err)) console.warn("[payout] syncPayoutRequestStatus:", err?.message || err);
    return null;
  }
}

export async function lockPayoutSources(db, { applicantId, sources = [], payoutRequestId, relatedTable, relatedRecordId } = {}) {
  const locks = [];
  for (const src of sources) {
    const kind = src.kind || "ledger";
    const sourceId = String(src.id || src.sourceId || "").trim();
    if (!sourceId) continue;
    try {
      const rows = await db("payout_source_locks", "", {
        method: "POST",
        body: JSON.stringify({
          source_kind: kind,
          source_id: sourceId,
          applicant_id: applicantId,
          payout_request_id: payoutRequestId || null,
          related_table: relatedTable || "",
          related_record_id: relatedRecordId || null,
          status: "frozen",
          created_at: nowIso(),
        }),
      });
      locks.push(rows?.[0] || null);
    } catch (err) {
      const msg = `${err?.message || ""} ${JSON.stringify(err?.body || "")}`;
      if (/duplicate|unique|23505/i.test(msg)) {
        const errObj = Object.assign(new Error("该收益/周期已在其他结算单中，不能重复申请"), {
          status: 409,
          code: "SOURCE_LOCKED",
        });
        throw errObj;
      }
      if (!isMissingRelation(err)) console.warn("[payout] lockPayoutSources:", err?.message || err);
    }
  }
  return locks;
}

export async function releasePayoutSources(db, { relatedTable, relatedRecordId, payoutRequestId } = {}) {
  try {
    let q = "";
    if (payoutRequestId) q = `?payout_request_id=eq.${encodeURIComponent(payoutRequestId)}&status=eq.frozen`;
    else if (relatedTable && relatedRecordId) {
      q = `?related_table=eq.${encodeURIComponent(relatedTable)}&related_record_id=eq.${encodeURIComponent(relatedRecordId)}&status=eq.frozen`;
    } else return null;
    await db("payout_source_locks", q, {
      method: "PATCH",
      body: JSON.stringify({ status: "released" }),
    });
  } catch (err) {
    if (!isMissingRelation(err)) console.warn("[payout] releasePayoutSources:", err?.message || err);
  }
}

export async function settlePayoutSources(db, { relatedTable, relatedRecordId, payoutRequestId } = {}) {
  try {
    let q = "";
    if (payoutRequestId) q = `?payout_request_id=eq.${encodeURIComponent(payoutRequestId)}`;
    else if (relatedTable && relatedRecordId) {
      q = `?related_table=eq.${encodeURIComponent(relatedTable)}&related_record_id=eq.${encodeURIComponent(relatedRecordId)}`;
    } else return null;
    await db("payout_source_locks", q, {
      method: "PATCH",
      body: JSON.stringify({ status: "settled" }),
    });
  } catch (err) {
    if (!isMissingRelation(err)) console.warn("[payout] settlePayoutSources:", err?.message || err);
  }
}

export function viewPayoutRequest(row = {}) {
  return {
    id: row.id,
    payoutNo: row.payout_no,
    applicantType: row.applicant_type,
    applicantTypeText: row.applicant_type === "companion" ? "陪玩提现" : "客服工资",
    applicantId: row.applicant_id,
    applicantName: row.applicant_name || "",
    applicantUid: row.applicant_uid || "",
    amount: money(row.amount),
    currency: row.currency || "MYR",
    payoutMethod: row.payout_method || "bank",
    bankName: row.bank_name || "",
    accountName: row.account_name || "",
    accountNumberMasked: row.account_number_masked || "",
    settlementDate: row.settlement_date || "",
    status: row.status,
    statusCanonical: normalizePayoutStatus(row.status),
    statusText: statusText(row.status),
    submittedAt: row.submitted_at || row.created_at || "",
    reviewedAt: row.reviewed_at || "",
    paidAt: row.paid_at || "",
    transactionNo: row.transaction_no || "",
    receiptUrl: row.receipt_url || "",
    rejectReason: row.reject_reason || "",
    relatedTable: row.related_table || "",
    relatedRecordId: row.related_record_id || "",
    sourcePeriodStart: row.source_period_start || "",
    sourcePeriodEnd: row.source_period_end || "",
  };
}

export { computeSettlementDate, mergeWeeklySettings, normalizePayoutStatus, PAYOUT_STATUS_TEXT, statusText, viewWeeklyRules };
