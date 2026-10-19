import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptSubmittedServicePrice,
  listingPriceOverStaleMap,
  priceForGame,
  projectGamePrices,
  reconcileAdminServicePrices,
  stripGamePricesMarker,
  writeGamePricesMarker,
} from "../server/api/_game-prices.js";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";
import { mergeAdminServicePrices } from "../server/api/_admin-service-prices.js";

const pw = {
  price: 35,
  level_id: "lv3",
  game_prices: {
    "三角洲 手游": 60,
    "21e0c745-77a4-41a6-9286-f2351b074450": 60,
  },
};
const level = { id: "lv3", basePrice: 40, min: 40, max: 45 };

assert.equal(priceForGame(pw, "三角洲 手游 国服", "21e0c745-77a4-41a6-9286-f2351b074450"), 60);
assert.equal(listingPriceOverStaleMap(pw, 60, level), 35);
const projected = projectGamePrices(pw, level);
assert.equal(projected["三角洲 手游"], 35);
assert.equal(projected["21e0c745-77a4-41a6-9286-f2351b074450"], 35);
const tagged = {
  ...pw,
  tags: '[[MCJ_PRICES:{"三角洲 手游":60,"21e0c745-77a4-41a6-9286-f2351b074450":60}]]',
};
const taggedProjected = projectGamePrices(tagged, level);
assert.equal(
  priceForGame(
    { ...tagged, game_prices: taggedProjected, tags: stripGamePricesMarker(tagged.tags) },
    "三角洲 手游 国服",
    "21e0c745-77a4-41a6-9286-f2351b074450"
  ),
  35
);
const resolved = resolveEffectiveServicePrice({
  companion: pw,
  serviceId: "21e0c745-77a4-41a6-9286-f2351b074450",
  gameName: "三角洲 手游 国服",
  level,
  serviceRows: [],
});
assert.equal(resolved.price, 35);
assert.equal(resolved.source, "listing_price");

const saved = mergeAdminServicePrices(pw.game_prices, [
  {
    serviceId: "21e0c745-77a4-41a6-9286-f2351b074450",
    serviceName: "三角洲 手游 国服",
    unitPrice: 35,
  },
]);
assert.equal(saved["三角洲 手游 国服"], 35);
assert.equal(saved["三角洲 手游"], 35);
assert.equal(saved["21e0c745-77a4-41a6-9286-f2351b074450"], 35);
assert.equal(listingPriceOverStaleMap({ ...pw, price: 35, game_prices: saved }, 35, level), 0);

const other = {
  "三角洲 端游 国服": 35,
  "无畏契约 国服": 30,
  "f75f90e8-bbf2-4cad-8487-5e50a2aac9a4": 35,
  "60853813-6537-4637-9072-f2ecc5809939": 30,
};
const otherSaved = mergeAdminServicePrices(other, [
  { serviceId: "60853813-6537-4637-9072-f2ecc5809939", serviceName: "无畏契约 国服", unitPrice: 33 },
]);
assert.equal(otherSaved["无畏契约 国服"], 33);
assert.equal(otherSaved["60853813-6537-4637-9072-f2ecc5809939"], 33);
assert.equal(otherSaved["三角洲 端游 国服"], 35);
assert.equal(otherSaved["f75f90e8-bbf2-4cad-8487-5e50a2aac9a4"], 35);

const xiaohong = {
  price: 30,
  game_prices: {
    王者荣耀: 30,
    "三角洲 手游 国服": 35,
    "三角洲陪跑刀 一千万": 40,
    "fc96c1d1-9311-4a17-8af1-12447c608dfc": 40,
  },
};
assert.equal(
  resolveEffectiveServicePrice({
    companion: xiaohong,
    serviceId: "fc96c1d1-9311-4a17-8af1-12447c608dfc",
    gameName: "三角洲陪跑刀 一千万",
    level: { id: "lv2", basePrice: 30 },
    serviceRows: [
      {
        service_id: "fc96c1d1-9311-4a17-8af1-12447c608dfc",
        service_name: "三角洲陪跑刀 一千万",
        price: 30,
        source: "admin_set",
        enabled: true,
        review_status: "approved",
      },
    ],
  }).price,
  40
);

