import assert from "node:assert/strict";
import {
  normalizeSettlementMethod,
  looksLikeMobileAccount,
  normalizePaymentAccountRecord,
  buildPaymentAccountPayload,
} from "../server/api/_settlement-payment.js";

assert.equal(normalizeSettlementMethod("TNG Wallet"), "TNG Wallet");
assert.equal(normalizeSettlementMethod("tng"), "TNG Wallet");
assert.equal(normalizeSettlementMethod("银行卡"), "银行卡");
assert.equal(normalizeSettlementMethod("支付宝"), "支付宝");
assert.equal(looksLikeMobileAccount("0123456789"), true);
assert.equal(looksLikeMobileAccount("123456789012"), false);

const tngPayload = buildPaymentAccountPayload(
  { payment_method: "TNG Wallet", tng_account: "0123456789" },
  null,
  () => "T"
);
assert.equal(tngPayload.method, "TNG Wallet");
assert.equal(tngPayload.tng_account, "0123456789");
assert.equal(tngPayload.bank_account, "");
assert.equal(tngPayload.bank_name, "");
assert.equal(tngPayload.alipay_account, "");
assert.equal(tngPayload.payment_phone, "0123456789");

const alipayPayload = buildPaymentAccountPayload(
  { payment_method: "支付宝", alipay_account: "ali@example.com" },
  null,
  () => "T"
);
assert.equal(alipayPayload.method, "支付宝");
assert.equal(alipayPayload.alipay_account, "ali@example.com");
assert.equal(alipayPayload.bank_account, "");
assert.equal(alipayPayload.tng_account, "");

const bankPayload = buildPaymentAccountPayload(
  { payment_method: "银行卡", bank_name: "Maybank", bank_account: "1234567890" },
  null,
  () => "T"
);
assert.equal(bankPayload.method, "银行卡");
assert.equal(bankPayload.bank_name, "Maybank");
assert.equal(bankPayload.bank_account, "1234567890");
assert.equal(bankPayload.tng_account, "");
assert.equal(bankPayload.alipay_account, "");

// Legacy bug: phone saved into bank_account with method defaulting to 银行卡.
const inferred = buildPaymentAccountPayload(
  { payment_method: "银行卡", bank_account: "0123456789" },
  null,
  () => "T"
);
assert.equal(inferred.method, "TNG Wallet");
assert.equal(inferred.tng_account, "0123456789");
assert.equal(inferred.bank_account, "");

const repaired = normalizePaymentAccountRecord({
  method: "银行卡",
  bank_name: "",
  bank_account: "0123456789",
  tng_account: "",
  alipay_account: "",
});
assert.equal(repaired.method, "TNG Wallet");
assert.equal(repaired.tng_account, "0123456789");
assert.equal(repaired.bank_account, "");
assert.equal(repaired._repaired, true);

// Switching to TNG must clear bank columns even if bank values were previously stored.
const switchToTng = buildPaymentAccountPayload(
  { payment_method: "TNG Wallet", tng_account: "0199998888" },
  { method: "银行卡", bank_name: "Maybank", bank_account: "555566667777", tng_account: "" },
  () => "T"
);
assert.equal(switchToTng.method, "TNG Wallet");
assert.equal(switchToTng.tng_account, "0199998888");
assert.equal(switchToTng.bank_name, "");
assert.equal(switchToTng.bank_account, "");

console.log("verify-settlement-payment-fields: ok");
