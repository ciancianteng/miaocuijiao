import assert from "node:assert/strict";
import {
  dockRewardClawbackKey,
  dockRewardCreditKey,
  shouldCreditDockReward,
} from "../server/api/_cs-dock-rewards.js";

const orderId = "a4d12ad0-b820-4d23-8fea-1fc426c9591a";
const serviceId = "78f3b7e0-d799-4cfe-b9e7-6a06ae461f6a";
const reward = {
  status: "settled",
  amount_cat_food: 0.3,
  order_id: orderId,
  service_id: serviceId,
};

assert.equal(dockRewardCreditKey(orderId), `cs-dock-reward:${orderId}`);
assert.equal(dockRewardCreditKey(orderId), dockRewardCreditKey(orderId));
assert.equal(dockRewardClawbackKey(orderId), `cs-dock-clawback:${orderId}`);
assert.notEqual(dockRewardCreditKey(orderId), dockRewardClawbackKey(orderId));

assert.equal(shouldCreditDockReward(reward, { status: "completed" }), true);
assert.equal(shouldCreditDockReward(reward, { status: "reviewed" }), true);
assert.equal(shouldCreditDockReward(reward, { status: "refunded" }), false);
assert.equal(shouldCreditDockReward(reward, { status: "cancelled" }), false);
assert.equal(shouldCreditDockReward(reward, { status: "canceled" }), false);
assert.equal(shouldCreditDockReward(reward, { status: "awaiting_payment" }), false);
assert.equal(shouldCreditDockReward(reward, { status: "refund_requested" }), false);
assert.equal(shouldCreditDockReward({ ...reward, status: "pending" }, { status: "completed" }), false);
assert.equal(shouldCreditDockReward({ ...reward, amount_cat_food: 0 }, { status: "completed" }), false);
assert.equal(shouldCreditDockReward({ ...reward, service_id: "" }, { status: "completed" }), false);
assert.equal(shouldCreditDockReward(reward, null), false);

const seen = new Set();
function creditOnce(key, amount) {
  if (seen.has(key)) return { duplicate: true, amount: 0 };
  seen.add(key);
  return { duplicate: false, amount };
}
const first = creditOnce(dockRewardCreditKey(orderId), 0.3);
const retry = creditOnce(dockRewardCreditKey(orderId), 0.3);
assert.equal(first.duplicate, false);
assert.equal(first.amount, 0.3);
assert.equal(retry.duplicate, true);
assert.equal(retry.amount, 0);
assert.equal([...seen].length, 1);

console.log("cs-dock-ledger-offline: ok");
