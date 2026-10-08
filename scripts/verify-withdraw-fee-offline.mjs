import { assessWithdrawalRequest, quoteWithdrawal, withdrawalLocksBalance } from "../server/api/_withdraw-fee.js";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) console.error("FAIL", name, detail);
}

const one = quoteWithdrawal({ amount: 48 });
check("single order income is not reduced by the fee quote", one.ok && one.gross === 48 && one.fee === 0.8 && one.net === 47.2, one);

const incomes = [48, 30, 22];
const total = incomes.reduce((n, v) => n + v, 0);
check("multiple order incomes sum before any fee", total === 100, { total });
const all = quoteWithdrawal({ amount: total });
check("one withdrawal of 100 charges 0.80 once", all.ok && all.fee === 0.8 && all.net === 99.2 && all.gross === 100, all);

const partial = quoteWithdrawal({ amount: 50 });
check("partial 50 charges 0.80 once and nets 49.20", partial.ok && partial.fee === 0.8 && partial.net === 49.2, partial);
const afterPartial = assessWithdrawalRequest({
  amount: 50,
  withdrawable: 50,
  openWithdrawalCount: 0,
  idempotencyKey: "partial-rest-0001",
});
check("remaining 50 can be withdrawn later and still pays one fee", afterPartial.ok && afterPartial.fee === 0.8 && afterPartial.net === 49.2, afterPartial);

check("amount equal to the fee is rejected", quoteWithdrawal({ amount: 0.8 }).ok === false, quoteWithdrawal({ amount: 0.8 }));
check("amount below the fee is rejected", quoteWithdrawal({ amount: 0.5 }).ok === false, quoteWithdrawal({ amount: 0.5 }));

const dupKey = "idem-key-12345678";
const first = assessWithdrawalRequest({
  amount: 100,
  withdrawable: 100,
  openWithdrawalCount: 0,
  idempotencyKey: dupKey,
});
const retry = assessWithdrawalRequest({
  amount: 100,
  withdrawable: 0,
  openWithdrawalCount: 1,
  idempotencyKey: dupKey,
  existingByKey: { id: "existing" },
});
check("first request is accepted", first.ok && first.duplicate === false && first.fee === 0.8, first);
check("same idempotency key returns the existing request", retry.ok && retry.duplicate === true, retry);

const over = assessWithdrawalRequest({
  amount: 80,
  withdrawable: 100,
  openWithdrawalCount: 1,
  idempotencyKey: "second-open-0001",
});
check("a second open withdrawal is rejected", over.ok === false, over);
const tooMuch = assessWithdrawalRequest({
  amount: 60,
  withdrawable: 40,
  openWithdrawalCount: 0,
  idempotencyKey: "overdraw-00000001",
});
check("request above the withdrawable balance is rejected", tooMuch.ok === false && /余额不足/.test(tooMuch.message || ""), tooMuch);

check("missing idempotency key is rejected", assessWithdrawalRequest({ amount: 10, withdrawable: 10, idempotencyKey: "" }).ok === false, null);
check("client cannot change the fee", quoteWithdrawal({ amount: 22, fee: 0 }).fee === 0.8, quoteWithdrawal({ amount: 22, fee: 0 }));

check("failed and rejected do not keep the balance locked", withdrawalLocksBalance("failed") === false && withdrawalLocksBalance("rejected") === false && withdrawalLocksBalance("pay_failed") === false, null);
check("pending and paid withdrawals stay locked", withdrawalLocksBalance("pending_friday") === true && withdrawalLocksBalance("paid") === true && withdrawalLocksBalance("completed") === true, null);

const failed = results.filter((row) => !row.ok);
console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exit(1);
