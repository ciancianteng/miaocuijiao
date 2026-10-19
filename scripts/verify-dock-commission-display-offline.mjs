import assert from "node:assert/strict";
import { netDockCommission } from "../server/api/_cs-dock-rewards.js";

const fishRewards = Array.from({ length: 13 }, (_, i) => ({
  order_id: `order-${i + 1}`,
  status: "settled",
  amount_cat_food: 0.3,
}));
const fishLedger = fishRewards.map((reward) => ({
  idempotency_key: `cs-dock-reward:${reward.order_id}`,
  transaction_type: "cs_dock_reward",
  related_order_id: reward.order_id,
  amount: 0.3,
}));
const fish = netDockCommission(fishRewards, fishLedger);
assert.equal(fish.count, 13);
assert.equal(fish.total, 3.9);

const duplicated = netDockCommission(fishRewards, fishLedger.concat(fishLedger));
assert.equal(duplicated.total, 3.9);
assert.equal(duplicated.count, 13);

const missingWallet = netDockCommission(
  [{ order_id: "gap", status: "settled", amount_cat_food: 0.3 }],
  []
);
assert.equal(missingWallet.total, 0);
assert.equal(missingWallet.count, 0);

const clawed = netDockCommission(
  [{ order_id: "back", status: "settled", amount_cat_food: 0.3 }],
  [
    { idempotency_key: "cs-dock-reward:back", transaction_type: "cs_dock_reward", related_order_id: "back", amount: 0.3 },
    { idempotency_key: "cs-dock-clawback:back", transaction_type: "cs_dock_clawback", related_order_id: "back", amount: 0.3 },
  ]
);
assert.equal(clawed.total, 0);

const xiaomiao = netDockCommission(
  Array.from({ length: 6 }, (_, i) => ({ order_id: `m-${i}`, status: "settled", amount_cat_food: 0.3 })),
  Array.from({ length: 6 }, (_, i) => ({
    idempotency_key: `cs-dock-reward:m-${i}`,
    transaction_type: "cs_dock_reward",
    related_order_id: `m-${i}`,
    amount: 0.3,
  }))
);
assert.equal(xiaomiao.count, 6);
assert.equal(xiaomiao.total, 1.8);

const otherAgent = netDockCommission(fishRewards, [
  { idempotency_key: "cs-dock-reward:someone-else", transaction_type: "cs_dock_reward", related_order_id: "someone-else", amount: 9 },
]);
assert.equal(otherAgent.total, 0);

console.log("verify-dock-commission-display-offline: ALL PASS");
