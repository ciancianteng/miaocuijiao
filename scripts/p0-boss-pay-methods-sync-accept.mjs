/**
 * Static accept: four boss pay entry points must read admin payment SoT (no hardcoded channels).
 * Usage: node scripts/p0-boss-pay-methods-sync-accept.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

let failed = 0;
function check(name, ok, detail) {
  if (!step(name, ok, detail)) failed += 1;
}

const sot = read("server/api/_platform-pay-qr.js");
check("SoT exports listBossPaymentMethods", /export async function listBossPaymentMethods/.test(sot), "listBossPaymentMethods");
check("SoT exports listBossOrderPaymentMethods", /export async function listBossOrderPaymentMethods/.test(sot), "listBossOrderPaymentMethods");
check("SoT no cross-fallback", /Never cross-fallback|never cross-fallback|no cross-channel/i.test(sot), "documented");
check("SoT wallet pay gate", /isWalletPayEnabled/.test(sot), "wallet gate");

const rechargeApi = read("server/api/recharge.js");
check("recharge uses listBossPaymentMethods", /listBossPaymentMethods/.test(rechargeApi), "import+load");
check("recharge returns orderPayMethods", /orderPayMethods/.test(rechargeApi), "orderPayMethods field");
check("recharge hides closed from methods", /openMethods/.test(rechargeApi), "openMethods");

const ordersApi = read("server/api/orders.js");
check("orders gates disabled methods", /assertOrderPaymentMethodAllowed/.test(ordersApi), "gate");
check("orders binds QR to method", /loadPlatformPayQr\(\s*target\.paymentMethod/.test(ordersApi), "QR bind");

const modal = read("src/place-order-modal.js");
check("立即下单 no hardcoded TNG", !/\{\s*id:\s*"tng"\s*,\s*label:\s*"TNG"\s*\}/.test(modal), "no hardcode");
check("立即下单 loads /api/recharge", /\/api\/recharge/.test(modal) && /orderPayMethods|applyOrderPayMethods/.test(modal), "live methods");

const page = read("src/place-order-page.js");
check("place-order page no hardcoded TNG", !/\{\s*id:\s*"tng"\s*,\s*label:\s*"TNG"\s*\}/.test(page), "no hardcode");
check("place-order page loads methods", /refreshPayMethods|orderPayMethods/.test(page), "live methods");

const gp = read("src/gameplay-product.js");
check("更多玩法 no hardcoded duitnow", !/paymentMethod:\s*"duitnow"/.test(gp), "no hardcode");
check("更多玩法 payment picker", /data-gp-pay/.test(gp) && /refreshPayMethods/.test(gp), "picker+load");

const custom = read("custom-order.html");
check("自定义订单 payment picker", /customPayMethods|data-custom-pay/.test(custom), "picker");
check("自定义订单 sends paymentMethod", /paymentMethod:payState\.payment/.test(custom), "payload");

const rechargeHtml = read("recharge.html");
check("充值中心 no hardcoded closed fallback", !/code:'tng',name:'TNG',statusText:'暂未开放'/.test(rechargeHtml), "no hardcode fallback");
check("充值中心 filters open methods", /m\.open===true|open===true/.test(rechargeHtml), "filter open");

check("立即下单 no methods reconstruct fallback", !/!list\.length && Array\.isArray\(body\.methods\)/.test(modal), "no fallback");
check("place-order page no methods reconstruct", !/!list\.length && Array\.isArray\(body\.methods\)/.test(page), "no fallback");
check("更多玩法 no methods reconstruct", !/!list\.length && Array\.isArray\(body\.methods\)/.test(gp), "no fallback");
check("自定义订单 no methods reconstruct", !/!list\.length&&Array\.isArray\(body\.methods\)/.test(custom), "no fallback");

console.log(failed ? `BOSS_PAY_METHODS_SYNC_FAIL ${failed}` : "BOSS_PAY_METHODS_SYNC_PASS");
process.exit(failed ? 1 : 0);
