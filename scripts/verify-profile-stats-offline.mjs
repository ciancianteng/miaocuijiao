#!/usr/bin/env node
/**
 * Offline regression for companion profile stats.
 * No database writes and no hardcoded display numbers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quoteServiceOffer } from "../server/api/_service-offer-quote.js";
import {
  catalogOffersWereSaved,
  excludeTestBossOrders,
  mergeGiftWalls,
  reviewsGroupedByCompanion,
  seedLegacyCatalogOffers,
  tallyCompletedOrders,
} from "../server/api/_companion-profile-stats.js";

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

const userA = "user-a";
const profileA = "profile-a";
const userB = "user-b";
const profileB = "profile-b";
const cardA = { id: userA, companionProfileId: profileA };
const cardB = { id: userB, companionProfileId: profileB };
const king = { id: "svc-king", name: "王者荣耀", enabled: true, allow_order: true, default_price: "20" };
const delta = { id: "svc-delta", name: "三角洲行动爆破模式", enabled: true, allow_order: true, default_price: "30" };
const custom = { unit: "局", allowSelfPrice: true, min: "10", max: "50" };
const platform = { unit: "局", allowSelfPrice: false };

test("完成订单只统计 completed，用户 ID 与资料 ID 不重复计数", () => {
  const counts = tallyCompletedOrders([cardA, cardB], [
    { id: "o1", status: "completed", companion_id: userA },
    { id: "o2", status: "completed", companion_id: profileA },
    { id: "o1", status: "completed", companion_id: userA },
    { id: "o3", status: "cancelled", companion_id: userA },
    { id: "o4", status: "refunded", companion_id: userA },
    { id: "o5", status: "in_progress", companion_id: userA },
    { id: "o6", status: "claimed", companion_id: userA },
    { id: "o7", status: "awaiting_payment", companion_id: userA },
    { id: "o8", status: "completed", companion_id: userB },
  ]);
  assert.equal(counts[userA], 2);
  assert.equal(counts[userB], 1);
});

test("资料 ID 与用户 ID 相同时一笔订单只计一次", () => {
  const same = { id: "same-id", companionProfileId: "same-id" };
  const counts = tallyCompletedOrders([same], [{ id: "o1", status: "completed", companion_id: "same-id" }]);
  assert.equal(counts["same-id"], 1);
});

test("测试老板的完成订单不计入公开完成数", () => {
  const rows = excludeTestBossOrders(
    [
      { id: "o1", status: "completed", companion_id: userA, boss_id: "boss-real" },
      { id: "o2", status: "completed", companion_id: userA, boss_id: "boss-test" },
    ],
    ["boss-test"]
  );
  const counts = tallyCompletedOrders([cardA], rows);
  assert.equal(counts[userA], 1);
});

test("评价按被查看陪玩归组，订单挂在资料 ID 上仍然保留", () => {
  const groups = reviewsGroupedByCompanion(
    [cardA, cardB],
    [
      { id: "r1", companion_id: userA, order_id: "o1", rating: 5 },
      { id: "r2", companion_id: profileB, order_id: "o2", rating: 4 },
      { id: "r3", companion_id: userA, order_id: "o3", rating: 5 },
    ],
    {
      o1: { companion_id: profileA },
      o2: { companion_id: userB },
      o3: { companion_id: userB },
    }
  );
  assert.deepEqual(groups[userA].map((row) => row.id), ["r1"]);
  assert.deepEqual(groups[userB].map((row) => row.id), ["r2"]);
});

test("礼物墙合并同一礼物的两份记录时取较大数量", () => {
  const wall = mergeGiftWalls([
    [{ giftId: "g1", giftName: "小鱼干", totalQuantity: 67 }],
    [{ gift_id: "g1", gift_name: "小鱼干", total_quantity: 10 }],
    [{ giftName: "猫罐头", totalQuantity: 0 }],
  ]);
  assert.equal(wall.length, 1);
  assert.equal(wall[0].giftName, "小鱼干");
  assert.equal(wall[0].totalQuantity, 67);
});

test("没有保存过服务开关时，只展示该陪玩已开启且能报价的目录服务", () => {
  const seeded = seedLegacyCatalogOffers({
    catalogServices: [king, delta],
    serviceRows: [
      { service_name: "王者荣耀", price: "20.00", enabled: true, review_status: "approved" },
      { service_name: "默认服务", price: "20.00", enabled: true, review_status: "approved" },
    ],
    gamePrices: { 王者荣耀: 20, 默认服务: 20 },
  });
  assert.deepEqual(seeded.map((row) => row.id), ["svc-king"]);
  const quote = quoteServiceOffer({ service: king, policy: custom, saved: seeded[0] });
  assert.equal(quote.orderable, true);
  assert.equal(quote.effectivePrice, 20);
  assert.equal(quote.unit, "局");
});

test("陪玩明确关闭的服务不会被旧价格重新打开", () => {
  assert.equal(catalogOffersWereSaved({ __catalogOffers: [] }), true);
  assert.equal(catalogOffersWereSaved({}), false);
  const seeded = seedLegacyCatalogOffers({
    catalogServices: [king, delta],
    serviceRows: [{ service_id: "svc-king", service_name: "王者荣耀", price: 25, enabled: false, review_status: "approved" }],
    gamePrices: { 王者荣耀: 20, 三角洲行动爆破模式: 30 },
  });
  const kingQuote = quoteServiceOffer({ service: king, policy: custom, saved: seeded.find((row) => row.id === "svc-king") });
  const deltaQuote = quoteServiceOffer({
    service: delta,
    policy: platform,
    saved: seeded.find((row) => row.id === "svc-delta") || null,
  });
  assert.equal(kingQuote.orderable, false);
  assert.equal(deltaQuote.orderable, true);
  assert.equal(deltaQuote.effectivePrice, 30);
});

test("另一位陪玩的服务记录不会进入当前报价", () => {
  const seeded = seedLegacyCatalogOffers({
    catalogServices: [king],
    serviceRows: [],
    gamePrices: {},
  });
  assert.deepEqual(seeded, []);
  const quote = quoteServiceOffer({ service: king, policy: custom, saved: null });
  assert.equal(quote.orderable, false);
});

test("页面空状态与查询绑定没有退回旧字段", () => {
  const page = read("src/profile-detail.js");
  const api = read("server/api/public/companions.js");
  const offers = read("server/api/_companion-offers.js");
  const html = read("profile.html");
  assert.match(page, /var orderStat = String\(completedOrders\);/);
  assert.match(page, /暂无评价数据/);
  assert.doesNotMatch(page, /completedOrders > 0 \? String\(completedOrders\) : "—"/);
  assert.match(api, /loadCompletedOrderCount/);
  assert.match(api, /reviewsGroupedByCompanion/);
  assert.match(api, /mergeGiftWalls/);
  assert.match(api, /completedOrders: 0/);
  assert.doesNotMatch(api, /row\.completed_orders/);
  assert.match(api, /const good = ratings\.filter\(\(n\) => n >= 4\)\.length/);
  assert.match(api, /goodRate: count \? Math\.round\(\(good \/ count\) \* 1000\) \/ 10 : 0/);
  assert.match(offers, /catalogOffersWereSaved/);
  assert.match(offers, /seedLegacyCatalogOffers/);
  assert.match(html, /profile-detail\.js\?v=20261019stats1/);
});

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
