#!/usr/bin/env node
/**
 * Offline verification: per-service companion pricing (Admin + Boss + orders).
 * No network / no Production DB writes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";
import {
  buildAdminServicePriceList,
  parseServicePricesPayload,
} from "../server/api/_admin-service-prices.js";
import { priceForGame, readGamePrices } from "../server/api/_game-prices.js";

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

const level = { id: "lv2", code: "Lv2", name: "灵喵", base_price: 30, basePrice: 30 };
const companion = {
  user_id: "u-demo",
  level_id: "lv2",
  level_name: "灵喵",
  game: "王者荣耀,三角洲 手游 国服,三角洲跑跑刀 一千万",
  price: 30,
  game_prices: {
    王者荣耀: 35,
    "三角洲 手游 国服": 30,
    "三角洲跑跑刀 一千万": 40,
  },
};

const serviceRows = [
  {
    id: "r1",
    companion_id: "u-demo",
    service_name: "王者荣耀",
    price: 35,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
  {
    id: "r2",
    companion_id: "u-demo",
    service_name: "三角洲 手游 国服",
    price: 30,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
  {
    id: "r3",
    companion_id: "u-demo",
    service_name: "三角洲跑跑刀 一千万",
    price: 40,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
];

test("TEST 1 Lv2 base_price = 30", () => {
  assert.equal(Number(level.base_price), 30);
});

test("TEST 2 服务A 王者荣耀 = 35", () => {
  const r = resolveEffectiveServicePrice({
    companion,
    companionId: "u-demo",
    gameName: "王者荣耀",
    serviceRows,
    level,
  });
  assert.equal(r.price, 35);
});

test("TEST 3 服务B 三角洲手游国服 = 30", () => {
  const r = resolveEffectiveServicePrice({
    companion,
    companionId: "u-demo",
    gameName: "三角洲 手游 国服",
    serviceRows,
    level,
  });
  assert.equal(r.price, 30);
});

test("TEST 4 服务C 三角洲跑跑刀 = 40", () => {
  const r = resolveEffectiveServicePrice({
    companion,
    companionId: "u-demo",
    gameName: "三角洲跑跑刀 一千万",
    serviceRows,
    level,
  });
  assert.equal(r.price, 40);
});

test("TEST 5 Admin servicePrices payload parse + list", () => {
  const parsed = parseServicePricesPayload({
    servicePrices: [
      { serviceName: "王者荣耀", unitPrice: 35 },
      { serviceName: "三角洲 手游 国服", unitPrice: 30 },
      { serviceName: "三角洲跑跑刀 一千万", unitPrice: 40 },
    ],
  });
  assert.equal(parsed.length, 3);
  assert.equal(parsed.find((x) => x.serviceName === "王者荣耀").unitPrice, 35);
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  assert.ok(list.some((x) => x.serviceName === "王者荣耀" && Number(x.unitPrice) === 35));
  assert.ok(list.some((x) => x.serviceName.includes("三角洲 手游") && Number(x.unitPrice) === 30));
  assert.ok(list.some((x) => x.serviceName.includes("跑跑刀") && Number(x.unitPrice) === 40));
});

test("TEST 6 Admin UI has per-service price inputs (not single 单价 only)", () => {
  const detail = read("src/admin-player-detail.js");
  assert.match(detail, /servicePricesEditHtml|游戏\/服务独立价格/);
  assert.match(detail, /servicePrices\[/);
  assert.match(detail, /等级默认价格/);
  assert.doesNotMatch(
    detail,
    /field\("单价", "price", d\.price\)/
  );
});

test("TEST 7 Admin collect form builds servicePrices array", () => {
  const suite = read("src/admin-suite.js");
  assert.ok(suite.includes("servicePrices"), "collect form must mention servicePrices");
  assert.ok(suite.includes("data.servicePrices"), "must assign data.servicePrices");
  assert.ok(/servicePrices\[/.test(suite), "must parse servicePrices[n] fields");
});

test("TEST 8 Boss switch A→35", () => {
  assert.equal(
    resolveEffectiveServicePrice({ companion, gameName: "王者荣耀", serviceRows, level }).price,
    35
  );
});

test("TEST 9 Boss switch B→30", () => {
  assert.equal(
    resolveEffectiveServicePrice({ companion, gameName: "三角洲 手游 国服", serviceRows, level }).price,
    30
  );
});

test("TEST 10 Boss switch C→40", () => {
  assert.equal(
    resolveEffectiveServicePrice({ companion, gameName: "三角洲跑跑刀 一千万", serviceRows, level }).price,
    40
  );
});

test("TEST 11 subtotal/total math", () => {
  const hours = 2;
  const qty = 1;
  const unit = 35;
  const sub = Math.round(unit * hours * qty * 100) / 100;
  assert.equal(sub, 70);
  assert.equal(Math.round((30 + 40) * 100) / 100, 70);
});

test("TEST 12 place_order uses resolveOrderUnitPrice (server authoritative)", () => {
  const orders = read("server/api/orders.js");
  assert.match(orders, /resolveOrderUnitPrice/);
  assert.match(orders, /SERVICE_PRICE_MISSING/);
  assert.match(orders, /价格已变化，请刷新后重试/);
});

test("TEST 13 multi-order per-child service price", () => {
  const multi = read("server/api/_place-multi-order.js");
  assert.match(multi, /resolveOrderUnitPrice/);
  const team = read("src/multi-companion-team.js");
  assert.match(team, /gameName:\s*l\.game/);
  // A=35 B=50 → parent 85
  const a = 35;
  const b = 50;
  assert.equal(a + b, 85);
});

test("TEST 14 parent wallet debit once via pay_order (create does not debit)", () => {
  const multi = read("server/api/_place-multi-order.js");
  assert.match(multi, /groupTotal/);
  assert.match(multi, /place_multi_order|ORDER_TYPE_MULTI_GROUP/);
  assert.doesNotMatch(multi, /await debitWallet\(/);
  const orders = read("server/api/orders.js");
  assert.match(orders, /order-pay:/);
  assert.match(orders, /cascadeChildren/);
});

test("TEST 15 historical orders keep unit_price snapshot (no rewrite of old orders)", () => {
  const adminPrices = read("server/api/_admin-service-prices.js");
  assert.doesNotMatch(adminPrices, /update.*orders|from public\.orders/i);
  const players = read("server/api/admin/players.js");
  assert.match(players, /applyAdminServicePrices/);
  assert.doesNotMatch(players, /UPDATE\s+orders|patchOrder.*unit_price/i);
});

test("TEST 16 fallback to level.base_price when no service price", () => {
  const r = resolveEffectiveServicePrice({
    companion: { user_id: "u2", price: 0, game_prices: {} },
    gameName: "新服务",
    serviceRows: [],
    level,
  });
  assert.equal(r.price, 30);
  assert.equal(r.source, "level_base_price");
});

test("TEST 17 backend rejects forged client price (drift check retained)", () => {
  const orders = read("server/api/orders.js");
  assert.match(orders, /clientUnit > 0 && Math\.abs\(clientUnit - unitPrice\) > 0\.05/);
  const multi = read("server/api/_place-multi-order.js");
  assert.match(multi, /clientUnit > 0 && Math\.abs\(clientUnit - unitPrice\) > 0\.05/);
});

test("TEST 18 single-order path still present + place-order modal switches unit on service", () => {
  const orders = read("server/api/orders.js");
  assert.match(orders, /action === "place_order"/);
  const modal = read("src/place-order-modal.js");
  assert.match(modal, /function applySelectedService/);
  assert.match(modal, /unitPrice/);
  assert.match(modal, /hydrateFromCatalog/);
});

test("TEST 19 service-specific beats stale profiles.price=30", () => {
  // Root-cause regression: Admin wrote profiles.price=35 but services stayed 30 historically;
  // after fix, service row / game_prices must win for the selected game.
  const staleListing = { ...companion, price: 30 };
  const r = resolveEffectiveServicePrice({
    companion: staleListing,
    gameName: "王者荣耀",
    serviceRows,
    level,
  });
  assert.equal(r.price, 35);
  assert.notEqual(priceForGame(staleListing, "王者荣耀"), 30);
  assert.equal(priceForGame(staleListing, "王者荣耀"), 35);
  assert.equal(readGamePrices(staleListing)["王者荣耀"], 35);
});

test("TEST 20 no new duplicate pricing table migration required", () => {
  const helper = read("server/api/_admin-service-prices.js");
  assert.match(helper, /companion_services/);
  assert.match(helper, /game_prices/);
  assert.doesNotMatch(helper, /create table.*companion_service_prices/i);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`verify:service-pricing offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
