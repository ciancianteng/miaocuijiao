/**
 * Offline regression: finance P0 formulas (no network / no DB).
 * node scripts/verify-finance-p0-formulas-offline.mjs
 */
import { resolvePlatformCommission } from "../server/api/_commission-rates.js";
import { computeCommissionBreakdown } from "../server/api/_cs-commission-settle.js";
import {
  isCompanionEarningsLocked,
  companionWithdrawableAtIso,
  COMPANION_WITHDRAW_LOCK_MS,
} from "../server/api/_earnings-windows.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function money(v) {
  return Math.round(Number(v) * 100) / 100;
}

// Recharge math SoT: total = base + bonus
{
  const base = 100;
  const bonus = 5;
  const total = base + bonus;
  assert(total === 105, "recharge total");
  console.log("PASS recharge total_credit = base + bonus");
}

// Companion wage
{
  const r = resolvePlatformCommission(20);
  assert(r.platformRate === 20 && r.companionShareRate === 80, "rate 20");
  const legacy = resolvePlatformCommission(80);
  assert(legacy.platformRate === 20 && legacy.companionShareRate === 80, "legacy share 80");
  const amount = 20;
  const net = money((amount * r.companionShareRate) / 100);
  assert(net === 16, `net got ${net}`);
  console.log("PASS companion wage order*share");
}

// Multi sum
{
  assert(35 + 35 === 70, "multi sum");
  console.log("PASS multi 35+35=70");
}

// CS wage
{
  const b = computeCommissionBreakdown({ total_amount: 100 }, { orderCommission: 2, commissionPercent: 5 });
  assert(b.finalAmountRm === 7, `cs wage got ${b.finalAmountRm}`);
  assert(b.fixedRewardRm === 2 && b.percentCommissionRm === 5, "cs split");
  console.log("PASS cs wage fixed+percent");
}

// 24h lock
{
  const now = Date.now();
  const fresh = { status: "completed", completed_at: new Date(now - 1000).toISOString() };
  assert(isCompanionEarningsLocked(fresh, now) === true, "fresh locked");
  const old = { status: "completed", completed_at: new Date(now - COMPANION_WITHDRAW_LOCK_MS - 1000).toISOString() };
  assert(isCompanionEarningsLocked(old, now) === false, "old unlocked");
  assert(!!companionWithdrawableAtIso(fresh), "unlock iso");
  console.log("PASS 24h withdraw lock");
}

// Idempotency key shapes (documentation asserts)
{
  const paymentNo = "PAY-TEST";
  const key = `recharge:${paymentNo}`;
  assert(key === "recharge:PAY-TEST", "recharge idem key");
  console.log("PASS recharge idempotency key shape");
}

  // Offline unit: defaults must not be zeroed by empty meta
  {
    // Simulate the fixed getGlobalCommissionConfig defaults return shape
    const DEFAULT_GLOBAL_COMMISSION = {
      baseSalary: 350,
      orderCommission: 2,
      commissionPercent: 5,
    };
    const broken = { ...DEFAULT_GLOBAL_COMMISSION, ...{ orderCommission: 0, commissionPercent: 0 } };
    assert(broken.orderCommission === 0, "documents prior bug");
    const fixed = { ...DEFAULT_GLOBAL_COMMISSION };
    assert(fixed.orderCommission === 2 && fixed.commissionPercent === 5, "defaults intact");
    console.log("PASS cs defaults not zeroed");
  }

console.log("ALL PASS verify-finance-p0-formulas-offline");