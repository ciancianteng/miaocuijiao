/**
 * Offline checks for service × LV1–LV5 price matrix helpers.
 */
import assert from "node:assert/strict";
import {
  validateMatrixRow,
  normalizeMatrixRow,
  assertPriceInBand,
  LOCKED_MATRIX_LEVEL_IDS,
} from "../server/api/_service-level-prices.js";

assert.deepEqual(LOCKED_MATRIX_LEVEL_IDS, ["lv1", "lv2", "lv3", "lv4", "lv5"]);

const good = validateMatrixRow({
  serviceId: "svc-a",
  levelId: "lv2",
  basePrice: 30,
  minPrice: 25,
  maxPrice: 40,
  markupAllowance: 5,
});
assert.equal(good.ok, true, good.message);

const badMarkup = validateMatrixRow({
  serviceId: "svc-a",
  levelId: "lv2",
  basePrice: 30,
  minPrice: 25,
  maxPrice: 40,
  markupAllowance: 20,
});
assert.equal(badMarkup.ok, false);

const badLevel = validateMatrixRow({
  serviceId: "svc-a",
  levelId: "lv9",
  basePrice: 30,
  minPrice: 25,
  maxPrice: 40,
  markupAllowance: 0,
});
assert.equal(badLevel.ok, false);

const row = normalizeMatrixRow({
  service_id: "svc-b",
  level_id: "lv1",
  base_price: 20,
  min_price: 20,
  max_price: 30,
  markup_allowance: 5,
});
assert.equal(row.sellMax, 25);

const inBand = assertPriceInBand(24, row);
assert.equal(inBand.ok, true);
const outBand = assertPriceInBand(26, row);
assert.equal(outBand.ok, false);

console.log("verify-service-level-prices-offline: ok");
