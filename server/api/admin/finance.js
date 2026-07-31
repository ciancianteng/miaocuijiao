import {
  companionDb,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  isMissingRelation,
  maskBankAccount,
  uploadPrivateObject,
  buildObjectPath,
} from "../_companion-media-store.js";
import { writeAdminLog } from "../_wallet.js";

const FINANCE_BUCKET = "finance-receipts";
const FINANCE_ROLES = new Set(["admin", "super_admin", "finance_admin"]);
const REVEAL_ROLES = new Set(["super_admin", "finance_admin"]);

const WITHDRAW_STATUS = {
  pending_review: "待审核",
  approved_pending_pay: "已批准",
  rejected: "已拒绝",
  paying: "付款处理中",
  paid_pending_receipt: "已批准待确认",
  completed: "已打款",
  pay_failed: "付款失败",
  cancelled: "已撤销",
};

const PAYROLL_STATUS = { ...WITHDRAW_STATUS, draft: "草稿" };

function json(res, status, data) {
  res.status(status).json(data);
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

function canFinance(req) {
  return FINANCE_ROLES.has(roleFrom(req));
}

function canReveal(req) {
  const role = roleFrom(req);
  return REVEAL_ROLES.has(role);
}

function canConfirmPay(req) {
  return canReveal(req);
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
    return (
      rows?.[0] || {
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 3,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
        company_name: "MEOW CUI JIAO ENTERPRISE",
      }
    );
  } catch (e) {
    if (isMissingRelation(e)) {
      return {
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 3,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
        company_name: "MEOW CUI JIAO ENTERPRISE",
      };
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

function viewWithdraw(row, profile = {}, account = {}) {
  return {
    id: row.id,
    withdrawalNo: row.withdrawal_no,
    companionId: row.companion_id,
    companionUid: profile.boss_uid || profile.id || row.companion_id,
    companionName: profile.display_name || profile.email || "-",
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
    status: row.status,
    statusText: WITHDRAW_STATUS[row.status] || row.status,
    rejectReason: row.reject_reason || "",
    submittedAt: row.submitted_at || row.created_at,
    approvedAt: row.approved_at || "",
    paidAt: row.paid_at || "",
    completedAt: row.completed_at || "",
    paymentAccountId: row.payment_account_id || "",
  };
}

function viewPayroll(row, profile = {}) {
  const snap = row.payment_account_snapshot || {};
  return {
    id: row.id,
    payrollNo: row.payroll_no,
    staffId: row.staff_id,
    staffUid: profile.id || row.staff_id,
    staffName: profile.display_name || profile.email || "-",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    workDays: row.work_days || 0,
    fullAttendance: !!row.full_attendance,
    receptionCount: row.reception_count || 0,
    orderCount: row.order_count || 0,
    baseSalaryRm: money(row.base_salary_rm),
    bonusRm: money(row.bonus_rm),
    deductionRm: money(row.deduction_rm),
    netSalaryRm: money(row.net_salary_rm),
    bankName: snap.bank_name || "",
    accountHolder: snap.account_holder || "",
    accountLast4: snap.account_last4 || "",
    status: row.status,
    statusText: PAYROLL_STATUS[row.status] || row.status,
    rejectReason: row.reject_reason || "",
    note: row.note || "",
    approvedAt: row.approved_at || "",
    paidAt: row.paid_at || "",
    completedAt: row.completed_at || "",
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
    payeeName: row.payee_name || profile.display_name || "-",
    payeeUid: profile.boss_uid || profile.id || row.payee_user_id,
    amountRm: money(row.amount_rm),
    actualAmountRm: row.actual_amount_rm != null ? money(row.actual_amount_rm) : null,
    bankReference: row.bank_reference || "",
    payeeBank: row.payee_bank || "",
    payeeAccountLast4: row.payee_account_last4 || "",
    paymentDate: row.payment_date || "",
    status: row.status,
    statusText: ({ pending_pay: "待付款", paying: "付款处理中", completed: "已完成", failed: "付款失败", void: "已作废" })[
      row.status
    ] || row.status,
    createdAt: row.created_at,
    financeNote: row.finance_note || "",
  };
}

function viewReceipt(row, payment = {}, profile = {}) {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    paymentId: row.payment_id,
    paymentNo: payment.payment_no || "",
    paymentType: payment.payment_type || "",
    relatedRecordId: payment.related_record_id || "",
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
  if (!canFinance(req)) return json(res, 403, { ok: false, message: "没有提现与发薪管理权限" });

  try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(req.method === "GET" ? req.query.action || "bootstrap" : body.action || "").trim();
    const adminRole = roleFrom(req);

    if (req.method === "GET" && action === "bootstrap") {
      const [withdrawals, payrolls, payments, receipts, cfg] = await Promise.all([
        companionDb("companion_withdrawals", "?order=submitted_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("staff_payrolls", "?order=created_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("finance_payments", "?order=created_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        companionDb("finance_receipts", "?order=uploaded_at.desc&limit=300").catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
        settings(),
      ]);
      const ids = [
        ...withdrawals.map((r) => r.companion_id),
        ...payrolls.map((r) => r.staff_id),
        ...payments.map((r) => r.payee_user_id),
      ];
      const profiles = await profileMap(ids);
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
        m[p.id] = p;
        return m;
      }, {});
      return json(res, 200, {
        ok: true,
        settings: cfg,
        withdrawals: withdrawals.map((r) => viewWithdraw(r, profiles[r.companion_id], accounts[r.payment_account_id])),
        payrolls: payrolls.map((r) => viewPayroll(r, profiles[r.staff_id])),
        pendingPayments: payments
          .filter((p) => /pending_pay|paying/.test(p.status))
          .map((p) => viewPayment(p, profiles[p.payee_user_id])),
        receipts: receipts.map((r) => viewReceipt(r, paymentMap[r.payment_id], profiles[paymentMap[r.payment_id]?.payee_user_id])),
        statusMaps: { withdraw: WITHDRAW_STATUS, payroll: PAYROLL_STATUS },
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    if (action === "approve_withdraw") {
      const id = String(body.id || "").trim();
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      if (row.status !== "pending_review") return json(res, 400, { ok: false, message: "当前状态不可审核通过" });
      const patched = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved_pending_pay",
          approved_at: nowIso(),
          approved_by: body.adminId || null,
          updated_at: nowIso(),
        }),
      });
      await ensureFinancePayment(
        "companion_withdraw",
        id,
        row.companion_id,
        money(row.net_amount_rm),
        { bank_name: row.bank_name, account_holder: row.account_holder, account_last4: row.account_last4 },
        body.adminId
      );
      await writeAdminLog({
        module: "finance",
        action: "approve_withdraw",
        targetType: "companion_withdrawal",
        targetId: id,
        operatorRole: adminRole,
        reason: body.reason || "审核通过",
      });
      return json(res, 200, { ok: true, message: "已通过，进入待付款", item: patched?.[0] });
    }

    if (action === "reject_withdraw") {
      const id = String(body.id || "").trim();
      const reason = String(body.reason || body.reject_reason || "").trim();
      if (!reason) return json(res, 400, { ok: false, message: "请填写驳回原因" });
      const rows = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "提现单不存在" });
      if (!/pending_review|approved_pending_pay|paying/.test(row.status)) {
        return json(res, 400, { ok: false, message: "当前状态不可驳回" });
      }
      const patched = await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected", reject_reason: reason, updated_at: nowIso() }),
      });
      try {
        await companionDb("transactions", "", {
          method: "POST",
          body: JSON.stringify({
            user_id: row.companion_id,
            order_id: null,
            transaction_type: "withdrawal",
            amount: money(row.cat_food_amount),
            status: "cancelled",
            note: `提现驳回退回 ${row.withdrawal_no || id}：${reason}`,
            created_at: nowIso(),
          }),
        });
      } catch {
        /* optional ledger */
      }
      await writeAdminLog({
        module: "finance",
        action: "reject_withdraw",
        targetType: "companion_withdrawal",
        targetId: id,
        operatorRole: adminRole,
        reason,
      });
      return json(res, 200, { ok: true, message: "已拒绝，冻结余额已退回可用余额", item: patched?.[0] });
    }

    if (action === "approve_payroll") {
      const id = String(body.id || "").trim();
      const rows = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = rows?.[0];
      if (!row) return json(res, 404, { ok: false, message: "工资单不存在" });
      if (!/draft|pending_review/.test(row.status)) return json(res, 400, { ok: false, message: "当前状态不可审核" });
      const patched = await companionDb("staff_payrolls", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved_pending_pay",
          approved_at: nowIso(),
          approved_by: body.adminId || null,
          updated_at: nowIso(),
        }),
      });
      const snap = row.payment_account_snapshot || {};
      await ensureFinancePayment("staff_payroll", id, row.staff_id, money(row.net_salary_rm), snap, body.adminId);
      await writeAdminLog({
        module: "finance",
        action: "approve_payroll",
        targetType: "staff_payroll",
        targetId: id,
        operatorRole: adminRole,
      });
      return json(res, 200, { ok: true, message: "工资已通过，进入待付款", item: patched?.[0] });
    }

    if (action === "create_payroll") {
      const staffId = String(body.staffId || body.staff_id || "").trim();
      if (!staffId) return json(res, 400, { ok: false, message: "缺少客服 ID" });
      const base = money(body.baseSalaryRm ?? body.base_salary_rm);
      const bonus = money(body.bonusRm ?? body.bonus_rm);
      const deduction = money(body.deductionRm ?? body.deduction_rm);
      const net = money(body.netSalaryRm ?? body.net_salary_rm) || Math.max(0, base + bonus - deduction);
      const rows = await companionDb("staff_payrolls", "", {
        method: "POST",
        body: JSON.stringify({
          payroll_no: no("PAYROLL"),
          staff_id: staffId,
          period_start: body.periodStart || body.period_start,
          period_end: body.periodEnd || body.period_end,
          work_days: Number(body.workDays || body.work_days || 0),
          full_attendance: !!body.fullAttendance,
          reception_count: Number(body.receptionCount || 0),
          order_count: Number(body.orderCount || 0),
          base_salary_rm: base,
          bonus_rm: bonus,
          deduction_rm: deduction,
          net_salary_rm: net,
          payment_account_snapshot: body.paymentAccount || body.payment_account_snapshot || {},
          status: "pending_review",
          note: String(body.note || ""),
          created_at: nowIso(),
          updated_at: nowIso(),
        }),
      });
      return json(res, 200, { ok: true, message: "工资单已创建，待审核", item: rows?.[0] });
    }

    if (action === "mark_paying") {
      const paymentId = String(body.paymentId || body.id || "").trim();
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
      return json(res, 200, { ok: true, message: "已标记付款处理中" });
    }

    if (action === "reveal_account") {
      if (!canReveal(req)) return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可查看完整账号" });
      const accountId = String(body.paymentAccountId || body.accountId || "").trim();
      const rows = await companionDb("companion_payment_accounts", `?id=eq.${encodeURIComponent(accountId)}&limit=1`);
      const acc = rows?.[0];
      if (!acc) return json(res, 404, { ok: false, message: "结款账户不存在" });
      await writeAdminLog({
        module: "finance",
        action: "reveal_bank_account",
        targetType: "companion_payment_account",
        targetId: accountId,
        operatorRole: adminRole,
        reason: body.reason || "查看完整银行账号",
      });
      return json(res, 200, {
        ok: true,
        account: {
          id: acc.id,
          bankName: acc.bank_name,
          accountHolder: acc.account_name,
          accountNumber: acc.bank_account,
          accountLast4: acc.account_last4 || maskBankAccount(acc.bank_account).slice(-4),
          status: acc.status,
        },
      });
    }

    if (action === "upload_receipt_and_confirm") {
      if (!canConfirmPay(req)) {
        return json(res, 403, { ok: false, message: "仅超级管理员或财务管理员可确认付款并上传收据" });
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
      if (pay.status === "completed") return json(res, 400, { ok: false, message: "该付款已完成" });

      const actual = body.actualAmountRm != null ? money(body.actualAmountRm) : money(pay.amount_rm);
      const varianceReason = String(body.varianceReason || "").trim();
      if (Math.abs(actual - money(pay.amount_rm)) > 0.009 && !varianceReason) {
        return json(res, 400, { ok: false, message: "实付与应付不一致时必须填写差异原因" });
      }

      await ensurePrivateBucket(FINANCE_BUCKET, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
      const objectPath = buildObjectPath(pay.payee_user_id, "receipts", `receipt.${decoded.contentType.includes("pdf") ? "pdf" : "jpg"}`);
      await uploadPrivateObject(FINANCE_BUCKET, objectPath, decoded.buffer, decoded.contentType);

      const d = new Date(paymentDate);
      const accountingMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const taxYear = String(d.getFullYear());

      const receiptRows = await companionDb("finance_receipts", "", {
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
          payment_purpose: pay.payment_type === "staff_payroll" ? "客服工资" : "陪玩结算",
          reconciliation_status: Math.abs(actual - money(pay.amount_rm)) > 0.009 ? "variance" : "pending",
          uploaded_by: body.adminId || null,
          uploaded_at: nowIso(),
          notes: String(body.financeNote || body.notes || ""),
        }),
      });

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
      await companionDb(table, `?id=eq.${encodeURIComponent(pay.related_record_id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          paid_at: nowIso(),
          completed_at: nowIso(),
          updated_at: nowIso(),
        }),
      }).catch(() => null);

      // Record companion income deduction as withdrawal transaction marker
      if (pay.payment_type === "companion_withdraw") {
        try {
          const w = (await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(pay.related_record_id)}&limit=1`))?.[0];
          if (w) {
            await companionDb("transactions", "", {
              method: "POST",
              body: JSON.stringify({
                user_id: w.companion_id,
                transaction_type: "withdrawal",
                amount: money(w.cat_food_amount),
                status: "completed",
                note: `提现完成 ${w.withdrawal_no} / ${bankReference}`,
                created_at: nowIso(),
              }),
            });
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
        operatorRole: adminRole,
        after: { bankReference, actual, receiptId: receiptRows?.[0]?.id },
      });

      return json(res, 200, {
        ok: true,
        message: "已上传收据并确认付款完成",
        receipt: receiptRows?.[0] || null,
      });
    }

    if (action === "receipt_signed_url") {
      if (!canConfirmPay(req)) {
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
      if (!canConfirmPay(req)) {
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
      if (!canConfirmPay(req)) {
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

    return json(res, 400, { ok: false, message: "未知财务操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/finance-payouts.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "财务接口异常" });
  }
}
