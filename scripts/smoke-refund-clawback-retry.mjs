/**
 * Smoke + unit tests: refund paid idempotency + points clawback retry.
 * Run: node scripts/smoke-refund-clawback-retry.mjs
 *
 * CASE A: paid + clawback success → second click no re-credit, no re-claw
 * CASE B: paid + clawback first fail → second click retries clawback only
 * CASE C: award 380, balance 50 → clawback balance=0 debt=330
 * CASE D: after C, award 500 → repay debt 330, balance +170
 * CASE E: many confirm calls → one wallet credit + one clawback obligation
 */
import {
  confirmBossCatFoodRefund,
  isRefundPointsClawbackSettled,
  runRefundPointsClawback,
} from "../server/api/_boss-refund-payout.js";
import {
  orderPointsClawbackIdempotencyKey,
  orderPointsIdempotencyKey,
} from "../server/api/_user-points.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

/** Pure debt math mirroring mcj_clawback_user_points / mcj_award_user_points */
function applyClawback(balance, debt, target) {
  const bal = Math.max(0, Number(balance) || 0);
  const d = Math.max(0, Number(debt) || 0);
  const t = Math.max(0, Number(target) || 0);
  const applied = Math.min(bal, t);
  const debtAdd = t - applied;
  return {
    balance: bal - applied,
    debt: d + debtAdd,
    applied,
    debtOpened: debtAdd,
  };
}

function applyAward(balance, debt, points) {
  const bal = Math.max(0, Number(balance) || 0);
  let d = Math.max(0, Number(debt) || 0);
  const p = Math.max(0, Number(points) || 0);
  const repay = Math.min(d, p);
  d -= repay;
  const credit = p - repay;
  return { balance: bal + credit, debt: d, debtRepaid: repay, credited: credit };
}

assert(isRefundPointsClawbackSettled({ ok: true }) === true, "settled ok");
assert(isRefundPointsClawbackSettled({ ok: true, duplicate: true }) === true, "settled duplicate");
assert(isRefundPointsClawbackSettled({ ok: true, skipped: true, error: "no_award_ledger" }) === true, "settled no award");
assert(isRefundPointsClawbackSettled({ ok: false, error: "rpc_down" }) === false, "unsettled fail");
assert(isRefundPointsClawbackSettled(null) === false, "null unsettled");
assert(orderPointsClawbackIdempotencyKey("ord-1") === "order_points_clawback:ord-1", "claw key");
assert(orderPointsIdempotencyKey("ord-1") === "order_points:ord-1", "award key");

// --- CASE C ---
{
  const after = applyClawback(50, 0, 380);
  assert(after.balance === 0, "C balance 0");
  assert(after.debt === 330, "C debt 330");
  assert(after.applied === 50 && after.debtOpened === 330, "C applied/debtOpened");
}

// --- CASE D ---
{
  const after = applyAward(0, 330, 500);
  assert(after.debt === 0, "D debt cleared");
  assert(after.balance === 170, "D balance 170");
  assert(after.debtRepaid === 330 && after.credited === 170, "D repay/credit");
}

function makeDb(initialRow) {
  const state = {
    refund: { ...initialRow },
    orders: {},
    paymentTxPatches: 0,
    refundPatches: 0,
  };
  if (initialRow.order_id) {
    state.orders[initialRow.order_id] = { id: initialRow.order_id, status: "completed" };
  }
  async function db(table, query = "", init = {}) {
    const method = (init.method || "GET").toUpperCase();
    if (table === "boss_refund_requests") {
      if (method === "PATCH") {
        state.refundPatches += 1;
        const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {};
        state.refund = { ...state.refund, ...body };
        return [state.refund];
      }
      return [state.refund];
    }
    if (table === "orders" && method === "PATCH") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {};
      const id = state.refund.order_id;
      state.orders[id] = { ...(state.orders[id] || {}), ...body };
      return [state.orders[id]];
    }
    if (table === "payment_transactions") {
      if (method === "PATCH") {
        state.paymentTxPatches += 1;
        return [{}];
      }
      return [];
    }
    return [];
  }
  return { db, state };
}

// --- CASE A ---
{
  const row = {
    id: "rf-a",
    status: "approved_for_payout",
    amount_rm: 10,
    boss_id: "boss-a",
    order_id: "ord-a",
    order_no: "O-A",
    refund_no: "R-A",
  };
  const { db, state } = makeDb(row);
  let creditCalls = 0;
  let clawCalls = 0;
  const clawLedger = { done: false };

  const deps = {
    creditWallet: async () => {
      creditCalls += 1;
      return { ok: true, duplicate: false, wallet: { balance: 10 } };
    },
    getWallet: async () => ({ balance: 10 }),
    notifyBoss: async () => {},
    syncPayout: async () => {},
    clawbackBossPointsForRefundedOrder: async () => {
      clawCalls += 1;
      if (clawLedger.done) {
        return {
          ok: true,
          duplicate: true,
          skipped: true,
          idempotency_key: orderPointsClawbackIdempotencyKey("ord-a"),
        };
      }
      clawLedger.done = true;
      return {
        ok: true,
        duplicate: false,
        applied: 10,
        debt_opened: 0,
        idempotency_key: orderPointsClawbackIdempotencyKey("ord-a"),
      };
    },
  };

  const r1 = await confirmBossCatFoodRefund(db, { refundId: "rf-a", adminId: "admin" }, deps);
  assert(r1.ok === true, "A1 ok");
  assert(state.refund.status === "paid", "A1 paid");
  assert(creditCalls === 1 && clawCalls === 1, "A1 one credit one claw");
  assert(r1.clawbackSettled === true, "A1 claw settled");

  const r2 = await confirmBossCatFoodRefund(db, { refundId: "rf-a", adminId: "admin" }, deps);
  assert(r2.ok === true, "A2 ok");
  assert(r2.alreadyRefunded === true && r2.duplicate === true, "A2 idempotent refund");
  assert(creditCalls === 1, "A2 no second credit");
  assert(clawCalls === 2, "A2 claw called again (idempotent)");
  assert(r2.pointsClawback?.duplicate === true, "A2 claw duplicate");
  assert(state.refundPatches === 1, "A2 no second paid patch");
}

