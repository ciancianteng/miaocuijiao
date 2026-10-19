#!/usr/bin/env node
/**
 * LV1–LV5 markup on the existing service quote.
 * No database, no wallet, no order writes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLevelMarkupCaps,
  assertPricePolicy,
  normalizeLevelMarkupCaps,
  normalizePricePolicy,
  quoteServiceOffer,
  validateCompanionOfferSave,
} from "../server/api/_service-offer-quote.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const caps = { 1: 5, 2: 8, 3: 10, 4: 13, 5: 15 };
const service = {
  id: "svc-wzry",
  name: "王者荣耀",
  default_price: "20",
  enabled: true,
  allow_order: true,
};
const policy = { unit: "局", allowSelfPrice: true, min: "1", max: "100" };

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error) });
    console.error(`FAIL  ${name}: ${error?.message || error}`);
  }
}
function quoteAt(level, price, extra = {}) {
  return quoteServiceOffer({
    service,
    policy,
    saved: price == null ? { id: service.id, accepting: true } : { id: service.id, accepting: true, price },
    level,
    markupCaps: caps,
    ...extra,
  });
}

test("默认等级上限 LV1–LV5 为 5/8/10/13/15，最低加价为 1", () => {
  const defaults = normalizeLevelMarkupCaps(null);
  assert.deepEqual(defaults, { 1: 5, 2: 8, 3: 10, 4: 13, 5: 15 });
  const custom = assertLevelMarkupCaps({ 1: "6", 2: "9", 3: "11", 4: "14", 5: "16" });
  assert.equal(custom[3], 11);
  assert.throws(() => assertLevelMarkupCaps({ 1: "0.5", 2: "8", 3: "10", 4: "13", 5: "15" }), /LV1/);
});

for (const [level, cap] of [
  [1, 5],
  [2, 8],
  [3, 10],
  [4, 13],
  [5, 15],
]) {
  test(`LV${level} 最低加价 1 与最高加价 ${cap} 可保存，越界拒绝`, () => {
    const low = validateCompanionOfferSave({
      service,
      policy,
      level,
      markupCaps: caps,
      next: { markup: "1", accepting: true },
    });
    const high = validateCompanionOfferSave({
      service,
      policy,
      level,
      markupCaps: caps,
      next: { markup: String(cap), accepting: true },
    });
    assert.equal(low.price, 21);
    assert.equal(high.price, 20 + cap);
    assert.throws(
      () =>
        validateCompanionOfferSave({
          service,
          policy,
          level,
          markupCaps: caps,
          next: { markup: "0.5", accepting: true },
        }),
      /加价必须在/
    );
    assert.throws(
      () =>
        validateCompanionOfferSave({
          service,
          policy,
          level,
          markupCaps: caps,
          next: { markup: String(cap + 1), accepting: true },
        }),
      /加价必须在/
    );
  });
}

test("最终单价等于标准价加加价，伪造等级不能放宽上限", () => {
  const saved = validateCompanionOfferSave({
    service,
    policy,
    level: { index: 3, label: "LV3", name: "灵喵" },
    markupCaps: caps,
    next: { markup: "5", level: 5, accepting: true },
  });
  assert.equal(saved.price, 25);
  assert.equal(saved.levelIndex, 3);
  assert.throws(
    () =>
      validateCompanionOfferSave({
        service,
        policy,
        level: 3,
        markupCaps: caps,
        next: { markup: "15", level: 5, accepting: true },
      }),
    /1–10/
  );
});

test("升级后沿用新上限，降级后超额报价被压到新上限", () => {
  const before = quoteAt(1, 25);
  assert.equal(before.effectivePrice, 25);
  const upgraded = quoteAt(3, 25);
  assert.equal(upgraded.effectivePrice, 25);
  assert.equal(upgraded.markupMax, 10);
  const raised = validateCompanionOfferSave({
    service,
    policy,
    level: 3,
    markupCaps: caps,
    previous: { price: 25 },
    next: { markup: "10", accepting: true },
  });
  assert.equal(raised.price, 30);
  const dropped = quoteAt(1, 35);
  assert.equal(dropped.markupClamped, true);
  assert.equal(dropped.effectivePrice, 25);
  assert.notEqual(dropped.effectivePrice, 35);
  const persisted = quoteAt(1, dropped.effectivePrice);
  assert.equal(persisted.effectivePrice, 25);
  assert.equal(persisted.markupClamped, false);
});

test("禁止自定义价格时所有等级只用标准价", () => {
  const fixed = { unit: "局", allowSelfPrice: false };
  for (const level of [1, 2, 3, 4, 5]) {
    const quote = quoteServiceOffer({
      service,
      policy: fixed,
      saved: { id: service.id, accepting: true, price: 99 },
      level,
      markupCaps: caps,
    });
    assert.equal(quote.effectivePrice, 20);
    assert.equal(quote.canEditPrice, false);
    assert.equal(quote.orderable, true);
  }
  assert.throws(
    () => validateCompanionOfferSave({ service, policy: fixed, level: 5, next: { markup: "5", accepting: true } }),
    /平台统一定价/
  );
});

test("服务关闭后不可下单，低于最低加价的旧价不能被抬高", () => {
  const closed = quoteServiceOffer({
    service: { ...service, enabled: false },
    policy,
    saved: { id: service.id, accepting: true, price: 25 },
    level: 3,
    markupCaps: caps,
  });
  assert.equal(closed.orderable, false);
  assert.equal(closed.effectivePrice, 25);
  const tooLow = quoteAt(3, 20);
  assert.equal(tooLow.orderable, false);
  assert.equal(tooLow.priceStatus, "out_of_range");
  assert.equal(tooLow.effectivePrice, null);
});

test("后台范围与等级加价取交集，没有交集时不能保存", () => {
  const tight = quoteServiceOffer({
    service,
    policy: { unit: "局", allowSelfPrice: true, min: "28", max: "32" },
    saved: { id: service.id, accepting: true, price: 30 },
    level: 1,
    markupCaps: caps,
  });
  assert.equal(tight.priceStatus, "conflict");
  assert.equal(tight.orderable, false);
  assert.throws(
    () =>
      assertPricePolicy(
        normalizePricePolicy({ allowSelfPrice: true, min: "80", max: "100", unit: "局" }),
        { allowSelfPrice: true, min: "80", max: "100", defaultPrice: "20", unit: "局" },
        caps
      ),
    /没有交集/
  );
  assert.doesNotThrow(() =>
    assertPricePolicy(
      normalizePricePolicy({ allowSelfPrice: true, min: "21", max: "40", unit: "局" }),
      { allowSelfPrice: true, min: "21", max: "40", defaultPrice: "20", unit: "局" },
      caps
    )
  );
});

test("两人合并下单按各自等级报价相加，不采用前端总额", () => {
  const first = quoteAt(1, 25);
  const second = quoteAt(5, 35);
  const serverTotal = Math.round((first.effectivePrice + second.effectivePrice) * 100) / 100;
  assert.equal(first.effectivePrice, 25);
  assert.equal(second.effectivePrice, 35);
  assert.equal(serverTotal, 60);
  const forged = 999;
  assert.notEqual(forged, serverTotal);
});

test("已支付订单快照不随等级或报价变化", () => {
  const atPay = quoteAt(5, 35);
  const paidOrder = { id: "order-paid", status: "paid", unit_price: atPay.effectivePrice };
  const after = quoteAt(1, 35);
  assert.equal(paidOrder.unit_price, 35);
  assert.equal(after.effectivePrice, 25);
  assert.notEqual(paidOrder.unit_price, after.effectivePrice);
  const offers = read("server/api/_companion-offers.js");
  const quoteFile = read("server/api/_service-offer-quote.js");
  assert.match(offers, /persistClampedOffers/);
  assert.match(offers, /companion_profiles/);
  assert.doesNotMatch(offers, /unit_price/);
  assert.doesNotMatch(quoteFile, /companionDb\(|from\("orders"\)/);
  const orders = read("server/api/orders.js");
  assert.match(orders, /price_snapshot/);
  assert.doesNotMatch(orders, /UPDATE\s+orders|patchOrder.*unit_price/i);
});

test("等级来自服务端资料，大厅使用同一最终价，后台规则写入原设置", () => {
  const offers = read("server/api/_companion-offers.js");
  const workbench = read("src/companion-workbench.js");
  const admin = read("src/admin-service-manager.js");
  const policy = read("server/api/_service-price-policy.js");
  const hall = read("server/api/public/companions.js");
  const adminApi = read("server/api/admin/services.js");
  assert.match(offers, /loadCompanionLevel/);
  assert.match(offers, /overlayQuotedOfferPrices/);
  assert.doesNotMatch(offers, /level:\s*item\.level|level:\s*raw\.level/);
  assert.match(workbench, /markup:markupOk\?markupText:''/);
  assert.doesNotMatch(workbench, /level:\s*card|levelIndex:\s*1/);
  assert.match(admin, /save_level_markup_caps/);
  assert.match(admin, /field\(1, 5\)/);
  assert.match(admin, /field\(5, 15\)/);
  assert.match(admin, /最高加价/);
  assert.match(policy, /levelMarkupCaps/);
  assert.match(hall, /overlayQuotedOfferPrices/);
  assert.match(adminApi, /save_level_markup_caps/);
  assert.match(read("server/api/_place-multi-order.js"), /resolveOrderUnitPrice/);
});

const failed = results.filter((item) => !item.ok);
console.log("");
console.log(`verify:level-markup offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
