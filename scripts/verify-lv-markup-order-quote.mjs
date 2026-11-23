/**
 * Offline: CAP is not auto-applied; companion markupAmount (default 0) drives final.
 */
import assert from "node:assert/strict";
import { quoteMarkupPrice, computeFinalPrice, markupFor, clampMarkupAmount } from "../server/api/_lv-markup.js";
import { quoteVisibleService, normalizePricePolicy } from "../server/api/_service-price-policy.js";

const row = { id: "svc-delta", enabled: true, allow_order: true, default_price: 40 };
const policy = normalizePricePolicy({ unit: "小时", allowSelfPrice: false });
const markupMap = new Map([
  [
    "svc-delta::lv2",
    { markupAllowance: 3, configured: true, source: "service_level_matrix" },
  ],
  [
    "svc-delta::lv1",
    { markupAllowance: 0, configured: true, source: "service_level_matrix" },
  ],
]);

// No companion markup → base only (even on Lv2 with CAP 3)
const lv2Default = quoteVisibleService({
  row,
  policy,
  offer: null,
  levelId: "lv2",
  markupMap,
});
assert.equal(lv2Default.price, 40);
assert.equal(lv2Default.markupAllowance, 3);
assert.equal(lv2Default.markupAmount, 0);
assert.equal(lv2Default.source, "catalog_base");

// Explicit +0
const lv2Zero = quoteVisibleService({
  row,
  policy,
  offer: { accepting: true, id: "svc-delta", markupAmount: 0 },
  levelId: "lv2",
  markupMap,
});
assert.equal(lv2Zero.price, 40);

// Active +1 / +2 / +3
for (const n of [1, 2, 3]) {
  const q = quoteVisibleService({
    row,
    policy,
    offer: { accepting: true, id: "svc-delta", markupAmount: n },
    levelId: "lv2",
    markupMap,
  });
  assert.equal(q.price, 40 + n, `+${n}`);
  assert.equal(q.markupAmount, n);
  assert.equal(q.source, "catalog_plus_markup");
}

// Over CAP clamps
const over = quoteMarkupPrice({
  serviceRow: row,
  levelId: "lv2",
  markupMap,
  markupAmount: 9,
});
assert.equal(over.finalPrice, 43);
assert.equal(over.markupAmount, 3);
assert.equal(clampMarkupAmount(9, 3), 3);

// Legacy markupOn:true without amount must NOT auto-fill CAP
const legacyOn = quoteVisibleService({
  row,
  policy,
  offer: { accepting: true, id: "svc-delta", markupOn: true },
  levelId: "lv2",
  markupMap,
});
assert.equal(legacyOn.price, 40);

// Lv1 CAP 0
const lv1 = quoteVisibleService({
  row,
  policy,
  offer: { accepting: true, markupAmount: 2 },
  levelId: "lv1",
  markupMap,
});
assert.equal(lv1.price, 40);
assert.equal(lv1.markupAmount, 0);

assert.equal(computeFinalPrice(40, 3, true), 43);
assert.equal(markupFor(markupMap, "svc-delta", "lv2").markupAllowance, 3);

// Missing matrix cell must NOT inherit companion_levels / __levelDefaults CAP.
markupMap.__levelDefaults = new Map([
  ["lv3", { markupAllowance: 3, configured: true, source: "companion_levels" }],
]);
const noInherit = quoteVisibleService({
  row,
  policy,
  offer: null,
  levelId: "lv3",
  markupMap,
});
assert.equal(noInherit.price, 40, "missing cell must stay base (no CAP inherit)");
assert.equal(noInherit.markupAllowance, 0);
assert.equal(markupFor(markupMap, "svc-delta", "lv3").markupAllowance, 0);

// Explicit +3 only when companion chose amount=3
const plus3 = quoteMarkupPrice({
  serviceRow: row,
  levelId: "lv2",
  markupMap,
  markupAmount: 3,
});
assert.equal(plus3.finalPrice, 43);

console.log(
  JSON.stringify(
    {
      ok: true,
      cases: {
        lv2Default: lv2Default.price,
        lv2Plus1: 41,
        lv2Plus3: plus3.finalPrice,
        overCap: over.finalPrice,
        legacyOn: legacyOn.price,
        lv1: lv1.price,
        noInherit: noInherit.price,
      },
    },
    null,
    2
  )
);