// --- CASE B ---
{
  const row = {
    id: "rf-b",
    status: "approved_for_payout",
    amount_rm: 10,
    boss_id: "boss-b",
    order_id: "ord-b",
    order_no: "O-B",
    refund_no: "R-B",
  };
  const { db, state } = makeDb(row);
  let creditCalls = 0;
  let clawCalls = 0;
  let clawFailOnce = true;

  const deps = {
    creditWallet: async () => {
      creditCalls += 1;
      return { ok: true, duplicate: false, wallet: { balance: 10 } };
    },
    getWallet: async () => ({ balance: 10 }),
    notifyBoss: async () => {},
    syncPayout: async () => {},
    clawbackBossPointsForRefundedOrder: async () => {
      clawCalls += 1;
      if (clawFailOnce) {
        clawFailOnce = false;
        return { ok: false, error: "simulated_rpc_failure" };
      }
      return {
        ok: true,
        duplicate: false,
        applied: 50,
        debt_opened: 330,
        balance_after: 0,
        debt_after: 330,
        clawback_target: 380,
        idempotency_key: orderPointsClawbackIdempotencyKey("ord-b"),
      };
    },
  };

  const r1 = await confirmBossCatFoodRefund(db, { refundId: "rf-b", adminId: "admin" }, deps);
  assert(r1.ok === false, "B1 ok false when claw fails after credit");
  assert(state.refund.status === "paid", "B1 still paid");
  assert(creditCalls === 1 && clawCalls === 1, "B1 credit+claw once");
  assert(r1.alreadyRefunded === true, "B1 alreadyRefunded");
  assert(r1.clawbackSettled === false, "B1 claw not settled");

  const r2 = await confirmBossCatFoodRefund(db, { refundId: "rf-b", adminId: "admin" }, deps);
  assert(r2.ok === true, "B2 ok after claw retry");
  assert(creditCalls === 1, "B2 no re-credit");
  assert(clawCalls === 2, "B2 claw retried");
  assert(r2.clawbackSettled === true, "B2 claw settled");
  assert(r2.pointsClawback?.debt_opened === 330, "B2 debt opened on retry");
  assert(state.refund.status === "paid", "B2 stays paid");
}

// --- CASE E ---
{
  const row = {
    id: "rf-e",
    status: "approved_for_payout",
    amount_rm: 5,
    boss_id: "boss-e",
    order_id: "ord-e",
    order_no: "O-E",
    refund_no: "R-E",
  };
  const { db, state } = makeDb(row);
  let creditCalls = 0;
  const clawKeys = [];

  const deps = {
    creditWallet: async ({ idempotencyKey }) => {
      creditCalls += 1;
      assert(idempotencyKey === "refund-meow:rf-e", "E wallet key");
      return { ok: true, duplicate: creditCalls > 1, wallet: { balance: 5 } };
    },
    getWallet: async () => ({ balance: 5 }),
    notifyBoss: async () => {},
    syncPayout: async () => {},
    clawbackBossPointsForRefundedOrder: async (_order, opts) => {
      const key = orderPointsClawbackIdempotencyKey("ord-e");
      clawKeys.push(key);
      if (clawKeys.length === 1) {
        return { ok: true, duplicate: false, idempotency_key: key };
      }
      return { ok: true, duplicate: true, skipped: true, idempotency_key: key };
    },
  };

  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(await confirmBossCatFoodRefund(db, { refundId: "rf-e", adminId: "admin" }, deps));
  }
  assert(creditCalls === 1, "E only one wallet credit");
  assert(state.refundPatches === 1, "E only one paid patch");
  assert(clawKeys.length === 5, "E claw invoked each confirm (idempotent)");
  assert(clawKeys.every((k) => k === "order_points_clawback:ord-e"), "E same claw key");
  assert(results[0].ok === true, "E first ok");
  assert(results.slice(1).every((r) => r.ok === true && r.alreadyRefunded === true), "E rest idempotent ok");
}

// runRefundPointsClawback wires deps
{
  let n = 0;
  const claw = await runRefundPointsClawback(
    { id: "ord-x", boss_id: "b" },
    {
      clawbackFn: async () => {
        n += 1;
        return { ok: true, duplicate: n > 1 };
      },
    }
  );
  assert(claw.ok === true && n === 1, "helper invokes clawbackFn");
}

console.log("OK smoke-refund-clawback-retry (A/B/C/D/E)");
