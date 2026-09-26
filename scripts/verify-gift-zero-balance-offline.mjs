#!/usr/bin/env node
/**
 * Offline guards for P0 gift zero-balance lock.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const send = fs.readFileSync(path.join(root, "server/api/_send-catfood-gift.js"), "utf8");
const market = fs.readFileSync(path.join(root, "server/api/boss/marketplace.js"), "utf8");
const profile = fs.readFileSync(path.join(root, "src/profile-detail.js"), "utf8");
const mall = fs.readFileSync(path.join(root, "src/gifts-mall.js"), "utf8");
const giftOrders = fs.readFileSync(path.join(root, "server/api/_gift-orders.js"), "utf8");

assert.match(send, /availableBalance < gross/);
assert.match(send, /INSUFFICIENT_BALANCE/);
assert.match(send, /cat_food_price/);
assert.match(send, /Never trust client total|recompute from catalog/i);
assert.match(send, /gift-refund:/);
assert.match(send, /notifyBoss/);
assert.match(send, /insertCompanionNotification/);
assert.match(market, /sendCatfoodGift/);
assert.match(profile, /当前余额/);
assert.match(profile, /去充值/);
assert.match(profile, /处理中/);
assert.match(mall, /当前余额/);
assert.match(mall, /处理中/);
assert.match(giftOrders, /礼物赠送成功/);
assert.match(giftOrders, /你收到新礼物啦/);
assert.doesNotMatch(
  market.slice(market.indexOf('action === "send_gift"'), market.indexOf('action === "send_gift"') + 800),
  /gross = money\(body\.total/
);

console.log("PASS gift zero-balance offline guards");