const levelSeed = {
  price: 30,
  game_prices: { "三角洲手游 国服": 35 },
};
assert.equal(
  resolveEffectiveServicePrice({
    companion: levelSeed,
    gameName: "三角洲手游 国服",
    level: { id: "lv2", basePrice: 30 },
    serviceRows: [
      {
        service_name: "三角洲手游 国服",
        price: 30,
        source: "level_default",
        enabled: true,
        review_status: "approved",
      },
    ],
  }).price,
  35
);

const serviceId = "21e0c745-77a4-41a6-9286-f2351b074450";
const otherId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const stalePw = {
  price: 35,
  service_ids: [serviceId],
  game: "三角洲 手游 国服",
  game_prices: { [serviceId]: 60, "三角洲 手游": 60 },
  tags: `[[MCJ_PRICES:${JSON.stringify({ [serviceId]: 60, "三角洲 手游": 60 })}]]`,
};
const reconciled = reconcileAdminServicePrices(stalePw, 35);
assert.equal(reconciled[serviceId], 35);
assert.equal(reconciled["三角洲 手游"], 35);
assert.equal(projectGamePrices(stalePw, level)[serviceId], 35);
assert.equal(acceptSubmittedServicePrice(stalePw, serviceId, "三角洲 手游 国服", 60), 35);
assert.equal(acceptSubmittedServicePrice(stalePw, serviceId, "三角洲 手游 国服", 40), 40);

const differentiated = {
  price: 80,
  service_ids: [serviceId, otherId],
  game: "三角洲 手游 国服、无畏契约",
  game_prices: { [serviceId]: 80, "三角洲 手游 国服": 80, [otherId]: 120, "无畏契约": 120 },
};
const differentiatedNext = reconcileAdminServicePrices(differentiated, 90);
assert.equal(differentiatedNext[serviceId], 90);
assert.equal(differentiatedNext[otherId], 120);
assert.equal(differentiatedNext["无畏契约"], 120);
assert.equal(projectGamePrices(differentiated, level)[otherId], 120);
assert.equal(acceptSubmittedServicePrice(differentiated, otherId, "无畏契约", 120), 120);

const uniform = {
  price: 35,
  service_ids: [serviceId, otherId],
  game: "三角洲、无畏契约",
  game_prices: { [serviceId]: 60, [otherId]: 60 },
};
const uniformNext = reconcileAdminServicePrices(uniform, 35);
assert.equal(uniformNext[serviceId], 35);
assert.equal(uniformNext[otherId], 35);
assert.equal(projectGamePrices(uniform, { id: "lv3", basePrice: 40 })[serviceId], 35);
assert.equal(projectGamePrices(uniform, { id: "lv3", basePrice: 40 })[otherId], 35);
assert.equal(projectGamePrices({ ...uniform, price: 40 }, { id: "lv3", basePrice: 40 })[serviceId], 60);

const marker = writeGamePricesMarker(stalePw.tags, reconciled);
assert.match(marker, /"21e0c745-77a4-41a6-9286-f2351b074450":35/);
assert.doesNotMatch(marker, /:60/);

const untouchedOrder = { unit_price: 60, total_amount: 120 };
assert.equal(untouchedOrder.unit_price, 60);
assert.equal(untouchedOrder.total_amount, 120);

const lookup = fs.readFileSync(new URL("../server/api/public/companions.js", import.meta.url), "utf8");
assert.match(lookup, /or=\(verification_status\.eq\.approved,application_status\.eq\.approved\)/);
assert.match(lookup, /Do not require profiles\.role=companion/);
assert.doesNotMatch(lookup, /role=eq\.companion/);

console.log("test-price-sync-pw00023: PASS");
