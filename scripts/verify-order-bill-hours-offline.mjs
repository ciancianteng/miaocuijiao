/**
 * Offline regression: unit × hours must not collapse when quantity defaults to 1.
 */
import assert from "node:assert/strict";
import {
  computeOrderBillAmount,
  isPerGamePricingUnit,
  resolveBillingUnit,
} from "../server/api/_order-bill-amount.js";
import { normalizePricePolicy } from "../server/api/_service-price-policy.js";

// Empty policy must default to 小时 (not invent 局).
assert.equal(normalizePricePolicy({}).unit, "小时");
assert.equal(normalizePricePolicy({ unit: "局" }).unit, "局");

assert.equal(isPerGamePricingUnit("局"), true);
assert.equal(isPerGamePricingUnit("每局"), true);
assert.equal(isPerGamePricingUnit("per_game"), true);
assert.equal(isPerGamePricingUnit("小时"), false);
assert.equal(isPerGamePricingUnit("次"), false);

assert.equal(
  resolveBillingUnit({ companionUnit: "小时", catalogUnit: "局", fallback: "小时" }),
  "小时"
);

const cases = [
  { unit: 20, hours: 1, quantity: 1, pricingUnit: "小时", expect: 20 },
  { unit: 20, hours: 2, quantity: 1, pricingUnit: "小时", expect: 40 },
  { unit: 20, hours: 4, quantity: 1, pricingUnit: "小时", expect: 80 },
  // Legacy footgun: quantity=1 must NOT mask hours=4 even if unit wrongly says 局
  { unit: 20, hours: 4, quantity: 1, pricingUnit: "局", expect: 80 },
  { unit: 20, hours: 4, quantity: 2, pricingUnit: "小时", expect: 160 },
];

for (const c of cases) {
  const bill = computeOrderBillAmount({
    unitPrice: c.unit,
    hours: c.hours,
    quantity: c.quantity,
    pricingUnit: c.pricingUnit,
  });
  assert.equal(
    bill.totalAmount,
    c.expect,
    `unit=${c.unit} hours=${c.hours} qty=${c.quantity} unitLabel=${c.pricingUnit} => ${bill.totalAmount} want ${c.expect}`
  );
}

// Reproduce the old buggy expression and prove it fails for the real case.
const oldBuggyQty = Math.max(1, Math.floor(Number(1 || 4 || 1))); // quantity || hours
assert.equal(oldBuggyQty, 1);
assert.notEqual(oldBuggyQty * 20, 80);

console.log(
  JSON.stringify(
    {
      ok: true,
      samples: cases.map((c) => ({
        ...c,
        got: computeOrderBillAmount({
          unitPrice: c.unit,
          hours: c.hours,
          quantity: c.quantity,
          pricingUnit: c.pricingUnit,
        }).totalAmount,
      })),
    },
    null,
    2
  )
);
