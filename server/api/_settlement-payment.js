/**
 * Companion settlement payment field mapping.
 * Keep method-specific columns (bank_account / tng_account / alipay_account)
 * — never reuse bank_account for TNG/Alipay values.
 */

export function normalizeSettlementMethod(raw) {
  const m = String(raw || "").trim();
  if (!m) return "";
  if (/^bank$/i.test(m) || m === "银行卡" || /bank\s*transfer/i.test(m)) return "银行卡";
  if (/^tng/i.test(m) || /touch\s*n\s*go/i.test(m) || m === "TNG Wallet") return "TNG Wallet";
  if (/支付宝|alipay/i.test(m)) return "支付宝";
  if (/duit\s*now/i.test(m)) return "DuitNow";
  return m;
}

export function looksLikeMobileAccount(raw) {
  const d = String(raw || "").replace(/[\s\-]/g, "");
  if (!d) return false;
  return /^(\+?60|0)?1\d{8,9}$/.test(d);
}

/**
 * Normalize / repair a payment row for display or persistence.
 * Fixes legacy workbench bug: TNG phone stored in bank_account with method=银行卡.
 */
export function normalizePaymentAccountRecord(payment = null) {
  if (!payment || typeof payment !== "object") return null;
  let method = normalizeSettlementMethod(payment.method);
  let bankName = String(payment.bank_name || "").trim();
  let bankAccount = String(payment.bank_account || "").trim();
  let tngAccount = String(payment.tng_account || "").trim();
  let alipayAccount = String(payment.alipay_account || "").trim();
  let paymentAccount = String(payment.payment_account || "").trim();
  let paymentPhone = String(payment.payment_phone || "").trim();
  let changed = false;

  // Infer TNG when phone-like value sits in bank_account without a bank name.
  if (
    (!method || method === "银行卡") &&
    !bankName &&
    !tngAccount &&
    !alipayAccount &&
    looksLikeMobileAccount(bankAccount)
  ) {
    method = "TNG Wallet";
    changed = true;
  }
  if (!method && tngAccount && !bankAccount && !alipayAccount) {
    method = "TNG Wallet";
    changed = true;
  }
  if (!method && alipayAccount && !bankAccount && !tngAccount) {
    method = "支付宝";
    changed = true;
  }
  if (!method) method = "银行卡";

  if (method === "TNG Wallet") {
    const nextTng = tngAccount || paymentPhone || paymentAccount || bankAccount;
    if (nextTng !== tngAccount || bankName || bankAccount || alipayAccount) changed = true;
    tngAccount = nextTng;
    paymentPhone = nextTng;
    paymentAccount = nextTng;
    bankName = "";
    bankAccount = "";
    alipayAccount = "";
  } else if (method === "支付宝") {
    const nextAlipay = alipayAccount || paymentAccount || bankAccount;
    if (nextAlipay !== alipayAccount || bankName || bankAccount || tngAccount) changed = true;
    alipayAccount = nextAlipay;
    paymentAccount = nextAlipay;
    paymentPhone = "";
    bankName = "";
    bankAccount = "";
    tngAccount = "";
  } else if (method === "DuitNow") {
    const nextBank = bankAccount || paymentAccount || tngAccount || alipayAccount;
    if (nextBank !== bankAccount || tngAccount || alipayAccount || bankName !== "DuitNow") changed = true;
    bankAccount = nextBank;
    paymentAccount = nextBank;
    bankName = bankName || "DuitNow";
    tngAccount = "";
    alipayAccount = "";
    paymentPhone = "";
  } else {
    const nextBank = bankAccount || paymentAccount;
    if (nextBank !== bankAccount || tngAccount || alipayAccount) changed = true;
    bankAccount = nextBank;
    paymentAccount = nextBank;
    tngAccount = "";
    alipayAccount = "";
    paymentPhone = "";
  }

  const last4Source = String(paymentAccount || bankAccount || tngAccount || alipayAccount || "").replace(/\s+/g, "");
  return {
    ...payment,
    method,
    bank_name: bankName,
    bank_account: bankAccount,
    tng_account: tngAccount,
    alipay_account: alipayAccount,
    payment_account: paymentAccount,
    payment_phone: paymentPhone,
    account_last4: payment.account_last4 || last4Source.slice(-4),
    _repaired: changed,
  };
}

export function formatSettlementAccountLabel(payment) {
  const row = normalizePaymentAccountRecord(payment) || {};
  const method = row.method || "";
  if (method === "TNG Wallet") {
    return `TNG Wallet ${row.tng_account || row.payment_phone || ""}`.trim();
  }
  if (method === "支付宝") {
    return `支付宝 ${row.alipay_account || ""}`.trim();
  }
  if (method === "DuitNow") {
    return `DuitNow ${row.bank_account || ""}`.trim();
  }
  return `${row.bank_name || ""} ${row.account_name || ""} ${row.bank_account || ""}`.trim();
}

