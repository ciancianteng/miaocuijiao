import assert from "node:assert/strict";
import {
  classifyCompanionIncomeTx,
  partitionCompanionIncome,
  sumTxAmount,
} from "../server/api/_companion-income.js";

const orphanTx = {
  id: "160d7ee0-36ec-422e-99bb-c2720a099eab",
  order_id: "f8c5a1da-e3c3-4384-870b-8b6eb335dca9",
  transaction_type: "companion_income",
  amount: 24,
  status: "completed",
  note: 'MCJ_SETTLEMENT:{"orderNo":"MCJO000348","companionNetCatFood":24}',
};
const cancelledOrder = { id: orphanTx.order_id, status: "cancelled" };
assert.equal(classifyCompanionIncomeTx(orphanTx, cancelledOrder), "void");
const part = partitionCompanionIncome([orphanTx], [cancelledOrder]);
assert.equal(sumTxAmount(part.orderIncome), 0);
assert.equal(part.voided.length, 1);

const gift = {
  transaction_type: "companion_income",
  amount: 10,
  status: "completed",
  note: "礼物/打赏收入",
};
assert.equal(classifyCompanionIncomeTx(gift, null), "reward_other");
assert.equal(
  classifyCompanionIncomeTx(orphanTx, { id: orphanTx.order_id, status: "completed" }),
  "order_income"
);
console.log("PASS companion earnings classification");
