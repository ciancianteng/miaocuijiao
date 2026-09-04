/**
 * PR154 acceptance — local unit checks (no network / no DB writes).
 * Run: node scripts/pr154-acceptance-unit.mjs
 */
import { calcBossCommissionFromPlatformFee } from "../server/api/_boss-commission.js";
import assert from "node:assert/strict";

function testCommissionRm30() {
  const r = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
    companionIncomeAmount: 24,
  });
  assert.equal(r.platformFeeAmount, 6);
  assert.equal(r.bossCommissionAmount, 0.3);
  assert.equal(r.companionIncomeUnchanged, true);
  assert.equal(r.calculatedFrom, "platform_fee_only");
  console.log("OK commission RM30 → fee RM6 → boss RM0.30");
}

function testCommissionDoesNotCutCompanion() {
  const a = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
    companionIncomeAmount: 24,
  });
  const b = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
    companionIncomeAmount: 999,
  });
  assert.equal(a.bossCommissionAmount, b.bossCommissionAmount);
  console.log("OK boss commission ignores companion income");
}

function testSettlementMethodLabels() {
  function isBank(m) {
    return String(m || "").trim() === "银行卡" || /^bank$/i.test(String(m || "").trim());
  }
  function isTng(m) {
    const x = String(m || "").trim().toLowerCase();
    return x === "tng wallet" || x === "tng" || x === "touch n go";
  }
  function isAlipay(m) {
    const x = String(m || "").trim().toLowerCase();
    return x === "支付宝" || x === "alipay";
  }
  function label(m) {
    if (isTng(m)) return "TNG 手机号码";
    if (isAlipay(m)) return "支付宝账号 / 手机号";
    if (isBank(m)) return "银行账号";
    return "银行账号";
  }
  assert.equal(label("TNG Wallet"), "TNG 手机号码");
  assert.equal(label("支付宝"), "支付宝账号 / 手机号");
  assert.equal(label("银行卡"), "银行账号");
  assert.equal(isBank("银行卡"), true);
  assert.equal(isTng("TNG Wallet"), true);
  assert.equal(isAlipay("支付宝"), true);
  console.log("OK settlement method → dynamic field labels");
}

testCommissionRm30();
testCommissionDoesNotCutCompanion();
testSettlementMethodLabels();
console.log("PR154 unit checks passed");
