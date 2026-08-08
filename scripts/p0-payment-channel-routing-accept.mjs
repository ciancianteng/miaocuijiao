/**
 * Local unit accept: payment channel routing must never cross-fallback.
 * Usage: node scripts/p0-payment-channel-routing-accept.mjs
 */
import assert from "node:assert/strict";
import { resolvePayChannelIds, channelDisplayName } from "../server/api/_platform-pay-qr.js";

const cases = [
  ["tng", ["tng"]],
  ["TNG", ["tng"]],
  ["duitnow", ["duitnow"]],
  ["DuitNow", ["duitnow"]],
  ["bank", ["bank-transfer", "bank-my"]],
  ["银行卡", ["bank-transfer", "bank-my"]],
  ["alipay", ["alipay"]],
  ["支付宝", ["alipay"]],
  ["stripe", ["stripe"]],
  ["hitpay", ["hitpay"]],
  ["catfood", []],
  ["猫粮余额", []],
];

let failed = 0;
for (const [method, expect] of cases) {
  const got = resolvePayChannelIds(method);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`[${ok ? "PASS" : "FAIL"}] resolve(${method}) => ${JSON.stringify(got)}`);
  if (!ok) {
    failed += 1;
    console.log(`  expected ${JSON.stringify(expect)}`);
  }
}

// Critical: TNG must never resolve to duitnow
const tng = resolvePayChannelIds("tng");
assert.ok(!tng.includes("duitnow"), "TNG must not include duitnow");
assert.deepEqual(tng, ["tng"]);

const stripe = resolvePayChannelIds("stripe");
assert.ok(!stripe.includes("duitnow"), "Stripe must not include duitnow");

const hitpay = resolvePayChannelIds("hitpay");
assert.ok(!hitpay.includes("duitnow"), "HitPay must not include duitnow");

assert.equal(channelDisplayName("tng"), "TNG");
assert.equal(channelDisplayName("duitnow"), "DuitNow");
assert.equal(channelDisplayName("", "tng"), "TNG");

// Source guard: no prefer-list fallback in module
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server/api/_platform-pay-qr.js"), "utf8");
assert.ok(!/prefer\s*=\s*\["duitnow"/.test(src), "old prefer-duitnow fallback must be removed");
assert.ok(/Never cross-fallback|never cross-fallback|no cross-channel/i.test(src), "must document no cross-fallback");
assert.ok(/listBossPaymentMethods|listBossOrderPaymentMethods/.test(src), "must export boss payment method list from SoT");

const payJs = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/payment-confirm.js"), "utf8");
assert.ok(/暂未开放，请选择其他支付方式/.test(payJs), "payment page must show 暂未开放 copy");
assert.ok(/data-pay-unavailable/.test(payJs), "payment page marks unavailable state");

const ordersSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server/api/orders.js"), "utf8");
assert.ok(/loadPlatformPayQr\(\s*target\.paymentMethod/.test(ordersSrc), "orders API must pass payment_method into QR loader");
assert.ok(/assertOrderPaymentMethodAllowed/.test(ordersSrc), "orders must gate disabled payment methods");

const modalSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/place-order-modal.js"), "utf8");
assert.ok(!/\{ id: "tng", label: "TNG" \}/.test(modalSrc), "place-order modal must not hardcode TNG");
assert.ok(/orderPayMethods|\/api\/recharge/.test(modalSrc), "place-order modal must load pay methods from API");

const pageSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/place-order-page.js"), "utf8");
assert.ok(!/\{ id: "tng", label: "TNG" \}/.test(pageSrc), "place-order page must not hardcode TNG");

const gpSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/gameplay-product.js"), "utf8");
assert.ok(!/paymentMethod:\s*"duitnow"/.test(gpSrc), "gameplay must not hardcode duitnow");
assert.ok(/orderPayMethods|\/api\/recharge/.test(gpSrc), "gameplay must load pay methods from API");

const rechargeHtml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../recharge.html"), "utf8");
assert.ok(!/code:'tng',name:'TNG',statusText:'暂未开放'/.test(rechargeHtml), "recharge must not fall back to hardcoded closed methods");

console.log(failed ? `ROUTING_ACCEPT_FAIL ${failed}` : "ROUTING_ACCEPT_PASS");
process.exit(failed ? 1 : 0);