export function formatSettlementAccountMasked(payment, maskFn) {
  const row = normalizePaymentAccountRecord(payment) || {};
  const method = row.method || "";
  const raw = row.payment_account || row.bank_account || row.tng_account || row.alipay_account || "";
  const last4 = row.account_last4 || (typeof maskFn === "function" ? maskFn(raw).slice(-4) : String(raw).slice(-4));
  if (method === "TNG Wallet") return `TNG Wallet ****${last4}`.trim();
  if (method === "支付宝") return `支付宝 ****${last4}`.trim();
  if (method === "DuitNow") return `DuitNow ****${last4}`.trim();
  return `${row.bank_name || ""} ${row.account_name || ""} ****${last4}`.trim();
}

/**
 * Build DB write payload from companion submit body + existing row.
 */
export function buildPaymentAccountPayload(body = {}, existingPayment = null, nowIso = () => new Date().toISOString()) {
  const existing = normalizePaymentAccountRecord(existingPayment) || existingPayment;
  let method = normalizeSettlementMethod(
    body.settlementMethod || body.method || body.payment_method || body.paymentMethod || existing?.method || ""
  );
  const accountName = String(
    body.account_name || body.accountName || body.settlementName || body.real_name || existing?.account_name || ""
  ).trim();
  let bankName = String(body.bank_name || body.bankName || body.settlementBank || "").trim();
  let bankAccountRaw = String(body.bank_account || body.bankAccount || body.settlementAccount || "").trim();
  let tngRaw = String(body.tng_account || body.tngAccount || body.payment_phone || body.paymentPhone || "").trim();
  let alipayRaw = String(body.alipay_account || body.alipayAccount || "").trim();
  const paymentAccountRaw = String(body.payment_account || body.paymentAccount || "").trim();

  if (/^\*+\d{0,4}$/.test(bankAccountRaw)) bankAccountRaw = String(existing?.bank_account || "");
  if (/^\*+\d{0,4}$/.test(tngRaw)) tngRaw = String(existing?.tng_account || existing?.payment_phone || "");
  if (/^\*+\d{0,4}$/.test(alipayRaw)) alipayRaw = String(existing?.alipay_account || "");

  // Infer TNG when client omitted method but sent a phone in bank_account (legacy UI).
  if (
    (!method || method === "银行卡") &&
    !bankName &&
    !tngRaw &&
    !alipayRaw &&
    looksLikeMobileAccount(bankAccountRaw || paymentAccountRaw)
  ) {
    method = "TNG Wallet";
    tngRaw = bankAccountRaw || paymentAccountRaw;
    bankAccountRaw = "";
  }
  if (!method) method = "银行卡";

  let bankAccount = "";
  let tngAccount = "";
  let alipayAccount = "";
  let paymentPhone = "";
  let paymentAccount = "";

  if (method === "TNG Wallet") {
    tngAccount = tngRaw || paymentAccountRaw || bankAccountRaw || String(existing?.tng_account || "");
    paymentPhone = tngAccount;
    paymentAccount = tngAccount;
    bankName = "";
    bankAccount = "";
    alipayAccount = "";
  } else if (method === "支付宝") {
    alipayAccount = alipayRaw || paymentAccountRaw || bankAccountRaw || String(existing?.alipay_account || "");
    paymentAccount = alipayAccount;
    bankName = "";
    bankAccount = "";
    tngAccount = "";
    paymentPhone = "";
  } else if (method === "DuitNow") {
    bankAccount = bankAccountRaw || paymentAccountRaw || String(existing?.bank_account || "");
    paymentAccount = bankAccount;
    bankName = bankName || "DuitNow";
    tngAccount = "";
    alipayAccount = "";
    paymentPhone = "";
  } else {
    bankAccount = bankAccountRaw || paymentAccountRaw || String(existing?.bank_account || "");
    paymentAccount = bankAccount;
    tngAccount = "";
    alipayAccount = "";
    paymentPhone = "";
  }

  const last4Source = String(paymentAccount || bankAccount || tngAccount || alipayAccount || "").replace(/\s+/g, "");
  return {
    method,
    bank_name: bankName,
    account_name: accountName,
    bank_account: bankAccount,
    account_last4: last4Source.slice(-4),
    tng_account: tngAccount,
    alipay_account: alipayAccount,
    payment_account: paymentAccount,
    payment_phone: paymentPhone,
    status: "pending",
    reject_reason: "",
    submitted_at: typeof nowIso === "function" ? nowIso() : nowIso,
  };
}

export function hasSettlementPaymentInput(body = {}) {
  return !!(
    body.bank_name ||
    body.bankName ||
    body.bank_account ||
    body.bankAccount ||
    body.settlementAccount ||
    body.settlementMethod ||
    body.method ||
    body.payment_method ||
    body.paymentMethod ||
    body.tng_account ||
    body.tngAccount ||
    body.alipay_account ||
    body.alipayAccount ||
    body.payment_account ||
    body.paymentAccount ||
    body.payment_phone ||
    body.paymentPhone
  );
}
