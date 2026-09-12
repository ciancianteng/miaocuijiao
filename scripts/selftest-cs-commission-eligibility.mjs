/**
 * Quick selftest for CS commission eligibility gates (no DB).
 * node scripts/selftest-cs-commission-eligibility.mjs
 */
import {
  assessCommissionEligibility,
  resolveOrderPaymentProof,
  computeCommissionBreakdown,
} from "../server/api/_cs-commission-settle.js";

const serviceId = "11111111-1111-1111-1111-111111111111";
const cfg = { orderCommission: 2, commissionPercent: 5 };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Case A: consultation — no order
{
  const r = assessCommissionEligibility(null, { serviceId, fromEndReception: true });
  assert(r.code === "CONSULTATION" && r.consultation, "consult no order");
  console.log("PASS consultation RM0:", r.message);
}

// Case B: unpaid
{
  const order = {
    id: "o1",
    order_no: "MCJO000100",
    status: "awaiting_payment",
    total_amount: 50,
    customer_service_id: serviceId,
  };
  const r = assessCommissionEligibility(order, { serviceId, fromEndReception: true });
  assert(r.consultation && !r.ok, "unpaid consult");
  console.log("PASS unpaid:", r.message);
}

// Case C: paid + end reception
{
  const order = {
    id: "o2",
    order_no: "MCJO000101",
    status: "claimed",
    paid_at: new Date().toISOString(),
    payment_status: "paid",
    total_amount: 100,
    customer_service_id: serviceId,
  };
  const pay = resolveOrderPaymentProof(order);
  assert(pay.paid && pay.amount === 100, "payment proof");
  const r = assessCommissionEligibility(order, {
    serviceId,
    fromEndReception: true,
    conversation: { id: "c1", order_id: "o2", customer_service_id: serviceId },
  });
  assert(r.ok && r.code === "ELIGIBLE", "eligible paid");
  const b = computeCommissionBreakdown(order, cfg);
  assert(b.finalAmountRm === 7, `breakdown got ${b.finalAmountRm}`);
  console.log("PASS paid commission:", r.message, "RM", b.finalAmountRm);
}

// Case D: without end reception
{
  const order = {
    id: "o3",
    order_no: "MCJO000102",
    status: "claimed",
    paid_at: new Date().toISOString(),
    payment_status: "succeeded",
    total_amount: 80,
    customer_service_id: serviceId,
  };
  const r = assessCommissionEligibility(order, { serviceId, fromEndReception: false });
  assert(r.code === "NEED_END_RECEPTION" && !r.ok, "need end reception");
  console.log("PASS need end reception:", r.message);
}

// Case E: cross-midnight hours (attendance duration helper inline)
{
  const start = Date.parse("2026-08-03T15:00:00.000Z"); // 23:00 +08
  const end = Date.parse("2026-08-03T18:00:00.000Z"); // 02:00 +08
  const mins = Math.round(((end - start) / 60000) * 100) / 100;
  assert(mins === 180, `cross midnight mins=${mins}`);
  console.log("PASS cross-midnight 23:00-02:00 = 3h");
}

console.log("ALL selftests OK");
