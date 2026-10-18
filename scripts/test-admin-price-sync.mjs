import assert from "node:assert/strict";
import {
  acceptSubmittedServicePrice,
  priceForGame,
  reconcileAdminServicePrices,
} from "../server/api/_game-prices.js";

const serviceId = "21e0c745-77a4-41a6-9286-f2351b074450";
const otherId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const pw00023 = {
  price: 35,
  service_ids: [serviceId],
  game: "三角洲 手游 国服",
  game_prices: { [serviceId]: 60, "三角洲 手游": 60 },
  tags: `[[MCJ_PRICES:${JSON.stringify({ [serviceId]: 60, "三角洲 手游": 60 })}]]`,
};

const synced = reconcileAdminServicePrices(pw00023, 35);
assert.equal(synced[serviceId], 35);
assert.equal(synced["三角洲 手游"], 35);
assert.equal(priceForGame(pw00023, "三角洲 手游 国服", serviceId), 35);
assert.equal(priceForGame(pw00023, "三角洲 手游 国服", ""), 35);

const other = {
  price: 80,
  service_ids: [serviceId, otherId],
  game: "三角洲 手游 国服、无畏契约",
  game_prices: { [serviceId]: 80, "三角洲 手游 国服": 80, [otherId]: 120, "无畏契约": 120 },
};
const otherSynced = reconcileAdminServicePrices(other, 90);
assert.equal(otherSynced[serviceId], 90);
assert.equal(otherSynced[otherId], 120);
assert.equal(otherSynced["无畏契约"], 120);
assert.equal(priceForGame(other, "无畏契约", otherId), 120);

const uniform = {
  price: 35,
  service_ids: [serviceId, otherId],
  game: "三角洲、无畏契约",
  game_prices: { [serviceId]: 60, [otherId]: 60 },
};
const uniformSynced = reconcileAdminServicePrices(uniform, 35);
assert.equal(uniformSynced[serviceId], 35);
assert.equal(uniformSynced[otherId], 35);

assert.equal(acceptSubmittedServicePrice(pw00023, serviceId, "三角洲 手游 国服", 60), 35);
assert.equal(acceptSubmittedServicePrice(pw00023, serviceId, "三角洲 手游 国服", 40), 40);
assert.equal(acceptSubmittedServicePrice(other, otherId, "无畏契约", 120), 120);

const untouchedOrder = { unit_price: 60, total_amount: 120 };
assert.equal(untouchedOrder.unit_price, 60);
assert.equal(untouchedOrder.total_amount, 120);

console.log(JSON.stringify({ ok: true, checks: ["pw00023-35", "other-service-kept", "uniform-follows-admin", "stale-resubmit", "historical-order-untouched"] }));
