import { dockRewardClawbackKey, dockRewardCreditKey, shouldCreditDockReward } from "../server/api/_cs-dock-rewards.js";

let failed = 0;
function check(name, ok) {
  console.log(ok ? "PASS" : "FAIL", name);
  if (!ok) failed += 1;
}

const reward = { status: "settled", amount_cat_food: "0.30", order_id: "order-1", service_id: "cs-1", order_no: "MCJO000457" };
check("key is stable per order", dockRewardCreditKey("order-1") === "cs-dock-reward:order-1");
check("clawback key differs", dockRewardClawbackKey("order-1") === "cs-dock-clawback:order-1");
check("settled reward without a ledger can be credited", shouldCreditDockReward(reward, null) === true);
check("existing ledger blocks a second credit", shouldCreditDockReward(reward, { id: "tx-1" }) === false);
check("pending is not credited", shouldCreditDockReward({ ...reward, status: "pending" }, null) === false);
check("zero amount is not credited", shouldCreditDockReward({ ...reward, amount_cat_food: 0 }, null) === false);
check("missing service is not credited", shouldCreditDockReward({ ...reward, service_id: "" }, null) === false);
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
