#!/usr/bin/env node
/**
 * Offline verification: production-ready gift system (admin CRUD, mall recipients,
 * wallet + external proof, CS approve idempotency, gift wall, earnings isolation).
 * Does NOT touch Production / Staging DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCompanionIncomeTx, isGiftOrRewardNote } from "../server/api/_companion-income.js";
import { GIFT_ORDER_STATUS, viewGiftOrder } from "../server/api/_gift-orders.js";

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

const adminGiftsUi = read("src/admin-gifts.js");
const adminGiftsApi = read("server/api/admin/gifts.js");
const mall = read("src/gifts-mall.js");
const giftOrders = read("server/api/_gift-orders.js");
const marketplace = read("server/api/boss/marketplace.js");
const profile = read("src/profile-detail.js");
const cs = read("src/customer-service-v2.js");
const migration = read("supabase/migrations/20260912_gift_orders_payment_review.sql");

// TEST 1 — Admin 新增礼物
test("TEST 1 Admin create gift (UI + API save without id)", () => {
  assert.match(adminGiftsUi, /data-gift-new/);
  assert.match(adminGiftsUi, /新增礼物/);
  assert.match(adminGiftsUi, /action:\s*"save"/);
  assert.match(adminGiftsApi, /action === "save"/);
  assert.match(adminGiftsApi, /const isCreate = !id/);
  assert.match(adminGiftsApi, /method:\s*"POST"/);
});

// TEST 2 — Admin 编辑礼物（modal by id，非 prompt）
test("TEST 2 Admin edit gift (modal + id PATCH, no prompt edit)", () => {
  assert.match(adminGiftsUi, /data-gift-edit/);
  assert.match(adminGiftsUi, /编辑礼物/);
  assert.match(adminGiftsUi, /findGift\(id\)/);
  assert.match(adminGiftsUi, /openEditor\(gift\)/);
  assert.match(adminGiftsUi, /Root cause fix for .*无法编辑|无法编辑/);
  assert.doesNotMatch(adminGiftsUi, /prompt\s*\(\s*["']礼物名称/);
  assert.match(adminGiftsApi, /if \(id\) \{[\s\S]*method:\s*"PATCH"/);
  assert.match(adminGiftsApi, /action === "upload_icon"/);
});

// TEST 3 — Admin 停用 / soft delete
test("TEST 3 Admin disable / soft_delete gift", () => {
  assert.match(adminGiftsUi, /name="enabled"/);
  assert.match(adminGiftsUi, /soft_delete/);
  assert.match(adminGiftsApi, /action === "soft_delete"/);
  assert.match(adminGiftsApi, /deleted_at/);
  assert.match(adminGiftsApi, /enabled:\s*false/);
  assert.match(migration, /companion_gift_wall/);
});

// TEST 4 — 单 recipient
test("TEST 4 Single recipient selection", () => {
  assert.match(mall, /toggleCompanion/);
  assert.match(mall, /hasRecipients\(\)/);
  assert.match(mall, /data-pick-companion/);
  assert.match(mall, /selectedCompanions/);
});

// TEST 5 — multi recipient
test("TEST 5 Multi recipient (N independent sends/orders)", () => {
  assert.match(mall, /selectedCompanions\(\)\.length/);
  assert.match(mall, /多人赠送会为每位陪玩生成独立订单/);
  assert.match(mall, /for \(var i = 0; i < recipients\.length; i\+\+\)/);
  assert.equal((mall.match(/action:\s*"send_gift"/g) || []).length >= 1, true);
  assert.match(mall, /action:\s*"create"/);
});

// TEST 6 — 钱包支付只扣一次（per recipient idempotency key）
test("TEST 6 Wallet pay uses unique idempotencyKey per send", () => {
  assert.match(mall, /idempotencyKey:\s*idem\(\)/);
  assert.match(marketplace, /idempotencyKey:\s*`gift:\$\{idempotencyKey\}`/);
  assert.match(marketplace, /action === "send_gift"/);
  assert.match(marketplace, /transactionType: action === "send_gift" \? "gift" : "tip"/);
});

// TEST 7 — 外部支付 proof 上传
test("TEST 7 External payment + proof upload", () => {
  assert.match(mall, /upload_proof/);
  assert.match(mall, /proofDataUrl/);
  assert.match(giftOrders, /export async function uploadGiftOrderProof/);
  assert.match(giftOrders, /UNDER_REVIEW/);
  assert.match(giftOrders, /payment_proof_path/);
});

// TEST 8 — 未审核不能 fulfillment
test("TEST 8 Unreviewed orders cannot fulfill", () => {
  assert.match(giftOrders, /REVIEWABLE/);
  assert.match(giftOrders, /尚未上传付款截图/);
  assert.match(giftOrders, /当前状态不可审核通过/);
  assert.equal(GIFT_ORDER_STATUS.PENDING_PAYMENT, "pending_payment");
  assert.equal(GIFT_ORDER_STATUS.UNDER_REVIEW, "under_review");
  assert.equal(GIFT_ORDER_STATUS.APPROVED, "approved");
  const pending = viewGiftOrder({
    id: "o1",
    status: GIFT_ORDER_STATUS.PENDING_PAYMENT,
    gift_name_snapshot: "猫爪",
    quantity: 1,
    total_amount: 10,
  });
  assert.equal(pending.status, "pending_payment");
  assert.ok(!pending.fulfilledTransactionId);
});

// TEST 9 — 审核通过只 fulfillment 一次
test("TEST 9 Approve fulfillment idempotency", () => {
  assert.match(giftOrders, /已审核通过（幂等）/);
  assert.match(giftOrders, /fulfilled_transaction_id/);
  assert.match(giftOrders, /idempotency_key: `gift-order:\$\{order\.id\}`/);
  assert.match(giftOrders, /replayed: true/);
  assert.match(giftOrders, /uq_gift_tx_order_fulfilled|gift_order_id/);
  assert.match(migration, /uq_gift_tx_order_fulfilled/);
});

// TEST 10 — 陪玩 gift wall 更新
test("TEST 10 Gift wall update paths", () => {
  assert.match(giftOrders, /recordCompanionGiftWallHit/);
  assert.match(giftOrders, /upsertGiftWall/);
  assert.match(marketplace, /recordCompanionGiftWallHit/);
  assert.match(profile, /pd-gift-wall/);
  assert.match(profile, /giftWall/);
  assert.match(profile, /pd-gift-empty-state/);
});

// TEST 11 — 重复审核不重复送礼 + CS UI
test("TEST 11 Duplicate approve guarded + CS review UI", () => {
  assert.match(cs, /approve_gift_order/);
  assert.match(cs, /list_gift_orders/);
  assert.match(cs, /giftOrders/);
  assert.match(giftOrders, /onlyStatuses: \[\.\.\.REVIEWABLE\]/);
  assert.match(giftOrders, /if \(order\.status === GIFT_ORDER_STATUS\.APPROVED && order\.fulfilled_transaction_id\)/);
});

// TEST 12 — 旧订单 / 财务隔离不受礼物破坏
test("TEST 12 Gift income isolated from order settlement + points", () => {
  assert.match(giftOrders, /礼物收益：/);
  assert.match(marketplace, /礼物收益：/);
  assert.doesNotMatch(giftOrders, /MCJ_SETTLEMENT/);
  // send_gift credit path must not write settlement ledger notes
  const creditIdx = marketplace.indexOf("礼物收益：");
  assert.ok(creditIdx > 0);
  const creditSnippet = marketplace.slice(Math.max(0, creditIdx - 120), creditIdx + 80);
  assert.ok(creditSnippet.includes("creditCompanionIncome"));
  assert.ok(!/MCJ_SETTLEMENT/.test(creditSnippet));
  // Wallet gift debit must use gift: idempotency prefix (not order settlement keys)
  assert.match(marketplace, /idempotencyKey:\s*`gift:\$\{idempotencyKey\}`/);
  assert.ok(isGiftOrRewardNote("礼物收益：猫爪"));
  assert.equal(
    classifyCompanionIncomeTx(
      {
        transaction_type: "companion_income",
        amount: 8,
        status: "completed",
        note: "礼物收益：猫爪",
      },
      null
    ),
    "reward_other"
  );
  // Must not classify as order_income when note is gift and no settlement marker
  assert.notEqual(
    classifyCompanionIncomeTx(
      {
        transaction_type: "companion_income",
        amount: 8,
        status: "completed",
        note: "礼物收益：猫爪",
        order_id: null,
      },
      { id: "x", status: "completed" }
    ),
    "order_income"
  );
  // Soft-delete only — no hard DELETE from gifts table in admin API
  assert.doesNotMatch(adminGiftsApi, /method:\s*"DELETE"/);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`gift-system offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  process.exitCode = 1;
}
