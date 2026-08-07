import {
  companionDb,
  createSignedUrl,
  decodeDataUrl,
  deleteStorageObject,
  ensurePrivateBucket,
  isMissingRelation,
  maskBankAccount,
  uploadPrivateObject,
  buildObjectPath,
} from "../_companion-media-store.js";
import { writeAdminLog } from "../_wallet.js";
import { insertCompanionNotification } from "../_companion-inbox.js";
import {
  canApprove,
  canMarkPaid,
  canStartReview,
  computeSettlementDate,
  mergeWeeklySettings,
  normalizePayoutStatus,
  PAYOUT_STATUS_TEXT,
  statusText,
  viewWeeklyRules,
} from "../_weekly-settlement.js";
import {
  releasePayoutSources,
  settlePayoutSources,
  syncPayoutRequestStatus,
  viewPayoutRequest,
} from "../_payout-requests.js";
import {
  allocateCsPayrollNo,
  publicDisplayName,
  resolveCompanionPublicCode,
} from "../_account-codes.js";
import { exportCsv as exportPaymentReceiptsCsv, listPaidForAdmin, listPendingForAdmin, listRejectedForAdmin, enrichReceiptAudit, approveAndLedger, rejectProof } from "../_payment-receipts.js";

const FINANCE_BUCKET = "finance-receipts";
const FINANCE_ROLES = new Set(["admin", "super_admin", "finance_admin"]);
/**
 * Full bank reveal roles.
 * Product note: backoffice login role is often `admin` while the UI labels it「超级管理员」.
 * Treat platform `admin` the same as `super_admin` for reveal — never CS/boss/companion.
 */
const REVEAL_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

/** Unified weekly payout statuses */
const WITHDRAW_STATUS = {
  ...PAYOUT_STATUS_TEXT,
  pending: "已提交",
  pending_review: "待周五结算",
  pending_friday: "待周五结算",
  reviewing: "审核中",
  approved: "审核通过待打款",
  approved_pending_pay: "审核通过待打款",
  pending_payment: "审核通过待打款",
  paying: "审核通过待打款",
  paid_pending_receipt: "已打款",
  paid: "已打款",
  completed: "已完成",
  rejected: "已驳回",
  rolled_over: "顺延至下周",
  pay_failed: "付款失败",
  cancelled: "已撤销",
};

const PAYROLL_STATUS = { ...WITHDRAW_STATUS, draft: "待结算", completed: "已完成" };

function json(res, status, data) {
  res.status(status).json(data);
}

async function assertFinanceAdmin(req) {
  const { requireAdmin, normalizeAdminRole } = await import("../_admin-auth.js");
  const profile = await requireAdmin(req, { allowRoles: FINANCE_ROLES });
  const normalized = normalizeAdminRole(profile?.role) || normalizeFinanceRole(profile?.role);
  return { ...profile, role: normalized || profile.role };
}

function normalizeFinanceRole(role) {
  const raw = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "superadmin" || raw === "super_admin" || raw === "root") return "super_admin";
  if (raw === "admin" || raw === "administrator") return "admin";
  if (raw === "finance_admin" || raw === "finance") return "finance_admin";
  return raw;
}

function canReveal(profile) {
  return REVEAL_ROLES.has(normalizeFinanceRole(profile?.role));
}

function canConfirmPay(profile) {
  return FINANCE_ROLES.has(normalizeFinanceRole(profile?.role));
}

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

function clientIp(req) {
  const xf = String(req?.headers?.["x-forwarded-for"] || req?.headers?.["x-real-ip"] || "").split(",")[0].trim();
  return xf || String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || "").trim() || "";
}

function adminDisplayName(profile = {}) {
  return String(profile.display_name || profile.email || profile.id || "admin").trim();
}

