#!/usr/bin/env node
/**
 * Offline verification: boss order detail modal + unpaid cancel.
 * Does NOT touch Production / Staging DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

const ordersHtml = read("orders.html");
const ordersApi = read("server/api/orders.js");
const styleCss = read("src/style.css");
const payConfirm = read("src/payment-confirm.js");

test("TEST 1 detail button bound with data-detail", () => {
  assert.match(ordersHtml, /data-detail="/);
  assert.match(ordersHtml, /查看详情/);
  assert.match(ordersHtml, /closest\('\[data-detail\]'\)/);
  assert.match(ordersHtml, /function detail\(/);
  assert.match(ordersHtml, /#detailModal/);
});

test("TEST 2 modal CSS beats style.css position:relative override", () => {
  assert.match(styleCss, /\.modal\{position:relative;z-index:1\}/);
  assert.match(ordersHtml, /#detailModal\.modal/);
  assert.match(ordersHtml, /position:fixed !important/);
  assert.match(ordersHtml, /z-index:3000 !important/);
  assert.match(ordersHtml, /#detailModal\.modal\.open/);
  assert.match(ordersHtml, /display:flex !important/);
});

test("TEST 3 detail opens immediately (not blocked on await)", () => {
  assert.match(ordersHtml, /detail\(o,false\);\(async function/);
  assert.doesNotMatch(
    ordersHtml,
    /if\(d\)\{\(async function\(\)\{var o=state\.orders\.find[\s\S]*paint\(\)[\s\S]*detail\(o,false\)\}\)\(\);return\}/
  );
});

test("TEST 4 GET ownership returns 403/404 codes", () => {
  assert.match(ordersApi, /FORBIDDEN_ORDER/);
  assert.match(ordersApi, /ORDER_NOT_FOUND/);
  assert.match(ordersApi, /无权限查看该订单/);
});

test("TEST 5 unpaid cancel on card + confirm copy", () => {
  assert.match(ordersHtml, /data-action="cancel_order"/);
  assert.match(ordersHtml, /isUnpaidCancellable/);
  assert.match(ordersHtml, /该订单尚未付款，取消后不会产生扣款/);
  assert.match(ordersHtml, /function canCancelOrder\(o\)\{return isUnpaidCancellable\(o\)\}/);
});

test("TEST 6 cancel_order API: awaiting_payment only + idempotent", () => {
  assert.match(ordersApi, /action === "cancel_order"/);
  assert.match(ordersApi, /ALREADY_CANCELLED/);
  assert.match(ordersApi, /PAID_CANCEL_USE_REFUND/);
  assert.match(ordersApi, /cancelled_at: nowIso\(\)/);
  assert.match(ordersApi, /refund: 0/);
});

test("TEST 7 paid / in-service cannot free-cancel", () => {
  assert.match(ordersApi, /beforeStatus !== "awaiting_payment"/);
  assert.match(ordersApi, /money\(before\.paid_cat_food\) > 0/);
  assert.match(ordersHtml, /申请取消/);
  assert.match(ordersHtml, /canRequestCancelViaCs/);
});

test("TEST 8 cancelled payment blocked", () => {
  assert.match(ordersApi, /ORDER_CANCELLED/);
  assert.match(ordersApi, /该订单已取消，无法继续付款/);
  assert.match(ordersApi, /该订单已取消，无法继续上传付款凭证/);
  assert.match(payConfirm, /已取消订单无法付款确认|订单已取消/);
});

test("TEST 9 multi parent unpaid cancel children", () => {
  assert.match(ordersApi, /isMultiGroupParent\(before\)/);
  assert.match(ordersApi, /parent_order_id=eq/);
  assert.match(ordersApi, /MULTI_CHILD_NOT_UNPAID/);
  assert.match(ordersApi, /cancelledChildren/);
});

test("TEST 10 completed / cancelled hide pay+cancel on card", () => {
  // Accept either combined cancelled||refunded, or split branches after multi-UI merge.
  const hidesCancelled =
    /else if\(s==='cancelled'\|\|s==='refunded'\)/.test(ordersHtml) ||
    (/else if\(s==='cancelled'\)/.test(ordersHtml) && /else if\(s==='refunded'\)/.test(ordersHtml));
  assert.ok(hidesCancelled, "cancelled/refunded card actions must hide pay+cancel");
  assert.match(ordersHtml, /else if\(s==='completed'\)/);
  assert.doesNotMatch(
    ordersHtml,
    /function canCancelOrder\(o\)\{\s*var s=String\(o\.status\|\|''\);\s*return \['awaiting_payment','pending','claimed'/
  );
});

test("TEST 11 legacy single order cancel path still uses patchOwnedOrder", () => {
  assert.match(ordersApi, /patchOwnedOrder\(profile, orderId/);
  assert.match(ordersApi, /\["awaiting_payment"\]/);
});

test("TEST 12 detail modal shows core fields", () => {
  assert.match(ordersHtml, /订单编号/);
  assert.match(ordersHtml, /订单状态/);
  assert.match(ordersHtml, /付款状态/);
  assert.match(ordersHtml, /陪玩昵称/);
  assert.match(ordersHtml, /游戏\/服务/);
  assert.match(ordersHtml, /实付猫粮/);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`boss-order-detail-cancel offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
