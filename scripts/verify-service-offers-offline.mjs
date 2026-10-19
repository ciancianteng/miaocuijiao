#!/usr/bin/env node
/**
 * Offline checks for platform service offers.
 * No database and no order/wallet writes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPricePolicy,
  mergeOfferLists,
  normalizePricePolicy,
  acceptedLegacyPrice,
  offerPlaceLabel,
  parseMoneyStrict,
  quoteServiceOffer,
  validateCompanionOfferSave,
} from "../server/api/_service-offer-quote.js";

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
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error) });
    console.error(`FAIL  ${name}: ${error?.message || error}`);
  }
}

const service = {
  id: "svc-1",
  name: "无畏契约排位",
  category: "端游",
  icon: "🎮",
  default_price: "25",
  enabled: true,
  allow_order: true,
};
const fixed = { unit: "小时", allowSelfPrice: false, gameName: "无畏契约", platform: "端游 / 国服", description: "排位上分" };
const custom = { ...fixed, allowSelfPrice: true, min: "20", max: "40" };

test("平台统一定价使用标准价，且没有自定义入口", () => {
  const quote = quoteServiceOffer({ service, policy: fixed, saved: { id: "svc-1", accepting: true, price: null } });
  assert.equal(quote.effectivePrice, 25);
  assert.equal(quote.canEditPrice, false);
  assert.equal(quote.orderable, true);
  assert.equal(quote.priceMessage, "此项目由平台统一定价。");
  assert.equal(quote.unit, "小时");
  assert.equal(quote.gameName, "无畏契约");
});

test("从未保存的服务默认关闭，不能下单", () => {
  const quote = quoteServiceOffer({ service, policy: fixed, saved: null });
  assert.equal(quote.accepting, false);
  assert.equal(quote.orderable, false);
  assert.equal(quote.persisted, false);
});

test("关闭接单后不再可下单，标准价仍可计算", () => {
  const quote = quoteServiceOffer({ service, policy: fixed, saved: { id: "svc-1", accepting: false } });
  assert.equal(quote.accepting, false);
  assert.equal(quote.orderable, false);
  assert.equal(quote.effectivePrice, 25);
});

test("允许自定义且价格在区间内", () => {
  const quote = quoteServiceOffer({
    service,
    policy: custom,
    saved: { id: "svc-1", accepting: true, price: 30 },
    level: 5,
  });
  assert.equal(quote.canEditPrice, true);
  assert.equal(quote.effectivePrice, 30);
  assert.equal(quote.min, 20);
  assert.equal(quote.max, 40);
  assert.equal(quote.orderable, true);
  assert.equal(quote.savedMarkup, 5);
});

test("超过等级或后台上限的已存价格按合法上限计价", () => {
  const quote = quoteServiceOffer({
    service,
    policy: custom,
    saved: { id: "svc-1", accepting: true, price: 55 },
    level: 5,
  });
  assert.equal(quote.orderable, true);
  assert.equal(quote.markupClamped, true);
  assert.equal(quote.effectivePrice, 40);
  assert.notEqual(quote.effectivePrice, 55);
});

test("未设置自定义单价不能下单", () => {
  const quote = quoteServiceOffer({ service, policy: custom, level: 5, saved: { id: "svc-1", accepting: true, price: null } });
  assert.equal(quote.orderable, false);
  assert.equal(quote.priceStatus, "unset");
});

test("后台未配置标准价显示平台尚未配置价格", () => {
  const quote = quoteServiceOffer({
    service: { ...service, default_price: "" },
    policy: fixed,
    saved: { id: "svc-1", accepting: true },
  });
  assert.equal(quote.standardPrice, null);
  assert.equal(quote.orderable, false);
  assert.equal(quote.priceMessage, "平台尚未配置价格");
  assert.equal(quote.canEditPrice, false);
});

test("允许自定义但没有区间时不编造范围", () => {
  const quote = quoteServiceOffer({
    service,
    policy: { ...fixed, allowSelfPrice: true },
    saved: { id: "svc-1", accepting: true, price: 25 },
  });
  assert.equal(quote.min, null);
  assert.equal(quote.max, null);
  assert.equal(quote.canEditPrice, false);
  assert.equal(quote.orderable, false);
  assert.equal(quote.priceMessage, "平台尚未配置价格");
});

test("后台停用或禁止下单后不可下单", () => {
  const disabled = quoteServiceOffer({
    service: { ...service, enabled: false },
    policy: fixed,
    saved: { id: "svc-1", accepting: true },
  });
  const closed = quoteServiceOffer({
    service: { ...service, allow_order: false },
    policy: fixed,
    saved: { id: "svc-1", accepting: true },
  });
  assert.equal(disabled.orderable, false);
  assert.equal(closed.orderable, false);
});

test("负数、非法字符和空价格", () => {
  assert.equal(parseMoneyStrict("-1").error, "不允许输入负数或非法字符。");
  assert.equal(parseMoneyStrict("10abc").error, "不允许输入负数或非法字符。");
  assert.equal(parseMoneyStrict("1e2").error, "不允许输入负数或非法字符。");
  assert.equal(parseMoneyStrict("").empty, true);
  assert.equal(parseMoneyStrict("25.50").value, 25.5);
});

test("后台保存拒绝不完整自定义区间和非法价格", () => {
  assert.throws(
    () => assertPricePolicy(normalizePricePolicy({ allowSelfPrice: true, unit: "小时" }), { allowSelfPrice: true }),
    /最低和最高价格/
  );
  assert.throws(
    () => assertPricePolicy(normalizePricePolicy({ min: "40", max: "20", allowSelfPrice: true }), { min: "40", max: "20", allowSelfPrice: true }),
    /最高价格不能低于最低价格/
  );
  assert.throws(() => assertPricePolicy(normalizePricePolicy({ defaultPrice: "-5" }), { defaultPrice: "-5" }), /负数或非法字符/);
  const ok = normalizePricePolicy(custom);
  assert.doesNotThrow(() => assertPricePolicy(ok, custom));
  assert.equal(ok.description, "排位上分");
});

test("后端拒绝超范围、统一定价改价、未设价开启", () => {
  assert.throws(
    () => validateCompanionOfferSave({ service, policy: custom, level: 5, next: { price: "80", accepting: true } }),
    /1–15/
  );
  assert.throws(
    () => validateCompanionOfferSave({ service, policy: fixed, next: { price: "30", accepting: true } }),
    /平台统一定价/
  );
  assert.throws(
    () => validateCompanionOfferSave({ service, policy: custom, level: 5, next: { price: "", accepting: true } }),
    /请先设置有效单价/
  );
  const on = validateCompanionOfferSave({ service, policy: fixed, next: { price: "", accepting: true } });
  assert.equal(on.accepting, true);
  assert.equal(on.price, null);
  const priced = validateCompanionOfferSave({ service, policy: custom, level: 5, next: { price: "28.5", accepting: true } });
  assert.equal(priced.price, 28.5);
});

test("关闭服务不会清掉已保存的自定义价格", () => {
  const saved = validateCompanionOfferSave({
    service,
    policy: custom,
    previous: { price: 30 },
    next: { price: "", accepting: false },
  });
  assert.equal(saved.accepting, false);
  assert.equal(saved.price, 30);
});

test("部分保存不会清掉未提交的其他服务", () => {
  const allowed = new Set(["service:a", "service:b"]);
  const merged = mergeOfferLists(
    [
      { kind: "service", id: "a", accepting: true },
      { kind: "service", id: "b", accepting: false },
    ],
    [{ kind: "service", id: "a", accepting: false }],
    allowed
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "b").accepting, false);
});

test("下单重验和成交价快照仍写在原订单接口", () => {
  const orders = read("server/api/orders.js");
  const resolver = read("server/api/_admin-service-prices.js");
  const multi = read("server/api/_place-multi-order.js");
  assert.match(orders, /price_snapshot/);
  assert.match(orders, /catalogHit/);
  assert.match(orders, /计价单位已变化/);
  assert.match(resolver, /catalogHit: true/);
  assert.match(resolver, /offer\.orderable !== true/);
  assert.doesNotMatch(resolver, /if \(!offer\) return resolved/);
  assert.match(multi, /price_snapshot/);
  assert.match(multi, /resolved\?\.blocked/);
});

test("区间价和空标准价不能变成可下单单价", () => {
  const ranged = quoteServiceOffer({
    service: { ...service, name: "三角洲 端游 国服", default_price: "30-50" },
    policy: { unit: "小时", allowSelfPrice: false },
    saved: { id: "svc-1", accepting: true, price: null },
  });
  assert.equal(ranged.standardPrice, null);
  assert.equal(ranged.orderable, false);
  assert.equal(ranged.priceMessage, "平台尚未配置价格");
  assert.equal(offerPlaceLabel({ name: "无畏契约 端游 国际服", category: "端游" }, {}), "端游 / 国际服");
  assert.equal(offerPlaceLabel({ name: "1陪2 国服 端游" }, {}), "端游 / 国服");
  assert.equal(acceptedLegacyPrice(40, { allowSelfPrice: true, min: 30, max: 50, unit: "小时" }), 40);
  assert.equal(acceptedLegacyPrice(10, { allowSelfPrice: true, min: 30, max: 50, unit: "小时" }), null);
  assert.equal(acceptedLegacyPrice(40, { allowSelfPrice: false, unit: "小时" }), null);
});

test("陪玩卡片和老板资料不再拼出 RM-", () => {
  const workbench = read("src/companion-workbench.js");
  const profile = read("src/profile-detail.js");
  const admin = read("src/admin-service-manager.js");
  assert.match(workbench, /后台标准价格：RM /);
  assert.match(workbench, /当前等级：/);
  assert.match(workbench, /等级允许加价/);
  assert.match(workbench, /自定义加价/);
  assert.match(workbench, /最终展示价格/);
  assert.match(workbench, /保存价格/);
  assert.match(workbench, /开启接单/);
  assert.match(workbench, /平台尚未配置价格/);
  assert.match(workbench, /此项目由平台统一定价。/);
  assert.doesNotMatch(workbench, /平台允许价格|修改价格|我的价格：RM/);
  assert.match(profile, /lockOfferServices/);
  assert.match(profile, /orderable === true/);
  assert.match(profile, /pd-offer-go/);
  assert.match(profile, /certHtml \|\| ""/);
  assert.match(profile, /选择此服务/);
  assert.match(profile, /暂无服务介绍/);
  const drawer = read("src/admin-suite.css");
  const review = read("src/admin-player-detail.js");
  assert.match(drawer, /top:env\(safe-area-inset-top,0px\)/);
  assert.match(drawer, /bottom:env\(safe-area-inset-bottom,0px\)/);
  assert.match(drawer, /player-drawer-scroll/);
  assert.doesNotMatch(drawer, /player-drawer-actions\{position:sticky/);
  assert.match(review, /未知（历史记录未保存）/);
  assert.doesNotMatch(review, /applicationReviewedAt \|\| d\.updated_at/);
  assert.match(admin, /游戏名称/);
  assert.match(admin, /平台尚未配置价格/);
  assert.doesNotMatch(admin, /默认 RM/);
});

const failed = results.filter((item) => !item.ok);
console.log("");
console.log(`verify:service-offers offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