async function insertStaffNotification({ staffId, category = "payroll", title = "", body = "", href = "/customer-service/reports/", noticeKey = "" } = {}) {
  const uid = String(staffId || "").trim();
  if (!uid) return null;
  const key = String(noticeKey || "").trim() || `${category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await companionDb("staff_notifications", "", {
      method: "POST",
      body: JSON.stringify({
        staff_id: uid,
        notice_key: key,
        category: String(category || "payroll"),
        title: String(title || "").trim() || "系统通知",
        body: String(body || "").trim(),
        href: String(href || "/customer-service/reports/"),
        created_at: nowIso(),
      }),
    });
    return key;
  } catch (err) {
    if (!isMissingRelation(err)) console.warn("[finance] insertStaffNotification:", err?.message || err);
    return null;
  }
}

async function writePayoutLog({
  payoutType,
  relatedRecordId,
  paymentId,
  receiptId,
  payeeUserId,
  payeeName,
  payeeUid,
  amountRm,
  bankReference,
  receiptPath,
  receiptFileType,
  notes,
  adminId,
  adminName,
  adminRole,
  ip,
  action = "confirm_paid",
} = {}) {
  try {
    const rows = await companionDb("finance_payout_logs", "", {
      method: "POST",
      body: JSON.stringify({
        log_no: no("PLOG"),
        payout_type: payoutType || "other",
        related_record_id: relatedRecordId || null,
        payment_id: paymentId || null,
        receipt_id: receiptId || null,
        payee_user_id: payeeUserId || null,
        payee_name: String(payeeName || ""),
        payee_uid: String(payeeUid || ""),
        amount_rm: money(amountRm),
        bank_reference: String(bankReference || ""),
        receipt_path: String(receiptPath || ""),
        receipt_file_type: String(receiptFileType || ""),
        notes: String(notes || ""),
        admin_id: adminId || null,
        admin_name: String(adminName || ""),
        admin_role: String(adminRole || ""),
        client_ip: String(ip || ""),
        action: String(action || "confirm_paid"),
        created_at: nowIso(),
      }),
    });
    return rows?.[0] || null;
  } catch (err) {
    if (!isMissingRelation(err)) console.warn("[finance] writePayoutLog:", err?.message || err);
    return null;
  }
}

function viewPayoutLog(row = {}) {
  return {
    id: row.id,
    logNo: row.log_no,
    payoutType: row.payout_type,
    payoutTypeText:
      ({ companion_withdraw: "陪玩提现", staff_payroll: "客服工资", other: "其他" })[row.payout_type] || row.payout_type,
    relatedRecordId: row.related_record_id || "",
    paymentId: row.payment_id || "",
    receiptId: row.receipt_id || "",
    payeeUserId: row.payee_user_id || "",
    payeeName: row.payee_name || "",
    payeeUid: row.payee_uid || "",
    amountRm: money(row.amount_rm),
    bankReference: row.bank_reference || "",
    receiptPath: row.receipt_path || "",
    hasReceipt: !!row.receipt_path,
    notes: row.notes || "",
    adminId: row.admin_id || "",
    adminName: row.admin_name || "",
    adminRole: row.admin_role || "",
    clientIp: row.client_ip || "",
    action: row.action || "",
    createdAt: row.created_at || "",
  };
}

async function sumDockRewardRm(staffId, periodStart, periodEnd) {
  try {
    const rows = await companionDb(
      "cs_dock_rewards",
      `?service_id=eq.${encodeURIComponent(staffId)}&status=eq.settled&limit=500`
    ).catch(() => []);
    const start = periodStart ? new Date(periodStart).getTime() : 0;
    const end = periodEnd ? new Date(periodEnd).getTime() + 86400000 : Number.MAX_SAFE_INTEGER;
    return (rows || [])
      .filter((r) => {
        const t = new Date(r.settled_at || r.created_at || 0).getTime();
        return t >= start && t <= end;
      })
      .reduce((sum, r) => sum + money(r.amount_cat_food || r.amount_rm || 0), 0);
  } catch {
    return 0;
  }
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function settings() {
  try {
    const rows = await companionDb("finance_settings", "?id=eq.1&limit=1");
    return mergeWeeklySettings(
      rows?.[0] || {
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 8,
        max_withdrawals_per_week: 2,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
        company_name: "MEOW CUI JIAO ENTERPRISE",
      }
    );
  } catch (e) {
    if (isMissingRelation(e)) {
      return mergeWeeklySettings({
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 8,
        max_withdrawals_per_week: 2,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
        company_name: "MEOW CUI JIAO ENTERPRISE",
      });
    }
    throw e;
  }
}

async function profileMap(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await companionDb("profiles", `?id=in.(${uniq.map(encodeURIComponent).join(",")})&limit=1000`).catch(() => []);
  return (rows || []).reduce((m, r) => {
    m[r.id] = r;
    return m;
  }, {});
}

function queryOf(req) {
  if (req?.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req.url || "/", "http://localhost").searchParams.entries());
  } catch {
    return {};
  }
}

function resolveRowId(row = {}) {
  return String(row.id || row.uuid || row.withdrawal_id || row.withdrawalId || "").trim();
}

function viewWithdraw(row, profile = {}, account = {}, adminMap = {}, companionExtra = {}) {
  const id = resolveRowId(row);
  const approvedById = row.approved_by || row.reviewed_by || "";
  const paidById = row.paid_by || row.confirmed_by || "";
  const approvedAdmin = adminMap[approvedById] || {};
  const paidAdmin = adminMap[paidById] || {};
  const companionCode = resolveCompanionPublicCode(companionExtra, profile);
  const companionName = publicDisplayName(
    { display_name: companionExtra.nickname || profile.display_name, email: profile.email },
    companionCode || "-"
  );
  return {
    id,
    withdrawalId: id,
    withdrawalNo: row.withdrawal_no || row.withdrawalNo || "",
    companionId: row.companion_id || row.companionId || "",
    companionUid: companionCode || "",
    companionCode: companionCode || "",
    companionName,
    catFoodAmount: money(row.cat_food_amount),
    exchangeRate: money(row.exchange_rate),
    grossAmountRm: money(row.gross_amount_rm),
    feeRm: money(row.fee_rm),
    netAmountRm: money(row.net_amount_rm),
    bankName: row.bank_name || account.bank_name || "",
    accountHolder: row.account_holder || account.account_name || "",
    accountLast4: row.account_last4 || account.account_last4 || maskBankAccount(account.bank_account).slice(-4),
    accountStatus: account.status || "",
    remark: row.remark || "",
    paymentRemark: row.payment_remark || row.finance_note || "",
    bankReference: row.bank_reference || "",
    receiptUrl: row.receipt_url || "",
    receiptFileType: row.receipt_file_type || "",
    status: row.status,
    statusText: WITHDRAW_STATUS[row.status] || row.status,
    rejectReason: row.reject_reason || row.rejection_reason || "",
    submittedAt: row.submitted_at || row.created_at,
    reviewedAt: row.reviewed_at || row.approved_at || "",
    approvedAt: row.approved_at || row.reviewed_at || "",
    approvedBy: approvedById,
    approvedByName: publicDisplayName(approvedAdmin, ""),
    paidAt: row.paid_at || "",
    completedAt: row.completed_at || "",
    paidBy: paidById,
    paidByName: publicDisplayName(paidAdmin, ""),
    paymentAccountId: row.payment_account_id || "",
    settlementDate: row.settlement_date || "",
    statusCanonical: normalizePayoutStatus(row.status),
  };
}

function viewPayroll(row, profile = {}, adminMap = {}) {
  const snap = row.payment_account_snapshot || {};
  const breakdown = row.wage_breakdown && typeof row.wage_breakdown === "object" ? row.wage_breakdown : {};
  const approvedById = row.approved_by || "";
  const confirmedById = row.confirmed_by || "";
  const approvedAdmin = adminMap[approvedById] || {};
  const confirmedAdmin = adminMap[confirmedById] || {};
  const commissionRm =
    row.commission_rm != null && Number(row.commission_rm) !== 0
      ? money(row.commission_rm)
      : money(breakdown.commissionRm ?? breakdown.orderCommission ?? 0);
  const catFoodRewardRm =
    row.cat_food_reward_rm != null && Number(row.cat_food_reward_rm) !== 0
      ? money(row.cat_food_reward_rm)
      : money(breakdown.catFoodRewardRm ?? breakdown.dockRewardRm ?? 0);
  const otherBonus = Math.max(0, money(row.bonus_rm) - commissionRm);
  return {
    id: row.id,
    payrollNo: row.payroll_no,
    staffId: row.staff_id,
    staffUid: "",
    staffName: publicDisplayName(profile, "-"),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    workDays: row.work_days || 0,
    fullAttendance: !!row.full_attendance,
    receptionCount: row.reception_count || 0,
    orderCount: row.order_count || 0,
    baseSalaryRm: money(row.base_salary_rm),
    bonusRm: money(row.bonus_rm),
    commissionRm,
    catFoodRewardRm,
    otherBonusRm: otherBonus,
    deductionRm: money(row.deduction_rm),
    netSalaryRm: money(row.net_salary_rm),
    wageBreakdown: {
      baseSalaryRm: money(row.base_salary_rm),
      commissionRm,
      catFoodRewardRm,
      otherBonusRm: otherBonus,
      deductionRm: money(row.deduction_rm),
      netSalaryRm: money(row.net_salary_rm),
      ...breakdown,
    },
    bankName: snap.bank_name || "",
    accountHolder: snap.account_holder || "",
    accountLast4: snap.account_last4 || "",
    bankReference: row.bank_reference || "",
    receiptUrl: row.receipt_url || "",
    status: row.status,
    statusText: PAYROLL_STATUS[row.status] || row.status,
    rejectReason: row.reject_reason || "",
    note: row.note || "",
    approvedAt: row.approved_at || "",
    approvedBy: approvedById,
    approvedByName: publicDisplayName(approvedAdmin, ""),
    paidAt: row.paid_at || "",
    completedAt: row.completed_at || "",
    confirmedBy: confirmedById,
    confirmedByName: publicDisplayName(confirmedAdmin, ""),
    settlementDate: row.settlement_date || "",
    submittedAt: row.submitted_at || row.created_at || "",
    reviewedAt: row.reviewed_at || row.approved_at || "",
    transactionNo: row.transaction_no || row.bank_reference || "",
    statusCanonical: normalizePayoutStatus(row.status),
  };
}

function viewPayment(row, profile = {}) {
  return {
    id: row.id,
    paymentNo: row.payment_no,
    paymentType: row.payment_type,
    paymentTypeText:
      { companion_withdraw: "陪玩提现", staff_payroll: "客服工资", refund: "退款付款", other: "其他" }[row.payment_type] ||
      row.payment_type,
    relatedRecordId: row.related_record_id,
    payeeUserId: row.payee_user_id,
    payeeName: row.payee_name || publicDisplayName(profile, "-"),
    payeeUid: profile.boss_uid || "",
    amountRm: money(row.amount_rm),
    actualAmountRm: row.actual_amount_rm != null ? money(row.actual_amount_rm) : null,
    bankReference: row.bank_reference || "",
    payeeBank: row.payee_bank || "",
    payeeAccountLast4: row.payee_account_last4 || "",
    paymentDate: row.payment_date || "",
    status: row.status,
    statusText: ({ pending_pay: "待付款", paying: "打款中", completed: "已完成", failed: "付款失败", void: "已作废" })[
      row.status
    ] || row.status,
    createdAt: row.created_at,
    financeNote: row.finance_note || "",
  };
}

function viewReceipt(row, payment = {}, profile = {}, extra = {}) {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    paymentId: row.payment_id,
    paymentNo: payment.payment_no || "",
    paymentType: payment.payment_type || "",
    relatedRecordId: payment.related_record_id || "",
    withdrawalNo: extra.withdrawalNo || "",
    payeeName: payment.payee_name || profile.display_name || "-",
    payeeUid: profile.boss_uid || profile.id || payment.payee_user_id || "",
    amountRm: money(row.amount_rm),
    bankReference: row.bank_reference || "",
    accountingMonth: row.accounting_month || "",
    taxYear: row.tax_year || "",
    accountingCategory: row.accounting_category || "",
    companyName: row.company_name || "",
    reconciliationStatus: row.reconciliation_status,
    reconciliationStatusText:
      ({ pending: "待对账", reconciled: "已对账", variance: "有差异", archived: "已归档", void: "已作废" })[
        row.reconciliation_status
      ] || row.reconciliation_status,
    handedToAccountant: !!row.handed_to_accountant,
    uploadedAt: row.uploaded_at,
    notes: row.notes || "",
    fileType: row.file_type || "",
    hasFile: !!row.file_path,
  };
}

async function ensureFinancePayment(type, relatedId, payeeId, amount, snapshot, adminId) {
  const existing = await companionDb(
    "finance_payments",
    `?related_record_id=eq.${encodeURIComponent(relatedId)}&payment_type=eq.${encodeURIComponent(type)}&limit=1`
  ).catch(() => []);
  if (existing?.[0]) return existing[0];
  const rows = await companionDb("finance_payments", "", {
    method: "POST",
    body: JSON.stringify({
      payment_no: no("PAYOUT"),
      payment_type: type,
      related_record_id: relatedId,
      payee_user_id: payeeId,
      amount_rm: amount,
      payee_bank: snapshot.bank_name || "",
      payee_name: snapshot.account_holder || snapshot.account_name || "",
      payee_account_last4: snapshot.account_last4 || "",
      status: "pending_pay",
      created_by: adminId || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  let adminProfile;
  try {
    adminProfile = await assertFinanceAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有提现与发薪管理权限" });
  }

  try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    const q = queryOf(req);
    const action = String(req.method === "GET" ? q.action || "bootstrap" : body.action || "").trim();
    const adminRole = String(adminProfile.role || "admin");

    if (req.method === "GET" && action === "bootstrap") {
      const refundApi = await import("../_boss-refund-payout.js");
      const [withdrawalsRaw, payrollsRaw, paymentsRaw, receiptsRaw, logsRaw, cfg, refundsList, paymentReceiptsRaw, pendingPaymentProofsRaw, rejectedPaymentProofsRaw] = await Promise.all([
        companionDb("companion_withdrawals", "?order=submitted_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("staff_payrolls", "?order=created_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("finance_payments", "?order=created_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("finance_receipts", "?order=uploaded_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("finance_payout_logs", "?order=created_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : [])),
        settings(),
        refundApi.listBossRefunds(companionDb, { limit: 300 }).catch(() => []),
        listPaidForAdmin().catch(() => []),
        listPendingForAdmin().catch(() => []),
        listRejectedForAdmin({ limit: 200 }).catch(() => []),
      ]);
      const [paymentReceipts, pendingPaymentProofs, rejectedPaymentProofs] = await Promise.all([
        enrichReceiptAudit(paymentReceiptsRaw || []).catch(() => paymentReceiptsRaw || []),
        enrichReceiptAudit(pendingPaymentProofsRaw || []).catch(() => pendingPaymentProofsRaw || []),
        enrichReceiptAudit(rejectedPaymentProofsRaw || []).catch(() => rejectedPaymentProofsRaw || []),
      ]);
      const withdrawals = (Array.isArray(withdrawalsRaw) ? withdrawalsRaw : []).filter((r) => resolveRowId(r));
      const payrolls = Array.isArray(payrollsRaw) ? payrollsRaw : [];
      const payments = Array.isArray(paymentsRaw) ? paymentsRaw : [];
      const receipts = Array.isArray(receiptsRaw) ? receiptsRaw : [];
      const payoutLogs = Array.isArray(logsRaw) ? logsRaw : [];
      const bossRefunds = Array.isArray(refundsList) ? refundsList : [];
      const ids = [
        ...withdrawals.map((r) => r.companion_id),
        ...payrolls.map((r) => r.staff_id),
        ...payments.map((r) => r.payee_user_id),
        ...withdrawals.flatMap((r) => [r.approved_by, r.reviewed_by, r.confirmed_by, r.paid_by]),
        ...payrolls.flatMap((r) => [r.approved_by, r.confirmed_by]),
        ...bossRefunds.map((r) => r.bossId || r.boss_id),
      ];
      const profiles = await profileMap(ids);
      const companionCodes = {};
      const companionUserIds = withdrawals.map((r) => r.companion_id).filter(Boolean);
      if (companionUserIds.length) {
        const cpRows = await companionDb(
          "companion_profiles",
          `?user_id=in.(${companionUserIds.map(encodeURIComponent).join(",")})&select=id,user_id,companion_code,nickname&limit=500`
        ).catch(() => []);
        for (const cp of Array.isArray(cpRows) ? cpRows : []) {
          if (cp.user_id) companionCodes[cp.user_id] = cp;
        }
      }
      const accountIds = withdrawals.map((r) => r.payment_account_id).filter(Boolean);
      let accounts = {};
      if (accountIds.length) {
        const rows = await companionDb(
          "companion_payment_accounts",
          `?id=in.(${accountIds.map(encodeURIComponent).join(",")})`
        ).catch(() => []);
        accounts = (rows || []).reduce((m, r) => {
          m[r.id] = r;
          return m;
        }, {});
      }
      const paymentMap = (payments || []).reduce((m, p) => {
        const pid = resolveRowId(p);
        if (pid) m[pid] = p;
        return m;
      }, {});
      const withdrawNoMap = withdrawals.reduce((m, r) => {
        const wid = resolveRowId(r);
        if (wid) m[wid] = r.withdrawal_no || wid;
        return m;
      }, {});
      const friKey = String(viewWeeklyRules(cfg).thisFriday || "").slice(0, 10);
      const currentBatch = await refundApi.getCurrentBatchPanel(companionDb, friKey).catch(() => null);
      const settlementSummary = {
        thisFriday: friKey,
        pendingRefunds: bossRefunds.filter((r) =>
          /approved_for_payout|included_in_batch|processing|carried_forward|pending_review/i.test(String(r.status))
        ).length,
        pendingCompanion: withdrawals.filter((r) =>
          /pending_friday|submitted|reviewing|pending_payment|approved|rolled_over/i.test(String(r.status))
        ).length,
        pendingCs: payrolls.filter((r) =>
          /pending_friday|submitted|reviewing|pending_payment|approved|rolled_over|draft/i.test(String(r.status))
        ).length,
        refundPendingRm: bossRefunds
          .filter((r) => /approved_for_payout|included_in_batch|processing|carried_forward/i.test(String(r.status)))
          .reduce((n, r) => n + money(r.amountRm), 0),
        refundPaidRm: bossRefunds.filter((r) => r.status === "paid").reduce((n, r) => n + money(r.paidAmountRm || r.amountRm), 0),
        batchCode: currentBatch?.batchCode || "",
        batchPaidCount: currentBatch?.paidCount || 0,
        batchFailedCount: currentBatch?.failedCount || 0,
        batchPendingAmountRm: currentBatch?.pendingAmountRm || 0,
        batchPaidAmountRm: currentBatch?.paidAmountRm || 0,
      };
      return json(res, 200, {
        ok: true,
        settings: cfg,
        weeklyRules: viewWeeklyRules(cfg),
        settlementSummary,
        currentBatch,
        bossRefunds,
        withdrawals: withdrawals.map((r) =>
          viewWithdraw(r, profiles[r.companion_id], accounts[r.payment_account_id], profiles, companionCodes[r.companion_id])
        ),
        payrolls: payrolls.map((r) => viewPayroll(r, profiles[r.staff_id], profiles)),
        payoutRequests: [
          ...bossRefunds.map((r) => ({
            ...r,
            applicantType: "boss",
            applicantTypeText: "老板退款",
            payoutType: "boss_refund",
            amount: money(r.amountRm),
            payoutNo: r.refundNo,
            settlementDate: r.settlementDate || "",
            statusCanonical: r.status,
            statusText: r.statusText,
          })),
          ...withdrawals.map((r) => ({
            ...viewWithdraw(r, profiles[r.companion_id], accounts[r.payment_account_id], profiles, companionCodes[r.companion_id]),
            applicantType: "companion",
            applicantTypeText: "陪玩提现",
            payoutType: "companion_wage",
            amount: money(r.net_amount_rm),
            payoutNo: r.withdrawal_no,
            settlementDate: r.settlement_date || "",
            statusCanonical: normalizePayoutStatus(r.status),
            statusText: statusText(r.status),
          })),
          ...payrolls.map((r) => ({
            ...viewPayroll(r, profiles[r.staff_id], profiles),
            applicantType: "customer_service",
            applicantTypeText: "客服工资",
            payoutType: "cs_wage",
            amount: money(r.net_salary_rm),
            payoutNo: r.payroll_no,
            settlementDate: r.settlement_date || "",
            statusCanonical: normalizePayoutStatus(r.status),
            statusText: statusText(r.status),
          })),
        ],
        pendingPayments: payments
          .filter((p) => /pending_pay|paying/.test(p.status))
          .map((p) => viewPayment(p, profiles[p.payee_user_id])),
        receipts: receipts.map((r) => {
          const pay = paymentMap[r.payment_id] || {};
          return viewReceipt(r, pay, profiles[pay.payee_user_id], {
            withdrawalNo:
              pay.payment_type === "companion_withdraw"
                ? withdrawNoMap[pay.related_record_id] || ""
                : "",
          });
        }),
        payoutLogs: payoutLogs.map((r) => viewPayoutLog(r)),
        paymentReceipts: paymentReceipts.map((row) => ({
          id: row.id,
          orderId: row.order_id,
          orderNo: row.orderNo || row.order_id || "",
          receiptNo: row.receipt?.receipt_no || row.receiptNo || "",
          bossName: row.bossName || "",
          bossUid: row.bossUid || "",
          amount: money(row.net_amount != null ? row.net_amount : row.amount),
          paymentMethod: row.payment_method || row.paymentMethod || "",
          confirmedAt: row.confirmed_at || row.reviewedAt || "",
          reviewedAt: row.reviewedAt || row.confirmed_at || "",
          reviewerName: row.reviewerName || "",
          proofPath: row.receipt?.storage_path || row.proofPath || "",
          proofUrl: row.proofUrl || "",
          rejectReason: "",
          status: "approved",
          statusText: "已通过",
        })),
        pendingPaymentProofs: (pendingPaymentProofs || []).map((row) => ({
          id: row.id,
          receiptId: row.id,
          receiptNo: row.receipt_no || "",
          orderId: row.order_id || "",
          orderNo: row.orderNo || row.order?.order_no || row.order_id || "",
          bossId: row.boss_id || row.order?.boss_id || "",
          bossName: row.bossName || "",
          bossUid: row.bossUid || "",
          companionId: row.order?.companion_id || "",
          amount: money(row.amount),
          paymentMethod: row.payment_method || row.order?.payment_method || "",
          uploadedAt: row.uploaded_at || row.created_at || "",
          proofUrl: row.proofUrl || "",
          reviewerName: "",
          reviewedAt: "",
          rejectReason: "",
          status: "pending",
          statusText: "待审核",
        })),
        rejectedPaymentProofs: (rejectedPaymentProofs || []).map((row) => ({
          id: row.id,
          receiptId: row.id,
          receiptNo: row.receipt_no || "",
          orderId: row.order_id || "",
          orderNo: row.orderNo || row.order?.order_no || row.order_id || "",
          bossId: row.boss_id || row.order?.boss_id || "",
          bossName: row.bossName || "",
          bossUid: row.bossUid || "",
          amount: money(row.amount),
          paymentMethod: row.payment_method || row.order?.payment_method || "",
          uploadedAt: row.uploaded_at || row.created_at || "",
          reviewedAt: row.reviewed_at || row.reviewedAt || "",
          reviewerName: row.reviewerName || "",
          rejectReason: row.reject_reason || row.rejectReason || "",
          proofUrl: row.proofUrl || "",
          status: "rejected",
          statusText: "已拒绝",
        })),
        statusMaps: { withdraw: WITHDRAW_STATUS, payroll: PAYROLL_STATUS },
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    if (action === "list_payment_receipts" || action === "export_payment_receipts") {
      const rows = await listPaidForAdmin({ year: body.year || q.year || "", month: body.month || q.month || "" });
      if (action === "export_payment_receipts") {
        await writeAdminLog({
          module: "finance", action, targetType: "payment_receipts",
          targetId: `${body.year || ""}-${body.month || ""}`, operatorId: adminProfile.id, operatorRole: adminRole,
        });
      }
      return json(res, 200, {
        ok: true, rows,
        csv: action === "export_payment_receipts" ? exportPaymentReceiptsCsv(rows) : undefined,
        formats: action === "export_payment_receipts" ? ["csv", "xlsx_via_csv"] : undefined,
      });
    }

    if (action === "approve_payment_proof" || action === "reject_payment_proof") {
      try {
        const orderId = String(body.orderId || body.order_id || body.id || "").trim();
        const receiptId = String(body.receiptId || body.receipt_id || "").trim();
        if (!orderId && !receiptId) return json(res, 400, { ok: false, message: "缺少订单或凭证 ID。" });
        const pending = await listPendingForAdmin();
        let receipt =
          (pending || []).find((row) => (receiptId && row.id === receiptId) || (orderId && row.order_id === orderId)) || null;
        // Recover: ledger already approved but order still awaiting_payment after a prior partial failure.
        if (!receipt && orderId) {
          const approvedRows = await companionDb(
            "payment_receipts",
            `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.approved&order=reviewed_at.desc&limit=1`
          ).catch(() => []);
          if (approvedRows?.[0]) receipt = approvedRows[0];
        }
        if (!receipt) return json(res, 404, { ok: false, message: "未找到待审核付款凭证。" });
        const orderRows = await companionDb("orders", `?id=eq.${encodeURIComponent(receipt.order_id || orderId)}&limit=1`).catch(() => []);
        const order = orderRows?.[0];
        if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
        if (order.status !== "awaiting_payment") {
          return json(res, 409, { ok: false, message: "当前订单不在付款审核中。" });
        }
        if (action === "reject_payment_proof") {
          if (String(receipt.status || "") !== "pending") {
            return json(res, 409, { ok: false, message: "付款凭证已被处理，无法驳回。" });
          }
          const reason = String(body.reason || body.reject_reason || "").trim();
          if (!reason) return json(res, 400, { ok: false, message: "请填写驳回付款原因。" });
          await rejectProof({ receipt, reviewerId: adminProfile.id, reason });
          const stripProof = (text) =>
            String(text || "")
              .replace(/\n?\[\[PAYMENT_PROOF\]\][^\n]*/g, "")
              .replace(/\n?\[\[PAYMENT_SUBMITTED\]\][^\n]*/g, "")
              .trim();
          const nextNote = stripProof(order.note);
          const nextDescription = stripProof(order.description);
          await companionDb("orders", `?id=eq.${encodeURIComponent(order.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ note: nextNote, description: nextDescription }),
          }).catch(() =>
            companionDb("orders", `?id=eq.${encodeURIComponent(order.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ note: nextNote }),
            }).catch(() => null)
          );
          await writeAdminLog({
            module: "finance",
            action,
            targetType: "payment_receipt",
            targetId: receipt.id,
            operatorId: adminProfile.id,
            operatorRole: adminRole,
            reason,
            after: { orderId: order.id, status: "rejected" },
          }).catch(() => null);
          return json(res, 200, { ok: true, message: "已驳回付款凭证，老板可重新上传。" });
        }
        if (String(receipt.status || "pending") === "pending") {
          await approveAndLedger({ order, receipt, reviewerId: adminProfile.id });
        }
        const next = order.companion_id ? "claimed" : "pending";
        // Keep patch minimal — avoid optional columns that break Prefer/404 on some schemas.
        let patched = null;
        const attempts = [
          {
            status: next,
            companion_id: order.companion_id || null,
            customer_service_id: order.customer_service_id || null,
            updated_at: nowIso(),
          },
          { status: next, companion_id: order.companion_id || null },
          { status: next },
        ];
        for (const patch of attempts) {
          try {
            patched = (
              await companionDb("orders", `?id=eq.${encodeURIComponent(order.id)}&status=eq.awaiting_payment`, {
                method: "PATCH",
                body: JSON.stringify(patch),
              })
            )?.[0];
            if (patched && patched.status !== "awaiting_payment") break;
          } catch (err) {
            const msg = String(err?.message || err || "");
            if (/paid_at|assignment_type|order_type|customer_service_id|updated_at|PGRST204|schema cache|column/i.test(msg)) {
              continue;
            }
            // Do not mis-label order patch failures as missing finance SQL.
            throw Object.assign(new Error(msg || "订单状态更新失败"), { status: err?.status && err.status !== 404 ? err.status : 500 });
          }
        }
        if (!patched || patched.status === "awaiting_payment") {
          // Fallback unconditional status write (still scoped by id).
          try {
            patched = (
              await companionDb("orders", `?id=eq.${encodeURIComponent(order.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ status: next }),
              })
            )?.[0];
          } catch (err2) {
            throw Object.assign(new Error(err2?.message || "订单状态更新失败"), { status: 500 });
          }
        }
        if (!patched || patched.status === "awaiting_payment") {
          return json(res, 409, { ok: false, message: "订单状态已变更，请刷新后重试。" });
        }
        // Best-effort enrichment (optional columns / notifications must not fail the approve).
        try {
          await companionDb("orders", `?id=eq.${encodeURIComponent(order.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              paid_at: nowIso(),
              assignment_type: order.companion_id ? order.assignment_type || "assigned" : order.assignment_type || "public",
              updated_at: nowIso(),
            }),
          });
        } catch (_) {}
        try {
          if (order.companion_id) {
            await insertCompanionNotification({
              companionUserId: order.companion_id,
              category: "order",
              title: "付款已确认",
              body: `订单 ${order.order_no || order.id} 付款已由后台审核通过，请及时确认接单。`,
              href: "/companion/orders/",
              noticeKey: `pay-approved-${order.id}`,
            });
          }
        } catch (_) {}
        await writeAdminLog({
          module: "finance",
          action,
          targetType: "payment_receipt",
          targetId: receipt.id,
          operatorId: adminProfile.id,
          operatorRole: adminRole,
          reason: "admin approved manual payment proof",
          after: { orderId: order.id, nextStatus: next },
        }).catch(() => null);
        return json(res, 200, {
          ok: true,
          message: order.companion_id ? "已审核通过，订单进入待陪玩确认。" : "已审核通过，订单已进入抢单大厅。",
          orderId: order.id,
          status: next,
        });
      } catch (proofErr) {
        return json(res, proofErr.status || 500, {
          ok: false,
          message: proofErr.message || "付款凭证审核失败",
        });
      }
    }

    if (action === "approve_withdraw") {
      const id = String(body.id || body.withdrawalId || body.withdrawal_id || "").trim();
      if (!id || id === "undefined" || id === "null") {
        return json(res, 400, { ok: false, message: "缺少提现单 id" });
      }
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      if (!/^(submitted|pending_friday|reviewing|pending|pending_review|rolled_over)$/.test(String(row.status || ""))) {
        return json(res, 400, { ok: false, message: "当前状态不可审核通过" });
      }
      const patched = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "pending_payment",
          approved_at: nowIso(),
          approved_by: body.adminId || adminProfile.id || null,
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
          updated_at: nowIso(),
        }),
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
        status: "pending_payment",
        patch: {
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
        },
      });
      // Keep freeze intact until remittance is confirmed. Do NOT deduct / settle freeze here.
      if (row.freeze_tx_id) {
        try {
          await companionDb("transactions", `?id=eq.${encodeURIComponent(row.freeze_tx_id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              note: `提现审核通过，待线下打款 ${row.withdrawal_no || id}`,
            }),
          });
        } catch {
          /* optional */
        }
      }
      try {
        await ensureFinancePayment(
          "companion_withdraw",
          id,
          row.companion_id,
          money(row.net_amount_rm),
          {
            bank_name: row.bank_name,
            account_holder: row.account_holder || row.account_name,
            account_last4: row.account_last4,
          },
          body.adminId
        );
      } catch (payErr) {
        console.warn("[finance] ensureFinancePayment after approve_withdraw:", payErr?.message || payErr);
      }
      await writeAdminLog({
        module: "finance",
        action: "approve_withdraw",
        targetType: "companion_withdrawal",
        targetId: id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        reason: body.reason || "审核通过，进入待打款",
      });
      await insertCompanionNotification({
        companionUserId: row.companion_id,
        category: "withdraw",
        title: "提现审核已通过",
        body: `提现单 ${row.withdrawal_no || id} 已审核通过，金额 RM ${money(row.net_amount_rm)}，等待平台线下打款（预计发放 ${row.settlement_date || ""}）。`,
        href: "/companion/account/",
        noticeKey: `withdraw-approved-${id}`,
      });
      return json(res, 200, {
        ok: true,
        message: "已审核通过，进入待打款（需线下汇款并上传收据后确认）",
        item: viewWithdraw(patched?.[0] || { ...row, status: "pending_payment" }),
      });
    }

    if (action === "start_review_withdraw") {
      const id = String(body.id || body.withdrawalId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少提现单 id" });
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      if (!canStartReview(row.status)) return json(res, 400, { ok: false, message: "当前状态不可开始审核" });
      const patched = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "reviewing",
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
          updated_at: nowIso(),
        }),
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
        status: "reviewing",
      });
      return json(res, 200, { ok: true, message: "已开始审核", item: viewWithdraw(patched?.[0] || { ...row, status: "reviewing" }) });
    }

    if (action === "reject_withdraw") {
      const id = String(body.id || body.withdrawalId || body.withdrawal_id || "").trim();
      if (!id || id === "undefined" || id === "null") {
        return json(res, 400, { ok: false, message: "缺少提现单 id" });
      }
      const reason = String(body.reason || body.reject_reason || "").trim();
      if (!reason) return json(res, 400, { ok: false, message: "请填写驳回原因" });
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      if (!/pending|pending_review|pending_friday|submitted|reviewing|approved|pending_payment|approved_pending_pay|paying|rolled_over/.test(String(row.status || ""))) {
        return json(res, 400, { ok: false, message: "当前状态不可驳回" });
      }
      const amountCat = money(row.cat_food_amount || row.amount);
      const patched = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "rejected",
          reject_reason: reason,
          rejection_reason: reason,
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || null,
          updated_at: nowIso(),
        }),
      });
      // Unfreeze: cancel freeze ledger so amount returns to withdrawable (rejected status unlocks).
      if (row.freeze_tx_id) {
        try {
          await companionDb("transactions", `?id=eq.${encodeURIComponent(row.freeze_tx_id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "cancelled",
              note: `提现驳回解冻 ${row.withdrawal_no || id}：${reason}`,
            }),
          });
        } catch {
          /* optional */
        }
      } else {
        try {
          await companionDb("transactions", "", {
            method: "POST",
            body: JSON.stringify({
              user_id: row.companion_id,
              order_id: null,
              transaction_type: "withdrawal",
              amount: amountCat,
              status: "cancelled",
              note: `提现驳回退回 ${row.withdrawal_no || id}：${reason}`,
              created_at: nowIso(),
            }),
          });
        } catch {
          /* optional ledger */
        }
      }
      await writeAdminLog({
        module: "finance",
        action: "reject_withdraw",
        targetType: "companion_withdrawal",
        targetId: id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        reason,
      });
      await releasePayoutSources(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
        status: "rejected",
        patch: { reject_reason: reason, reviewed_at: nowIso() },
      });
      await insertCompanionNotification({
        companionUserId: row.companion_id,
        category: "withdraw",
        title: "提现申请已驳回",
        body: `提现单 ${row.withdrawal_no || id} 已驳回。原因：${reason}`,
        href: "/companion/account/",
        noticeKey: `withdraw-rejected-${id}-${Date.now()}`,
      });
      return json(res, 200, { ok: true, message: "已驳回，冻结余额已退回可用余额", item: patched?.[0] });
    }

    if (action === "mark_withdraw_paid" || action === "complete_withdraw") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅管理员或财务管理员可确认线下打款并上传收据" });
      }
      const id = String(body.id || body.withdrawalId || body.withdrawal_id || "").trim();
      let bankReference = String(body.bankReference || body.bank_reference || body.reference || "").trim();
      const paymentRemark = String(body.paymentRemark || body.financeNote || body.notes || body.remark || "").trim();
      const receiptDataUrl = String(
        body.receiptDataUrl || body.receipt_url || body.payment_proof || body.paymentProof || body.fileDataUrl || ""
      ).trim();
      const actualAmountRm =
        body.actualAmountRm != null && body.actualAmountRm !== ""
          ? money(body.actualAmountRm)
          : null;
      if (!id || id === "undefined" || id === "null") {
        return json(res, 400, { ok: false, message: "缺少提现单 id" });
      }
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });

      // Idempotent: already completed — do not re-deduct / re-create receipt
      if (String(row.status || "") === "completed") {
        const existingPay = (
          await companionDb(
            "finance_payments",
            `?related_record_id=eq.${encodeURIComponent(id)}&payment_type=eq.companion_withdraw&limit=1`
          ).catch(() => [])
        )?.[0];
        let existingReceipt = null;
        if (existingPay?.id) {
          existingReceipt = (
            await companionDb("finance_receipts", `?payment_id=eq.${encodeURIComponent(existingPay.id)}&limit=1`).catch(
              () => []
            )
          )?.[0];
        }
        return json(res, 200, {
          ok: true,
          message: "该提现已完成，无需重复确认",
          duplicate: true,
          item: viewWithdraw(row),
          receipt: existingReceipt,
        });
      }

      if (!/approved|pending_payment|approved_pending_pay|paying|paid_pending_receipt|paid/.test(String(row.status || ""))) {
        return json(res, 400, { ok: false, message: "仅「待打款」状态可确认已打款" });
      }
      // Bank reference is optional; proof upload is mandatory.
      if (!bankReference) {
        bankReference = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
      }
      if (!receiptDataUrl) {
        return json(res, 400, { ok: false, message: "必须上传汇款收据图片后才能确认已打款" });
      }
      const decoded = decodeDataUrl(receiptDataUrl);
      if (!decoded) return json(res, 400, { ok: false, message: "收据文件格式无效" });
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(decoded.contentType)) {
        return json(res, 400, { ok: false, message: "仅支持 JPG/PNG/WEBP/PDF" });
      }

      await ensurePrivateBucket(FINANCE_BUCKET, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
      const objectPath = buildObjectPath(
        row.companion_id,
        "withdraw-receipts",
        `receipt.${decoded.contentType.includes("pdf") ? "pdf" : "jpg"}`
      );
      await uploadPrivateObject(FINANCE_BUCKET, objectPath, decoded.buffer, decoded.contentType);

      const paidAt =
        body.paidAt || body.paymentDate
          ? new Date(
              `${String(body.paymentDate || body.paidAt).slice(0, 10)}${
                body.paymentTime ? "T" + String(body.paymentTime).slice(0, 8) : "T12:00:00"
              }`
            ).toISOString()
          : nowIso();
      if (Number.isNaN(new Date(paidAt).getTime())) {
        return json(res, 400, { ok: false, message: "打款时间格式无效" });
      }
      async function patchWithdrawal(payload) {
        return companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      let patched = null;
      let payload = {
        status: "completed",
        paid_at: paidAt,
        completed_at: nowIso(),
        bank_reference: bankReference,
        payment_remark: paymentRemark,
        receipt_url: objectPath,
        receipt_file_type: decoded.contentType,
        confirmed_by: body.adminId || adminProfile.id || null,
        paid_by: body.adminId || adminProfile.id || null,
        updated_at: nowIso(),
      };
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          patched = await patchWithdrawal(payload);
          break;
        } catch (patchErr) {
          const msg = `${patchErr?.message || ""} ${JSON.stringify(patchErr?.body || "")}`;
          const m = msg.match(/Could not find the '([^']+)' column/i);
          if (m && m[1] in payload) {
            delete payload[m[1]];
            continue;
          }
          if (isMissingRelation(patchErr)) {
            const note = `[打款收据] bucket=${FINANCE_BUCKET} path=${objectPath} type=${decoded.contentType} ref=${bankReference}`;
            patched = await patchWithdrawal({
              status: "completed",
              paid_at: paidAt,
              completed_at: paidAt,
              updated_at: paidAt,
              remark: `${row.remark ? row.remark + " " : ""}${note}${paymentRemark ? " " + paymentRemark : ""}`,
            });
            break;
          }
          throw patchErr;
        }
      }
      if (!patched?.[0] && !patched) {
        return json(res, 500, { ok: false, message: "更新提现单失败" });
      }

      // Settle freeze once (formal deduct). Do not insert a second withdrawal ledger row if freeze exists.
      const amountCat = money(row.cat_food_amount || row.amount);
      if (row.freeze_tx_id) {
        try {
          await companionDb("transactions", `?id=eq.${encodeURIComponent(row.freeze_tx_id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "completed",
              note: `提现已线下打款完成 ${row.withdrawal_no || id} / ${bankReference}`,
            }),
          });
        } catch {
          /* optional */
        }
      } else {
        try {
          const existed = await companionDb(
            "transactions",
            `?user_id=eq.${encodeURIComponent(row.companion_id)}&transaction_type=eq.withdrawal&note=ilike.*${encodeURIComponent(row.withdrawal_no || id)}*&status=eq.completed&limit=1`
          ).catch(() => []);
          if (!existed?.[0]) {
            await companionDb("transactions", "", {
              method: "POST",
              body: JSON.stringify({
                user_id: row.companion_id,
                transaction_type: "withdrawal",
                amount: amountCat,
                status: "completed",
                note: `提现已线下打款完成 ${row.withdrawal_no || id} / ${bankReference}`,
                created_at: paidAt,
              }),
            });
          }
        } catch {
          /* optional */
        }
      }

      let receiptRow = null;
      try {
        const pay =
          (await ensureFinancePayment(
            "companion_withdraw",
            id,
            row.companion_id,
            money(row.net_amount_rm),
            {
              bank_name: row.bank_name,
              account_holder: row.account_holder || row.account_name,
              account_last4: row.account_last4,
            },
            body.adminId
          )) || null;
        if (pay?.id) {
          const paidAmountRm =
            actualAmountRm != null && actualAmountRm > 0 ? actualAmountRm : money(pay.amount_rm || row.net_amount_rm);
          if (String(pay.status || "") !== "completed") {
            await companionDb("finance_payments", `?id=eq.${encodeURIComponent(pay.id)}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "completed",
                actual_amount_rm: paidAmountRm,
                bank_reference: bankReference,
                finance_note: paymentRemark,
                confirmed_by: body.adminId || null,
                confirmed_at: paidAt,
                updated_at: paidAt,
              }),
            });
          }
          const existingReceipts = await companionDb(
            "finance_receipts",
            `?payment_id=eq.${encodeURIComponent(pay.id)}&limit=1`
          ).catch(() => []);
          if (existingReceipts?.[0]) {
            receiptRow = existingReceipts[0];
          } else {
            const receiptRows = await companionDb("finance_receipts", "", {
              method: "POST",
              body: JSON.stringify({
                receipt_no: no("RCP"),
                payment_id: pay.id,
                storage_bucket: FINANCE_BUCKET,
                file_path: objectPath,
                file_type: decoded.contentType,
                amount_rm: paidAmountRm,
                bank_reference: bankReference,
                accounting_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
                tax_year: String(new Date().getFullYear()),
                accounting_category: "companion_settlement",
                company_name: (await settings()).company_name || "MEOW CUI JIAO ENTERPRISE",
                payment_purpose: "陪玩结算（线下汇款）",
                reconciliation_status: "pending",
                uploaded_by: body.adminId || null,
                uploaded_at: paidAt,
                notes: paymentRemark || `提现单 ${row.withdrawal_no || id}`,
              }),
            });
            receiptRow = receiptRows?.[0] || null;
          }
        }
      } catch (err) {
        console.warn("[finance] receipt bookkeeping:", err?.message || err);
      }

      await writeAdminLog({
        module: "finance",
        action: "mark_withdraw_paid",
        targetType: "companion_withdrawal",
        targetId: id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        reason: `线下打款确认 ${bankReference}`,
        after: { bankReference, receiptPath: objectPath, paymentRemark, paidAt },
      });
      const payeeProfile = (await profileMap([row.companion_id]))[row.companion_id] || {};
      await writePayoutLog({
        payoutType: "companion_withdraw",
        relatedRecordId: id,
        paymentId: (
          await companionDb(
            "finance_payments",
            `?related_record_id=eq.${encodeURIComponent(id)}&payment_type=eq.companion_withdraw&limit=1`
          ).catch(() => [])
        )?.[0]?.id,
        receiptId: receiptRow?.id,
        payeeUserId: row.companion_id,
        payeeName: payeeProfile.display_name || row.account_holder || "",
        payeeUid: payeeProfile.boss_uid || payeeProfile.id || row.companion_id,
        amountRm: money(row.net_amount_rm),
        bankReference,
        receiptPath: objectPath,
        receiptFileType: decoded.contentType,
        notes: paymentRemark,
        adminId: body.adminId || adminProfile.id || null,
        adminName: adminDisplayName(adminProfile),
        adminRole,
        ip: clientIp(req),
        action: "mark_withdraw_paid",
      });
      await insertCompanionNotification({
        companionUserId: row.companion_id,
        category: "withdraw",
        title: "提现已打款完成",
        body: `提现单 ${row.withdrawal_no || id} 已线下打款完成，金额 RM ${money(row.net_amount_rm)}，交易编号 ${bankReference}。`,
        href: "/companion/account/",
        noticeKey: `withdraw-paid-${id}`,
      });
      await settlePayoutSources(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "companion_withdrawals",
        relatedRecordId: id,
        status: "completed",
        patch: {
          paid_at: paidAt,
          transaction_no: bankReference,
          receipt_url: objectPath,
          paid_by: body.adminId || adminProfile.id || null,
        },
      });
      return json(res, 200, {
        ok: true,
        message: "已上传收据并确认打款，提现状态为已完成",
        item: viewWithdraw(
          patched?.[0] || {
            ...row,
            status: "completed",
            bank_reference: bankReference,
            receipt_url: objectPath,
            paid_at: paidAt,
            completed_at: paidAt,
          }
        ),
        receipt: receiptRow,
      });
    }

    if (action === "approve_payroll") {
      const id = String(body.id || "").trim();
      const rows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "工资单不存在" });
      if (!/draft|pending_review|pending_friday|submitted|reviewing|rolled_over|pending/.test(row.status)) {
        return json(res, 400, { ok: false, message: "当前状态不可审核" });
      }
      const patched = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "pending_payment",
          approved_at: nowIso(),
          approved_by: body.adminId || adminProfile.id || null,
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
          updated_at: nowIso(),
        }),
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "staff_payrolls",
        relatedRecordId: id,
        status: "pending_payment",
        patch: { reviewed_at: nowIso(), reviewed_by: body.adminId || adminProfile.id || null },
      });
      const snap = row.payment_account_snapshot || {};
      await ensureFinancePayment("staff_payroll", id, row.staff_id, money(row.net_salary_rm), snap, body.adminId);
      await writeAdminLog({
        module: "finance",
        action: "approve_payroll",
        targetType: "staff_payroll",
        targetId: id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
      });
      await insertStaffNotification({
        staffId: row.staff_id,
        category: "payroll",
        title: "工资单已审核通过",
        body: `工资单 ${row.payroll_no || id}（${row.period_start} ~ ${row.period_end}）已审核通过，应发 RM ${money(row.net_salary_rm)}，等待平台打款（预计 ${row.settlement_date || ""}）。`,
        href: "/customer-service/reports/",
        noticeKey: `payroll-approved-${id}`,
      });
      return json(res, 200, { ok: true, message: "工资已通过，进入待付款", item: patched?.[0] });
    }

    if (action === "start_review_payroll") {
      const id = String(body.id || body.payrollId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少工资单 id" });
      const rows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "工资单不存在" });
      if (!canStartReview(row.status) && !/draft/.test(String(row.status || ""))) {
        return json(res, 400, { ok: false, message: "当前状态不可开始审核" });
      }
      const patched = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "reviewing",
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
          updated_at: nowIso(),
        }),
      });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "staff_payrolls",
        relatedRecordId: id,
        status: "reviewing",
      });
      return json(res, 200, { ok: true, message: "已开始审核", item: patched?.[0] });
    }

    if (action === "reject_payroll") {
      const id = String(body.id || body.payrollId || "").trim();
      const reason = String(body.reason || body.reject_reason || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少工资单 id" });
      if (!reason) return json(res, 400, { ok: false, message: "请填写驳回原因" });
      const rows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "工资单不存在" });
      const patched = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "rejected",
          reject_reason: reason,
          reviewed_at: nowIso(),
          reviewed_by: body.adminId || adminProfile.id || null,
          frozen_amount_rm: 0,
          updated_at: nowIso(),
        }),
      });
      await releasePayoutSources(companionDb, { relatedTable: "staff_payrolls", relatedRecordId: id });
      await syncPayoutRequestStatus(companionDb, {
        relatedTable: "staff_payrolls",
        relatedRecordId: id,
        status: "rejected",
        patch: { reject_reason: reason },
      });
      await insertStaffNotification({
        staffId: row.staff_id,
        category: "payroll",
        title: "工资单已驳回",
        body: `工资单 ${row.payroll_no || id} 已驳回。原因：${reason}`,
        href: "/customer-service/reports/",
        noticeKey: `payroll-rejected-${id}-${Date.now()}`,
      });
      return json(res, 200, { ok: true, message: "已驳回，金额已恢复可申请", item: patched?.[0] });
    }

    if (action === "create_payroll") {
      const staffId = String(body.staffId || body.staff_id || "").trim();
      if (!staffId) return json(res, 400, { ok: false, message: "缺少客服 ID" });
      let base = money(body.baseSalaryRm ?? body.base_salary_rm);
      let bonus = money(body.bonusRm ?? body.bonus_rm);
      let deduction = money(body.deductionRm ?? body.deduction_rm);
      let workDays = Number(body.workDays || body.work_days || 0);
      let fullAttendance = !!body.fullAttendance;
      let receptionCount = Number(body.receptionCount || 0);
      let orderCount = Number(body.orderCount || 0);
      let note = String(body.note || "");
      let periodStart = body.periodStart || body.period_start;
      let periodEnd = body.periodEnd || body.period_end;
      // Auto-fill from attendance / wage estimate when requested or amounts omitted.
      if (body.fromAttendance || body.autoFromAttendance || (base === 0 && bonus === 0 && deduction === 0)) {
        try {
          const workApi = await import("../_customer-service-work.js");
          const draft = await workApi.payrollDraftFromAttendance(staffId, periodStart, periodEnd);
          base = base || money(draft.baseSalaryRm);
          bonus = bonus || money(draft.bonusRm);
          deduction = deduction || money(draft.deductionRm);
          workDays = workDays || Number(draft.workDays || 0);
          fullAttendance = body.fullAttendance != null ? !!body.fullAttendance : !!draft.fullAttendance;
          receptionCount = receptionCount || Number(draft.receptionCount || 0);
          periodStart = periodStart || draft.periodStart;
          periodEnd = periodEnd || draft.periodEnd;
          if (!note) note = draft.note || "";
          if (draft.salary) {
            body._salaryDraft = draft.salary;
          }
        } catch (_) {}
      }
      const salaryDraft = body._salaryDraft || {};
      let commissionRm = money(body.commissionRm ?? body.commission_rm ?? salaryDraft.orderCommission ?? 0);
      let catFoodRewardRm = money(body.catFoodRewardRm ?? body.cat_food_reward_rm ?? 0);
      if (!catFoodRewardRm) {
        catFoodRewardRm = money(await sumDockRewardRm(staffId, periodStart, periodEnd));
      }
      const wageBreakdown = {
        baseSalaryRm: base,
        commissionRm,
        catFoodRewardRm,
        receptionBonus: money(salaryDraft.receptionBonus),
        attendanceBonus: money(salaryDraft.attendanceBonus),
        nightShiftAllowance: money(salaryDraft.nightShiftAllowance),
        otherAdjustment: money(salaryDraft.otherAdjustment),
        deductionRm: deduction,
        netSalaryRm: 0,
      };
      const net =
        money(body.netSalaryRm ?? body.net_salary_rm) ||
        Math.max(0, base + Math.max(bonus, commissionRm) + catFoodRewardRm - deduction);
      wageBreakdown.netSalaryRm = net;
      if (bonus === 0 && (commissionRm || catFoodRewardRm)) {
        bonus = money(commissionRm + money(salaryDraft.receptionBonus) + money(salaryDraft.attendanceBonus) + money(salaryDraft.nightShiftAllowance));
      }
      const insertPayload = {
        payroll_no: await allocateCsPayrollNo(companionDb).catch(() => `CSW${String(Date.now()).slice(-6)}`),
        staff_id: staffId,
        period_start: periodStart,
        period_end: periodEnd,
        work_days: workDays,
        full_attendance: fullAttendance,
        reception_count: receptionCount,
        order_count: orderCount,
        base_salary_rm: base,
        bonus_rm: bonus,
        deduction_rm: deduction,
        net_salary_rm: net,
        commission_rm: commissionRm,
        cat_food_reward_rm: catFoodRewardRm,
        wage_breakdown: wageBreakdown,
        payment_account_snapshot: body.paymentAccount || body.payment_account_snapshot || {},
        status: "pending_friday",
        note,
        settlement_date: computeSettlementDate(new Date(), await settings().catch(() => mergeWeeklySettings({}))),
        submitted_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      let rows = null;
      try {
        rows = await companionDb("staff_payrolls", "", {
          method: "POST",
          body: JSON.stringify(insertPayload),
        });
      } catch (err) {
        // Older schema without wage composition columns
        delete insertPayload.commission_rm;
        delete insertPayload.cat_food_reward_rm;
        delete insertPayload.wage_breakdown;
        delete insertPayload.settlement_date;
        delete insertPayload.submitted_at;
        rows = await companionDb("staff_payrolls", "", {
          method: "POST",
          body: JSON.stringify(insertPayload),
        });
      }
      return json(res, 200, { ok: true, message: "工资单已创建，进入待周五结算", item: rows?.[0] });
    }

    if (action === "mark_paying") {
      let paymentId = String(body.paymentId || body.id || "").trim();
      const relatedId = String(body.withdrawalId || body.payrollId || body.relatedRecordId || "").trim();
      const relatedType = String(body.paymentType || body.type || "").trim();
      if (!paymentId && relatedId) {
        const typeHint =
          relatedType ||
          (body.withdrawalId ? "companion_withdraw" : body.payrollId ? "staff_payroll" : "");
        const q = typeHint
          ? `?related_record_id=eq.${encodeURIComponent(relatedId)}&payment_type=eq.${encodeURIComponent(typeHint)}&limit=1`
          : `?related_record_id=eq.${encodeURIComponent(relatedId)}&limit=1`;
        const found = await companionDb("finance_payments", q).catch(() => []);
        paymentId = found?.[0]?.id || "";
        if (!paymentId && body.withdrawalId) {
          const wRows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(relatedId)}&limit=1`);
          const w = wRows?.[0];
          if (w) {
            const pay = await ensureFinancePayment(
              "companion_withdraw",
              relatedId,
              w.companion_id,
              money(w.net_amount_rm),
              { bank_name: w.bank_name, account_holder: w.account_holder, account_last4: w.account_last4 },
              body.adminId
            );
            paymentId = pay?.id || "";
          }
        }
        if (!paymentId && body.payrollId) {
          const pRows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(relatedId)}&limit=1`);
          const p = pRows?.[0];
          if (p) {
            const pay = await ensureFinancePayment(
              "staff_payroll",
              relatedId,
              p.staff_id,
              money(p.net_salary_rm),
              p.payment_account_snapshot || {},
              body.adminId
            );
            paymentId = pay?.id || "";
          }
        }
      }
      const rows = await companionDb("finance_payments", `?id=eq.${encodeURIComponent(paymentId)}&limit=1`);
      const pay = rows?.[0];
      if (!pay) return json(res, 404, { ok: false, message: "付款单不存在" });
      await companionDb("finance_payments", `?id=eq.${encodeURIComponent(paymentId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paying", updated_at: nowIso() }),
      });
      const table = pay.payment_type === "staff_payroll" ? "staff_payrolls" : "companion_withdrawals";
      await companionDb(table, `?id=eq.${encodeURIComponent(pay.related_record_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paying", updated_at: nowIso() }),
      }).catch(() => null);
      await writeAdminLog({
        module: "finance",
        action: "mark_paying",
        targetType: pay.payment_type,
        targetId: pay.related_record_id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
      });
      return json(res, 200, { ok: true, message: "已标记为打款中" });
    }

    if (action === "reveal_account") {
      if (!canReveal(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可查看完整账号" });
      }
      const accountId = String(body.paymentAccountId || body.accountId || "").trim();
      const withdrawalId = String(body.withdrawalId || body.id || body.withdrawal_id || "").trim();
      const rows = await companionDb("companion_payment_accounts", `?id=eq.${encodeURIComponent(accountId)}&limit=1`);
      const acc = rows?.[0];
      if (!acc) return json(res, 404, { ok: false, message: "结款账户不存在" });

      let withdrawal = null;
      let companionName = "";
      let companionCode = "";
      if (withdrawalId) {
        const wdRows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(withdrawalId)}&limit=1`).catch(
          () => []
        );
        withdrawal = wdRows?.[0] || null;
      }
      if (!withdrawal && accountId) {
        const wdByAcc = await companionDb(
          "companion_withdrawals",
          `?payment_account_id=eq.${encodeURIComponent(accountId)}&order=created_at.desc&limit=1`
        ).catch(() => []);
        withdrawal = wdByAcc?.[0] || null;
      }
      const companionIdFromWd = String(withdrawal?.companion_id || "").trim();
      let companionId = companionIdFromWd;
      if (!companionId) {
        const cpId = String(acc.companion_profile_id || acc.companion_id || "").trim();
        if (cpId) {
          const cpRows = await companionDb(
            "companion_profiles",
            `?id=eq.${encodeURIComponent(cpId)}&select=id,user_id,nickname&limit=1`
          ).catch(() => []);
          companionId = String(cpRows?.[0]?.user_id || "").trim();
        }
      }
      if (companionId) {
        const profiles = await profileMap([companionId]);
        const profile = profiles[companionId] || {};
        const cp = (
          await companionDb(
            "companion_profiles",
            `?user_id=eq.${encodeURIComponent(companionId)}&select=user_id,nickname&limit=1`
          ).catch(() => [])
        )?.[0];
        companionName = String(cp?.nickname || profile.display_name || profile.email || "").trim();
        companionCode = resolveCompanionPublicCode(cp || {}, profile) || profile.boss_uid || "";
      }

      await writeAdminLog({
        module: "finance",
        action: "reveal_bank_account",
        targetType: "companion_payment_account",
        targetId: accountId,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        reason: body.reason || `查看完整银行账号${withdrawal?.withdrawal_no ? " " + withdrawal.withdrawal_no : ""}`,
        after: {
          withdrawalNo: withdrawal?.withdrawal_no || "",
          withdrawalId: withdrawal?.id || withdrawalId || "",
          viewedAt: nowIso(),
        },
      });

      return json(res, 200, {
        ok: true,
        account: {
          id: acc.id,
          bankName: acc.bank_name || withdrawal?.bank_name || "",
          accountHolder: acc.account_name || withdrawal?.account_holder || "",
          accountNumber: acc.bank_account || "",
          accountLast4: acc.account_last4 || maskBankAccount(acc.bank_account).slice(-4),
          status: acc.status,
        },
        withdrawal: withdrawal
          ? {
              id: withdrawal.id,
              withdrawalNo: withdrawal.withdrawal_no || "",
              companionId,
              companionName,
              companionUid: companionCode,
              companionCode,
              netAmountRm: money(withdrawal.net_amount_rm),
              catFoodAmount: money(withdrawal.cat_food_amount),
              status: withdrawal.status,
              statusText: WITHDRAW_STATUS[withdrawal.status] || withdrawal.status,
              submittedAt: withdrawal.submitted_at || withdrawal.created_at || "",
            }
          : {
              companionId,
              companionName,
              companionUid: companionCode,
              companionCode,
            },
      });
    }

    if (action === "upload_receipt_and_confirm") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅管理员或财务管理员可确认线下打款并上传收据" });
      }
      const paymentId = String(body.paymentId || "").trim();
      const bankReference = String(body.bankReference || body.bank_reference || "").trim();
      const paymentDate = String(body.paymentDate || body.payment_date || "").trim();
      const fileData = String(body.fileDataUrl || body.file || "").trim();
      if (!paymentId) return json(res, 400, { ok: false, message: "缺少付款单" });
      if (!bankReference) return json(res, 400, { ok: false, message: "请填写银行交易编号" });
      if (!paymentDate) return json(res, 400, { ok: false, message: "请填写付款日期" });
      if (!fileData) return json(res, 400, { ok: false, message: "必须上传转账收据，不能无收据完成付款" });

      const decoded = decodeDataUrl(fileData);
      if (!decoded) return json(res, 400, { ok: false, message: "收据文件格式无效" });
      const allowed = /^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(decoded.contentType);
      if (!allowed) return json(res, 400, { ok: false, message: "仅支持 JPG/PNG/WEBP/PDF" });

      const pays = await companionDb("finance_payments", `?id=eq.${encodeURIComponent(paymentId)}&limit=1`);
      const pay = pays?.[0];
      if (!pay) return json(res, 404, { ok: false, message: "付款单不存在" });
      if (pay.status === "completed") {
        return json(res, 200, {
          ok: true,
          message: "该付款已完成，无需重复确认",
          duplicate: true,
          receipt: (
            await companionDb("finance_receipts", `?payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`).catch(() => [])
          )?.[0],
        });
      }

      const actual = body.actualAmountRm != null ? money(body.actualAmountRm) : money(pay.amount_rm);
      const varianceReason = String(body.varianceReason || "").trim();
      if (Math.abs(actual - money(pay.amount_rm)) > 0.009 && !varianceReason) {
        return json(res, 400, { ok: false, message: "实付与应付不一致时必须填写差异原因" });
      }

      // Companion withdraw: prefer unified mark_withdraw_paid path semantics
      if (pay.payment_type === "companion_withdraw" && pay.related_record_id) {
        const wdRows = await companionDb(
          "companion_withdrawals",
          `?id=eq.${encodeURIComponent(pay.related_record_id)}&limit=1`
        );
        const wd = wdRows?.[0];
        if (wd && String(wd.status || "") === "completed") {
          return json(res, 200, {
            ok: true,
            message: "该提现已完成，无需重复确认",
            duplicate: true,
            receipt: (
              await companionDb("finance_receipts", `?payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`).catch(
                () => []
              )
            )?.[0],
          });
        }
      }

      await ensurePrivateBucket(FINANCE_BUCKET, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
      const objectPath = buildObjectPath(pay.payee_user_id, "receipts", `receipt.${decoded.contentType.includes("pdf") ? "pdf" : "jpg"}`);
      await uploadPrivateObject(FINANCE_BUCKET, objectPath, decoded.buffer, decoded.contentType);

      const d = new Date(paymentDate);
      const accountingMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const taxYear = String(d.getFullYear());

      const existingReceipts = await companionDb(
        "finance_receipts",
        `?payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`
      ).catch(() => []);
      let receiptRows = existingReceipts;
      if (!existingReceipts?.[0]) {
        receiptRows = await companionDb("finance_receipts", "", {
          method: "POST",
          body: JSON.stringify({
            receipt_no: no("RCP"),
            payment_id: paymentId,
            storage_bucket: FINANCE_BUCKET,
            file_path: objectPath,
            file_type: decoded.contentType,
            amount_rm: actual,
            bank_reference: bankReference,
            accounting_month: accountingMonth,
            tax_year: taxYear,
            accounting_category: pay.payment_type === "staff_payroll" ? "staff_salary" : "companion_settlement",
            company_name: (await settings()).company_name || "MEOW CUI JIAO ENTERPRISE",
            payment_purpose: pay.payment_type === "staff_payroll" ? "客服工资" : "陪玩结算（线下汇款）",
            reconciliation_status: Math.abs(actual - money(pay.amount_rm)) > 0.009 ? "variance" : "pending",
            uploaded_by: body.adminId || null,
            uploaded_at: nowIso(),
            notes: String(body.financeNote || body.notes || ""),
          }),
        });
      }

      await companionDb("finance_payments", `?id=eq.${encodeURIComponent(paymentId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          actual_amount_rm: actual,
          variance_reason: varianceReason,
          bank_reference: bankReference,
          payer_bank: String(body.payerBank || ""),
          payer_account_last4: String(body.payerAccountLast4 || ""),
          payment_date: paymentDate,
          payment_time: body.paymentTime || null,
          finance_note: String(body.financeNote || ""),
          confirmed_by: body.adminId || null,
          confirmed_at: nowIso(),
          updated_at: nowIso(),
        }),
      });

      const table = pay.payment_type === "staff_payroll" ? "staff_payrolls" : "companion_withdrawals";
      const relatedPatch =
        pay.payment_type === "companion_withdraw"
          ? {
              status: "completed",
              paid_at: nowIso(),
              completed_at: nowIso(),
              bank_reference: bankReference,
              payment_remark: String(body.financeNote || body.notes || ""),
              receipt_url: objectPath,
              receipt_file_type: decoded.contentType,
              updated_at: nowIso(),
            }
          : {
              status: "completed",
              paid_at: nowIso(),
              completed_at: nowIso(),
              bank_reference: bankReference,
              receipt_url: objectPath,
              confirmed_by: body.adminId || adminProfile.id || null,
              updated_at: nowIso(),
            };
      try {
        await companionDb(table, `?id=eq.${encodeURIComponent(pay.related_record_id)}`, {
          method: "PATCH",
          body: JSON.stringify(relatedPatch),
        });
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
        await companionDb(table, `?id=eq.${encodeURIComponent(pay.related_record_id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            paid_at: nowIso(),
            completed_at: nowIso(),
            updated_at: nowIso(),
          }),
        }).catch(() => null);
      }

      if (pay.payment_type === "companion_withdraw") {
        try {
          const w = (
            await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(pay.related_record_id)}&limit=1`)
          )?.[0];
          if (w?.freeze_tx_id) {
            await companionDb("transactions", `?id=eq.${encodeURIComponent(w.freeze_tx_id)}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "completed",
                note: `提现已线下打款完成 ${w.withdrawal_no || w.id} / ${bankReference}`,
              }),
            });
          } else if (w) {
            const existed = await companionDb(
              "transactions",
              `?user_id=eq.${encodeURIComponent(w.companion_id)}&transaction_type=eq.withdrawal&status=eq.completed&limit=5`
            ).catch(() => []);
            const hasMarker = (existed || []).some((t) =>
              String(t.note || "").includes(String(w.withdrawal_no || w.id))
            );
            if (!hasMarker) {
              await companionDb("transactions", "", {
                method: "POST",
                body: JSON.stringify({
                  user_id: w.companion_id,
                  transaction_type: "withdrawal",
                  amount: money(w.cat_food_amount),
                  status: "completed",
                  note: `提现已线下打款完成 ${w.withdrawal_no} / ${bankReference}`,
                  created_at: nowIso(),
                }),
              });
            }
          }
        } catch {
          /* optional */
        }
      }

      await writeAdminLog({
        module: "finance",
        action: "confirm_payment_with_receipt",
        targetType: "finance_payment",
        targetId: paymentId,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        after: { bankReference, actual, receiptId: receiptRows?.[0]?.id },
      });

      const payeeProfile = (await profileMap([pay.payee_user_id]))[pay.payee_user_id] || {};
      await writePayoutLog({
        payoutType: pay.payment_type,
        relatedRecordId: pay.related_record_id,
        paymentId,
        receiptId: receiptRows?.[0]?.id,
        payeeUserId: pay.payee_user_id,
        payeeName: pay.payee_name || payeeProfile.display_name || "",
        payeeUid: payeeProfile.boss_uid || payeeProfile.id || pay.payee_user_id,
        amountRm: actual,
        bankReference,
        receiptPath: objectPath,
        receiptFileType: decoded.contentType,
        notes: String(body.financeNote || body.notes || ""),
        adminId: body.adminId || adminProfile.id || null,
        adminName: adminDisplayName(adminProfile),
        adminRole,
        ip: clientIp(req),
        action: "confirm_payment_with_receipt",
      });

      if (pay.payment_type === "companion_withdraw") {
        await insertCompanionNotification({
          companionUserId: pay.payee_user_id,
          category: "withdraw",
          title: "提现已打款完成",
          body: `提现已线下打款完成，金额 RM ${actual}，交易编号 ${bankReference}。`,
          href: "/companion/account/",
          noticeKey: `withdraw-paid-${pay.related_record_id}`,
        });
      }
      if (pay.payment_type === "staff_payroll") {
        await insertStaffNotification({
          staffId: pay.payee_user_id,
          category: "payroll",
          title: "工资已发放",
          body: `工资单已线下发放完成，金额 RM ${actual}，交易编号 ${bankReference}。`,
          href: "/customer-service/reports/",
          noticeKey: `payroll-paid-${pay.related_record_id}`,
        });
      }

      return json(res, 200, {
        ok: true,
        message: "已上传收据并确认线下付款完成",
        receipt: receiptRows?.[0] || null,
      });
    }

    if (action === "receipt_signed_url") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可查看财务收据" });
      }
      const id = String(body.id || body.receiptId || "").trim();
      const rows = await companionDb("finance_receipts", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const r = rows?.[0];
      if (!r) return json(res, 404, { ok: false, message: "收据不存在" });
      const url = await createSignedUrl(r.storage_bucket || FINANCE_BUCKET, r.file_path, 300);
      await writeAdminLog({
        module: "finance",
        action: "view_receipt",
        targetType: "finance_receipt",
        targetId: id,
        operatorRole: adminRole,
      });
      return json(res, 200, { ok: true, url, expiresIn: 300 });
    }

    if (action === "mark_receipt") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可标记对账/归档" });
      }
      const id = String(body.id || "").trim();
      const status = String(body.reconciliationStatus || body.status || "").trim();
      if (!/^(pending|reconciled|variance|archived|void)$/.test(status)) {
        return json(res, 400, { ok: false, message: "无效对账状态" });
      }
      if (status === "void" && !String(body.voidReason || "").trim()) {
        return json(res, 400, { ok: false, message: "作废必须填写原因" });
      }
      const patch = {
        reconciliation_status: status,
        handed_to_accountant: body.handedToAccountant === true ? true : undefined,
        accountant_note: body.accountantNote != null ? String(body.accountantNote) : undefined,
        void_reason: status === "void" ? String(body.voidReason || "") : undefined,
        notes: body.notes != null ? String(body.notes) : undefined,
      };
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
      const rows = await companionDb("finance_receipts", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await writeAdminLog({
        module: "finance",
        action: "mark_receipt",
        targetType: "finance_receipt",
        targetId: id,
        operatorRole: adminRole,
        after: patch,
      });
      return json(res, 200, { ok: true, message: "收据状态已更新", item: rows?.[0] });
    }

    if (action === "export_month") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可导出财务数据" });
      }
      const month = String(body.month || req.query?.month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return json(res, 400, { ok: false, message: "请提供月份，例如 2026-07" });
      const receipts = await companionDb("finance_receipts", `?accounting_month=eq.${encodeURIComponent(month)}&order=uploaded_at.asc&limit=2000`);
      const paymentIds = [...new Set((receipts || []).map((r) => r.payment_id).filter(Boolean))];
      let payments = [];
      if (paymentIds.length) {
        payments = await companionDb("finance_payments", `?id=in.(${paymentIds.map(encodeURIComponent).join(",")})`);
      }
      const payMap = (payments || []).reduce((m, p) => {
        m[p.id] = p;
        return m;
      }, {});
      const profiles = await profileMap((payments || []).map((p) => p.payee_user_id));
      const rows = (receipts || []).map((r) => {
        const p = payMap[r.payment_id] || {};
        const u = profiles[p.payee_user_id] || {};
        return {
          receiptNo: r.receipt_no,
          paymentNo: p.payment_no || "",
          paymentType: p.payment_type || "",
          payee: p.payee_name || u.display_name || "",
          payeeUid: u.boss_uid || u.id || "",
          amountRm: money(r.amount_rm),
          bankReference: r.bank_reference || "",
          accountingMonth: r.accounting_month,
          taxYear: r.tax_year,
          category: r.accounting_category,
          reconciliation: r.reconciliation_status,
          uploadedAt: r.uploaded_at,
        };
      });
      const total = rows.reduce((n, r) => n + money(r.amountRm), 0);
      await writeAdminLog({
        module: "finance",
        action: "export_month",
        targetType: "finance_receipts",
        targetId: month,
        operatorRole: adminRole,
      });
      return json(res, 200, {
        ok: true,
        month,
        totalRm: total,
        count: rows.length,
        rows,
        csv:
          "收据编号,付款单号,类型,收款人,UID,金额RM,银行流水号,会计月,报税年,分类,对账状态,上传时间\n" +
          rows
            .map((r) =>
              [r.receiptNo, r.paymentNo, r.paymentType, r.payee, r.payeeUid, r.amountRm, r.bankReference, r.accountingMonth, r.taxYear, r.category, r.reconciliation, r.uploadedAt]
                .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
                .join(",")
            )
            .join("\n"),
      });
    }

    if (action === "delete_receipt") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅管理员或财务管理员可删除收据" });
      }
      const id = String(body.id || body.receiptId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少收据 id" });
      const rows = await companionDb("finance_receipts", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const r = rows?.[0];
      if (!r) return json(res, 404, { ok: false, message: "收据不存在" });
      if (r.file_path) {
        try {
          await deleteStorageObject(r.storage_bucket || FINANCE_BUCKET, r.file_path);
        } catch (err) {
          console.warn("[finance] delete receipt file:", err?.message || err);
        }
      }
      await companionDb("finance_receipts", `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await writeAdminLog({
        module: "finance",
        action: "delete_receipt",
        targetType: "finance_receipt",
        targetId: id,
        operatorId: body.adminId || adminProfile.id || null,
        operatorRole: adminRole,
        reason: body.reason || "删除收据",
        before: { receiptNo: r.receipt_no, filePath: r.file_path },
      });
      return json(res, 200, { ok: true, message: "收据已删除（打款日志仍保留且不可改）" });
    }

    if (action === "upload_library_receipt") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅管理员或财务管理员可上传收据" });
      }
      const fileData = String(body.fileDataUrl || body.file || "").trim();
      const bankReference = String(body.bankReference || "").trim();
      const amountRm = money(body.amountRm);
      if (!fileData) return json(res, 400, { ok: false, message: "请上传收据文件" });
      const decoded = decodeDataUrl(fileData);
      if (!decoded) return json(res, 400, { ok: false, message: "收据文件格式无效" });
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(decoded.contentType)) {
        return json(res, 400, { ok: false, message: "仅支持 JPG/PNG/WEBP/PDF" });
      }
      await ensurePrivateBucket(FINANCE_BUCKET, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
      const objectPath = buildObjectPath(body.adminId || adminProfile.id || "admin", "library", `receipt.${decoded.contentType.includes("pdf") ? "pdf" : "jpg"}`);
      await uploadPrivateObject(FINANCE_BUCKET, objectPath, decoded.buffer, decoded.contentType);
      const d = new Date();
      const paymentRows = await companionDb("finance_payments", "", {
        method: "POST",
        body: JSON.stringify({
          payment_no: no("PAYOUT"),
          payment_type: "other",
          related_record_id: body.adminId || adminProfile.id,
          payee_user_id: body.payeeUserId || body.adminId || adminProfile.id,
          amount_rm: amountRm,
          bank_reference: bankReference,
          payee_name: String(body.payeeName || "收据库上传"),
          status: "completed",
          created_by: body.adminId || adminProfile.id || null,
          confirmed_by: body.adminId || adminProfile.id || null,
          confirmed_at: nowIso(),
          finance_note: String(body.notes || "收据库手动上传"),
          created_at: nowIso(),
          updated_at: nowIso(),
        }),
      });
      const paymentId = paymentRows?.[0]?.id;
      const receiptRows = await companionDb("finance_receipts", "", {
        method: "POST",
        body: JSON.stringify({
          receipt_no: no("RCP"),
          payment_id: paymentId,
          storage_bucket: FINANCE_BUCKET,
          file_path: objectPath,
          file_type: decoded.contentType,
          amount_rm: amountRm,
          bank_reference: bankReference,
          accounting_month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          tax_year: String(d.getFullYear()),
          accounting_category: "manual_library",
          company_name: (await settings()).company_name || "MEOW CUI JIAO ENTERPRISE",
          payment_purpose: "收据库手动上传",
          reconciliation_status: "pending",
          uploaded_by: body.adminId || adminProfile.id || null,
          uploaded_at: nowIso(),
          notes: String(body.notes || ""),
        }),
      });
      return json(res, 200, { ok: true, message: "收据已上传到收据库", receipt: receiptRows?.[0] });
    }

    if (action === "view_withdraw_detail") {
      const id = String(body.id || body.withdrawalId || "").trim();
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      const profiles = await profileMap([row.companion_id, row.approved_by, row.reviewed_by, row.confirmed_by, row.paid_by]);
      let account = {};
      if (row.payment_account_id) {
        account =
          (
            await companionDb("companion_payment_accounts", `?id=eq.${encodeURIComponent(row.payment_account_id)}&limit=1`).catch(
              () => []
            )
          )?.[0] || {};
      }
      const pay = (
        await companionDb(
          "finance_payments",
          `?related_record_id=eq.${encodeURIComponent(id)}&payment_type=eq.companion_withdraw&limit=1`
        ).catch(() => [])
      )?.[0];
      let receipt = null;
      if (pay?.id) {
        receipt = (await companionDb("finance_receipts", `?payment_id=eq.${encodeURIComponent(pay.id)}&limit=1`).catch(() => []))?.[0];
      }
      return json(res, 200, {
        ok: true,
        item: viewWithdraw(row, profiles[row.companion_id], account, profiles),
        payment: pay ? viewPayment(pay, profiles[pay.payee_user_id]) : null,
        receipt: receipt ? viewReceipt(receipt, pay || {}, profiles[row.companion_id], { withdrawalNo: row.withdrawal_no }) : null,
      });
    }

    if (action === "view_payroll_detail") {
      const id = String(body.id || body.payrollId || "").trim();
      const rows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "工资单不存在" });
      const profiles = await profileMap([row.staff_id, row.approved_by, row.confirmed_by]);
      let item = viewPayroll(row, profiles[row.staff_id], profiles);
      if (!item.catFoodRewardRm) {
        const dock = money(await sumDockRewardRm(row.staff_id, row.period_start, row.period_end));
        item = {
          ...item,
          catFoodRewardRm: dock,
          wageBreakdown: { ...item.wageBreakdown, catFoodRewardRm: dock },
        };
      }
      const pay = (
        await companionDb(
          "finance_payments",
          `?related_record_id=eq.${encodeURIComponent(id)}&payment_type=eq.staff_payroll&limit=1`
        ).catch(() => [])
      )?.[0];
      return json(res, 200, {
        ok: true,
        item,
        payment: pay ? viewPayment(pay, profiles[pay.payee_user_id]) : null,
      });
    }

    // ── Friday settlement center: boss refunds ─────────────────────
    if (action === "add_refund_to_batch") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作批次" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.addRefundToBatch(companionDb, String(body.id || body.refundId || ""));
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "rollover_refund" || action === "move_refund_next_week") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可顺延" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.rolloverRefundToNextWeek(
        companionDb,
        String(body.id || body.refundId || ""),
        String(body.reason || "移至下周结算")
      );
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "mark_refund_paid" || action === "complete_boss_refund") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可确认打款" });
      }
      const refundId = String(body.id || body.refundId || "").trim();
      const bankReference = String(body.bankReference || body.transactionNo || "").trim();
      const dataUrl = String(body.receiptDataUrl || body.fileDataUrl || "").trim();
      if (!refundId) return json(res, 400, { ok: false, message: "缺少退款 id" });
      if (!bankReference) return json(res, 400, { ok: false, message: "必须填写银行参考号" });
      if (!dataUrl) return json(res, 400, { ok: false, message: "没有上传打款凭证，不允许标记完成" });

      const decoded = decodeDataUrl(dataUrl);
      if (!decoded?.buffer?.length) return json(res, 400, { ok: false, message: "凭证文件无效" });
      const bucket = "finance-receipts";
      await ensurePrivateBucket(bucket);
      const parts = new Date().toISOString().slice(0, 10).split("-");
      const objectPath = `payout-receipts/${parts[0]}/W/${refundId}-${Date.now()}.${
        (decoded.contentType || "image/jpeg").includes("png") ? "png" : "jpg"
      }`;
      await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType || "image/jpeg");

      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.completeBossRefundPayout(companionDb, {
        refundId,
        paidAmount: body.paidAmount != null ? body.paidAmount : body.amount,
        bankReference,
        paidAt: body.paidAt || nowIso(),
        receiptBucket: bucket,
        receiptPath: objectPath,
        adminId: adminProfile.id,
        adminName: adminProfile.display_name || adminProfile.email || "",
      });
      if (!result.ok) return json(res, 400, result);

      await writePayoutLog({
        payoutType: "boss_refund",
        relatedRecordId: refundId,
        payeeUserId: result.refund?.bossId,
        payeeName: result.refund?.bossName,
        payeeUid: result.refund?.bossUid,
        amountRm: result.refund?.paidAmountRm || result.refund?.amountRm,
        bankReference,
        receiptPath: objectPath,
        notes: String(body.notes || ""),
        adminId: adminProfile.id,
        adminName: adminProfile.display_name || "",
        adminRole,
        action: "mark_refund_paid",
      });
      await writeAdminLog({
        module: "finance",
        action: "mark_refund_paid",
        targetType: "boss_refund_requests",
        targetId: refundId,
        operatorRole: adminRole,
      });
      return json(res, 200, result);
    }

    if (action === "export_settlement") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可导出结算报账" });
      }
      const year = String(body.year || "").trim();
      const month = String(body.month || "").trim();
      const week = String(body.week || body.weekNumber || "").trim();
      const type = String(body.type || body.payoutType || "all").trim();
      const refundApi = await import("../_boss-refund-payout.js");
      const [refunds, withdrawals, payrolls] = await Promise.all([
        refundApi.listBossRefunds(companionDb, { limit: 2000 }),
        companionDb("companion_withdrawals", "?order=submitted_at.desc&limit=2000").catch(() => []),
        companionDb("staff_payrolls", "?order=created_at.desc&limit=2000").catch(() => []),
      ]);
      const { isoWeekParts } = await import("../_weekly-settlement.js");
      const matchPeriod = (iso) => {
        const s = String(iso || "").slice(0, 10);
        if (year && month) {
          const ym = `${year}-${String(month).padStart(2, "0")}`;
          if (!s.startsWith(ym)) return false;
        } else if (year && !s.startsWith(year)) {
          return false;
        }
        if (week) {
          try {
            const { weekNumber } = isoWeekParts(s || `${year}-01-01`);
            if (String(weekNumber) !== String(Number(week))) return false;
          } catch {
            return true;
          }
        }
        return true;
      };
      const rows = [];
      if (type === "all" || type === "boss_refund" || type === "refund") {
        for (const r of refunds || []) {
          if (r.status !== "paid") continue;
          if (!matchPeriod(r.paidAt || r.createdAt)) continue;
          rows.push({
            type: "老板退款",
            payoutNo: r.refundNo,
            userNo: r.bossUid,
            userName: r.bossName,
            amountRm: money(r.paidAmountRm || r.amountRm),
            status: r.statusText,
            settledAt: r.paidAt || "",
            bankReference: r.bankReference || "",
            detail: r.orderNo || "",
          });
        }
      }
      if (type === "all" || type === "companion_wage" || type === "withdraw") {
        for (const r of withdrawals || []) {
          if (!/paid|completed/i.test(String(r.status))) continue;
          if (!matchPeriod(r.paid_at || r.completed_at || r.submitted_at)) continue;
          rows.push({
            type: "陪玩工资",
            payoutNo: r.withdrawal_no,
            userNo: r.companion_id,
            userName: "",
            amountRm: money(r.net_amount_rm),
            status: statusText(r.status),
            settledAt: r.paid_at || r.completed_at || "",
            bankReference: r.bank_reference || r.transaction_no || "",
            detail: "",
          });
        }
      }
      if (type === "all" || type === "cs_wage" || type === "payroll") {
        for (const r of payrolls || []) {
          if (!/paid|completed/i.test(String(r.status))) continue;
          if (!matchPeriod(r.paid_at || r.completed_at || r.created_at)) continue;
          rows.push({
            type: "客服工资",
            payoutNo: r.payroll_no,
            userNo: r.staff_id,
            userName: "",
            amountRm: money(r.net_salary_rm),
            status: statusText(r.status),
            settledAt: r.paid_at || r.completed_at || "",
            bankReference: r.bank_reference || r.transaction_no || "",
            detail: "",
          });
        }
      }
      const totalRm = rows.reduce((n, r) => n + money(r.amountRm), 0);
      const ym = year && month ? `${year}_${String(month).padStart(2, "0")}` : year || "ALL";
      const fileBase = `MeowCuiJiao_Settlement_${ym}${week ? `_W${week}` : ""}`;
      const csv =
        "类型,结算编号,用户编号,用户姓名,金额RM,状态,打款时间,银行参考号,明细\n" +
        rows
          .map((r) =>
            [r.type, r.payoutNo, r.userNo, r.userName, r.amountRm, r.status, r.settledAt, r.bankReference, r.detail]
              .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
              .join(",")
          )
          .join("\n");
      return json(res, 200, {
        ok: true,
        fileBase,
        count: rows.length,
        totalRm,
        rows,
        csv,
        // PDF 导出延后至 V1.1；本轮仅 CSV/Excel（CSV 内容可被 Excel 打开）
        formats: ["csv", "xlsx_via_csv"],
      });
    }

    if (action === "mark_refund_processing") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.markRefundProcessing(companionDb, String(body.id || body.refundId || ""));
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "mark_refund_failed") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.markRefundFailed(
        companionDb,
        String(body.id || body.refundId || ""),
        String(body.reason || "打款失败")
      );
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "add_withdraw_to_batch" || action === "add_companion_wage_to_batch") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作批次" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.addWageToBatch(companionDb, {
        kind: "companion_wage",
        id: String(body.id || body.withdrawalId || ""),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "add_payroll_to_batch" || action === "add_cs_wage_to_batch") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作批次" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.addWageToBatch(companionDb, {
        kind: "cs_wage",
        id: String(body.id || body.payrollId || ""),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "rollover_withdraw" || action === "move_withdraw_next_week") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可顺延" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.rolloverWageToNextWeek(companionDb, {
        kind: "companion_wage",
        id: String(body.id || body.withdrawalId || ""),
        reason: String(body.reason || "移至下周结算"),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "rollover_payroll" || action === "move_payroll_next_week") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可顺延" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.rolloverWageToNextWeek(companionDb, {
        kind: "cs_wage",
        id: String(body.id || body.payrollId || ""),
        reason: String(body.reason || "移至下周结算"),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "mark_withdraw_failed") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.markWageFailed(companionDb, {
        kind: "companion_wage",
        id: String(body.id || body.withdrawalId || ""),
        reason: String(body.reason || "打款失败"),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (action === "mark_payroll_failed") {
      if (!canConfirmPay(adminProfile)) {
        return json(res, 403, { ok: false, message: "仅财务管理员可操作" });
      }
      const refundApi = await import("../_boss-refund-payout.js");
      const result = await refundApi.markWageFailed(companionDb, {
        kind: "cs_wage",
        id: String(body.id || body.payrollId || ""),
        reason: String(body.reason || "打款失败"),
      });
      if (!result.ok) return json(res, 400, result);
      return json(res, 200, result);
    }

    return json(res, 400, { ok: false, message: "未知财务操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/finance-payouts.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "财务接口异常" });
  }
}
