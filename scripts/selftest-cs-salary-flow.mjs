/**
 * CS salary completion flow selftest (gate + SoT math, no DB).
 * node scripts/selftest-cs-salary-flow.mjs
 */
import {
  assessCommissionEligibility,
  resolveOrderPaymentProof,
  computeCommissionBreakdown,
  calculateStaffSalary,
} from "../server/api/_cs-commission-settle.js";

const CS_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CS_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const cfg = { orderCommission: 2, commissionPercent: 5 };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function paidOrder(overrides = {}) {
  return {
    id: "order-1",
    order_no: "MCJO-SALARY-1",
    status: "in_progress",
    total_amount: 100,
    customer_service_id: CS_A,
    paid_at: "2026-09-13T00:00:00.000Z",
    payment_status: "paid",
    ...overrides,
  };
}

{
  const order = paidOrder();
  const r = assessCommissionEligibility(order, {
    serviceId: CS_A,
    fromEndReception: true,
    conversation: { id: "c1", order_id: order.id, customer_service_id: CS_A },
  });
  assert(r.ok && r.code === "ELIGIBLE", `T1 ${r.code}`);
  const b = calculateStaffSalary(order, cfg);
  assert(b.finalAmountRm === 7, `T1 amount ${b.finalAmountRm}`);
  console.log("PASS T1 CS A end reception amount", b.finalAmountRm);
}

{
  const order = paidOrder();
  const r = assessCommissionEligibility(order, {
    serviceId: CS_B,
    fromEndReception: true,
    conversation: { id: "c1", order_id: order.id, customer_service_id: CS_A },
  });
  assert(!r.ok && r.code === "NOT_RECEPTION_CS", `T2 ${r.code}`);
  console.log("PASS T2 CS B blocked");
}

{
  const r = assessCommissionEligibility(paidOrder(), { serviceId: CS_A, fromEndReception: false });
  assert(!r.ok && r.code === "NEED_END_RECEPTION", `T3 ${r.code}`);
  console.log("PASS T3 need end reception");
}

{
  const order = paidOrder({ status: "awaiting_payment", paid_at: "", payment_status: "" });
  const pay = resolveOrderPaymentProof(order);
  assert(!pay.paid, "T4 unpaid proof");
  const r = assessCommissionEligibility(order, {
    serviceId: CS_A,
    fromEndReception: true,
    conversation: { id: "c1", order_id: order.id, customer_service_id: CS_A },
  });
  assert(!r.ok && (r.consultation || r.code === "UNPAID"), `T4 ${r.code}`);
  console.log("PASS T4 unpaid consultation");
}

{
  const order = paidOrder({ status: "cancelled" });
  const r = assessCommissionEligibility(order, {
    serviceId: CS_A,
    fromEndReception: true,
    conversation: { id: "c1", order_id: order.id, customer_service_id: CS_A },
  });
  assert(!r.ok, `T5 ${r.code}`);
  console.log("PASS T5 cancel no pay", r.code);
}

{
  const r = assessCommissionEligibility(null, { serviceId: CS_A, fromEndReception: true });
  assert(r.consultation && Number(r.commissionAmount || 0) === 0, "T6 consult");
  console.log("PASS T6 chat-only RM0");
}

{
  const order = paidOrder({ total_amount: 200 });
  const a = computeCommissionBreakdown(order, cfg);
  const b = calculateStaffSalary(order, cfg);
  assert(a.finalAmountRm === b.finalAmountRm && a.finalAmountRm === 12, `T7 ${a.finalAmountRm}`);
  console.log("PASS T7 SoT calculateStaffSalary", b.finalAmountRm);
}

{
  const order = {
    id: "order-prod",
    order_no: "MCJO000344",
    status: "completed",
    total_amount: 6000,
    customer_service_id: CS_A,
  };
  const pay = resolveOrderPaymentProof(order);
  assert(pay.paid && pay.amount === 6000, "T8 paid via status");
  const r = assessCommissionEligibility(order, {
    serviceId: CS_A,
    fromEndReception: true,
    conversation: { id: "c-prod", order_id: order.id, customer_service_id: CS_A },
  });
  assert(r.ok, `T8 ${r.code}`);
  console.log("PASS T8 prod schema without paid_at");
}

console.log("ALL cs-salary-flow selftests OK");
