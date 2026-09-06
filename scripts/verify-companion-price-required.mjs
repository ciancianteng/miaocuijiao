/**
 * Unit checks: companions must have price > 0 OR any game_prices > 0
 * before application submit / admin approval can treat them as price-ready.
 */
import assert from "node:assert/strict";
import {
  hasPositivePrice,
  priceCheckRow,
  assertHasPositivePrice,
  MISSING_PRICE_MESSAGE,
} from "../server/api/_companion-publish-gate.js";

assert.equal(hasPositivePrice({ price: 0, game_prices: {} }), false);
assert.equal(hasPositivePrice({ price: 10 }), true);
assert.equal(hasPositivePrice({ price: 0, game_prices: { apex: 25 } }), true);
assert.equal(hasPositivePrice({ price: "0", gamePrices: { valorant: "0" } }), false);
assert.equal(hasPositivePrice(priceCheckRow({ hourlyPrice: 18 })), true);
assert.equal(hasPositivePrice(priceCheckRow({ gamePriceMap: { mlbb: 12 } })), true);
assert.equal(hasPositivePrice(priceCheckRow({ price: 0 }, { price: 0, game_prices: {} })), false);
assert.equal(hasPositivePrice(priceCheckRow({ price: 0 }, { game_prices: { x: 8 } })), true);

assert.throws(
  () => assertHasPositivePrice({ price: 0, game_prices: {} }),
  (err) => err && err.code === "MISSING_PRICE" && String(err.message).includes("接单价格")
);
assert.equal(assertHasPositivePrice({ price: 1 }), true);
assert.ok(MISSING_PRICE_MESSAGE);

console.log("verify-companion-price-required: ok");
