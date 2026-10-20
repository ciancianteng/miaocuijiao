import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quoteVisibleService, normalizePricePolicy, assertWritablePricePolicy } from "../server/api/_service-price-policy.js";
import { assertCompanionOfferPrice, companionAcceptingFlag } from "../server/api/_companion-offers.js";
import { buildServiceSnapshot } from "../server/api/_service-standard.js";

const policy = normalizePricePolicy({
  priceMin: "20",
  priceMax: "40",
  unit: "局",
  allowSelfPrice: false,
  description: "  爆破模式全程语音  ",
  requirements: "需要开麦",
});
assert.equal(policy.unit, "局");
assert.equal(policy.description, "爆破模式全程语音");
assert.equal(policy.requirements, "需要开麦");
assert.equal(policy.allowSelfPrice, false);

const closed = quoteVisibleService({
  row: { id: "s1", enabled: false, allow_order: true, default_price: "30" },
  policy,
  offer: null,
});
assert.equal(closed.visible, false);
assert.equal(closed.blocked, true);

const hiddenOrder = quoteVisibleService({
  row: { id: "s1", enabled: true, allow_order: false, default_price: "30" },
  policy,
  offer: null,
});
assert.equal(hiddenOrder.visible, false);

const platform = quoteVisibleService({
  row: { id: "s1", enabled: true, allow_order: true, default_price: "28" },
  policy,
  offer: { accepting: true, price: 99 },
});
assert.equal(platform.visible, true);
assert.equal(platform.price, 28);
assert.equal(platform.source, "platform_default");
assert.equal(platform.unit, "局");
assert.equal(platform.description, "爆破模式全程语音");

const selfPolicy = normalizePricePolicy({ ...policy, allowSelfPrice: true, min: 20, max: 40 });
const custom = quoteVisibleService({
  row: { id: "s1", enabled: true, allow_order: true, default_price: "28" },
  policy: selfPolicy,
  offer: { accepting: true, price: 32 },
});
assert.equal(custom.price, 32);
assert.equal(custom.source, "companion_offer");

const companionOff = quoteVisibleService({
  row: { id: "s1", enabled: true, allow_order: true, default_price: "28" },
  policy,
  offer: { accepting: false, price: null },
});
assert.equal(companionOff.visible, false);

assert.throws(
  () => assertCompanionOfferPrice({ price: 50 }, { allowSelfPrice: false }, null),
  /平台统一设置/
);
assert.doesNotThrow(() => assertCompanionOfferPrice({ price: null, accepting: false }, { allowSelfPrice: false }, null));
assert.throws(
  () => assertCompanionOfferPrice({ price: 80 }, { allowSelfPrice: true, min: 20, max: 40 }, null),
  /不得高于/
);
assert.equal(companionAcceptingFlag({ accepting: true, enabled: false }), true);
assert.equal(companionAcceptingFlag({ accepting: false, enabled: true }), false);
assert.equal(companionAcceptingFlag({ enabled: false }), false);
assert.throws(() => assertWritablePricePolicy({ unit: "分钟", priceMin: 1, priceMax: 2 }), /计价单位/);
assert.throws(() => assertWritablePricePolicy({ unit: "局", priceMin: -1 }), /最低价格/);
assert.doesNotThrow(() => assertWritablePricePolicy({ unit: "小时", priceMin: "", priceMax: 10 }));

const snap = buildServiceSnapshot({
  serviceId: "s1",
  serviceName: "无畏契约",
  unitPrice: 28,
  pricingUnit: "局",
  catalogDescription: "爆破模式全程语音",
  catalogRequirements: "需要开麦",
});
assert.equal(snap.unitPrice, 28);
assert.equal(snap.pricingUnit, "局");
assert.equal(snap.catalogDescription, "爆破模式全程语音");
assert.equal(snap.catalogRequirements, "需要开麦");

const css = readFileSync(new URL("../src/admin-service-manager.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../src/admin-service-manager.js", import.meta.url), "utf8");
assert.match(css, /\.svc-mini-toggle input \{[\s\S]*clip: rect\(0, 0, 0, 0\)/);
assert.match(css, /\.svc-field-card-flags \{[\s\S]*grid-template-columns: 1fr;/);
assert.match(js, /name="description"/);
assert.match(js, /name="requirements"/);
assert.match(js, /<span>必填<\/span>/);
assert.match(js, /<span>启用<\/span>/);
assert.doesNotMatch(css, /grid-template-columns: minmax\(0, 1fr\) 92px auto/);

const workbench = readFileSync(new URL("../src/companion-workbench.js", import.meta.url), "utf8");
assert.match(workbench, /服务内容/);
assert.match(workbench, /平台状态/);
assert.match(workbench, /data-offer-toggle/);
assert.match(workbench, /关闭接单/);
const ordersSrc = readFileSync(new URL("../server/api/orders.js", import.meta.url), "utf8");
const multiSrc = readFileSync(new URL("../server/api/_place-multi-order.js", import.meta.url), "utf8");
assert.match(ordersSrc, /catalogDescription: resolved\.catalogDescription/);
assert.match(readFileSync(new URL("../server/api/admin/services.js", import.meta.url), "utf8"), /价格、单位或介绍没有保存/);
assert.match(readFileSync(new URL("../server/api/admin/services.js", import.meta.url), "utf8"), /服务价格必须是大于或等于 0 的数字/);
assert.doesNotMatch(multiSrc, /allowLineAmountSnapshot/);
assert.match(multiSrc, /code: "SERVICE_CLOSED"/);
assert.match(multiSrc, /catalogDescription: line\.catalogDescription/);
assert.match(readFileSync(new URL("../place-order.html", import.meta.url), "utf8"), /mcj-time-picker\.js\?v=20261019appt1/);

console.log("verify-service-catalog-flow: PASS");
