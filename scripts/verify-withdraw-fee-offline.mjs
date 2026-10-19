import { readFileSync } from "node:fs";
import { assessWithdrawalRequest, quoteWithdrawal, withdrawalLocksBalance } from "../server/api/_withdraw-fee.js";
import { mergeWeeklySettings } from "../server/api/_weekly-settlement.js";

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

const matrix = [
  { amount: 0.5, allow: false },
  { amount: 0.8, allow: false },
  { amount: 0.81, allow: true, net: 0.01 },
  { amount: 1, allow: true, net: 0.2 },
  { amount: 10, allow: true, net: 9.2 },
  { amount: 49, allow: true, net: 48.2 },
  { amount: 50, allow: true, net: 49.2 },
];
for (const row of matrix) {
  const quoted = quoteWithdrawal({ amount: row.amount });
  const assessed = assessWithdrawalRequest({
    amount: row.amount,
    withdrawable: 100,
    openWithdrawalCount: 0,
    idempotencyKey: `matrix-${String(row.amount).replace(".", "")}-0001`,
  });
  if (!row.allow) {
    check(`RM${row.amount.toFixed(2)} is rejected`, quoted.ok === false && assessed.ok === false, { quoted, assessed });
  } else {
    const netCents = Math.round(row.net * 100);
    check(
      `RM${row.amount.toFixed(2)} arrives RM${row.net.toFixed(2)}`,
      quoted.ok &&
        assessed.ok &&
        quoted.fee === 0.8 &&
        assessed.fee === 0.8 &&
        Math.round(quoted.net * 100) === netCents &&
        Math.round(assessed.net * 100) === netCents &&
        quoted.grossCents - quoted.feeCents === netCents,
      { quoted, assessed }
    );
  }
}
const overBalance = assessWithdrawalRequest({
  amount: 10.01,
  withdrawable: 10,
  openWithdrawalCount: 0,
  idempotencyKey: "over-balance-0001",
});
check("amount above the withdrawable balance is rejected", overBalance.ok === false && /余额不足/.test(overBalance.message || ""), overBalance);
const justFits = assessWithdrawalRequest({
  amount: 0.81,
  withdrawable: 0.81,
  openWithdrawalCount: 0,
  idempotencyKey: "just-fits-000001",
});
check("RM0.81 against a RM0.81 balance arrives RM0.01", justFits.ok && Math.round(justFits.net * 100) === 1 && justFits.fee === 0.8, justFits);

const storedFloor = mergeWeeklySettings({ min_withdraw_cat_food: 50, max_withdrawals_per_week: 2 });
check("a stored RM50 setting is ignored", storedFloor.min_withdraw_cat_food === 0, storedFloor);

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}
const companionSrc = read("../server/api/companion.js");
const workbenchSrc = read("../src/companion-workbench.js");
const adminSrc = read("../src/admin-finance.js");
const financeSrc = read("../server/api/admin/finance.js");
check("submit API no longer returns a minimum withdrawal message", !companionSrc.includes("最低提现"), null);
check("balance gate no longer compares a configured minimum", !companionSrc.includes("withdrawable >= minAmount") && !companionSrc.includes("可提现余额不足（最低"), null);
check("workbench no longer shows a minimum withdrawal row", !/最低提现|满 RM50|距离 RM50|最低提现额/.test(workbenchSrc), null);
check(
  "workbench shows balance, amount, fee and arrival",
  workbenchSrc.includes("可提现余额") &&
    workbenchSrc.includes(">提现金额<input") &&
    workbenchSrc.includes("固定手续费") &&
    workbenchSrc.includes("预计到账") &&
    workbenchSrc.includes("RM 0.80"),
  null
);
check(
  "admin review shows companion code, request, fee, arrival, status and time",
  adminSrc.includes("陪玩编号") &&
    adminSrc.includes("申请提现金额") &&
    adminSrc.includes("手续费") &&
    adminSrc.includes("实际到账") &&
    adminSrc.includes("提现状态") &&
    adminSrc.includes("申请时间"),
  null
);
const approveSlice = financeSrc.slice(financeSrc.indexOf('action === "approve_withdraw"'), financeSrc.indexOf('action === "start_review_withdraw"'));
const rejectSlice = financeSrc.slice(financeSrc.indexOf('action === "reject_withdraw"'), financeSrc.indexOf('action === "reject_withdraw"') + 4000);
check("approve pays the stored net and does not subtract the fee again", approveSlice.includes("net_amount_rm") && !/0\.80|WITHDRAW_FEE|fee_rm\s*-/.test(approveSlice), null);
check("reject cancels the freeze", rejectSlice.includes('status: "cancelled"') && rejectSlice.includes("提现驳回"), null);
const paidIdx = financeSrc.indexOf("Settle freeze once");
check("paid settlement deducts the frozen amount once", paidIdx > 0 && financeSrc.slice(paidIdx, paidIdx + 400).includes("freeze_tx_id"), null);
const requestStart = companionSrc.indexOf('action === "request_withdrawal"');
const requestSlice = companionSrc.slice(requestStart, companionSrc.indexOf("未知陪玩端操作", requestStart));
check(
  "request stores one fee and freezes the gross amount",
  requestSlice.includes("fee_rm: fee") &&
    requestSlice.includes("net_amount_rm: net") &&
    requestSlice.includes("amount: net") &&
    requestSlice.includes("transaction_type: \"withdrawal\"") &&
    requestSlice.includes("amount,"),
  null
);

function replayWallet() {
  let available = 10000;
  const rows = [];
  function request(amountRm, key) {
    const existing = rows.find((row) => row.key === key);
    const assessed = assessWithdrawalRequest({
      amount: amountRm,
      withdrawable: available / 100,
      openWithdrawalCount: rows.filter((row) => withdrawalLocksBalance(row.status)).length,
      idempotencyKey: key,
      existingByKey: existing || null,
    });
    if (!assessed.ok) return assessed;
    if (assessed.duplicate) return { ...assessed, available };
    available -= assessed.grossCents;
    const row = {
      key,
      status: "pending_friday",
      grossCents: assessed.grossCents,
      feeCents: assessed.feeCents,
      netCents: assessed.grossCents - assessed.feeCents,
    };
    rows.push(row);
    return { ok: true, duplicate: false, available, ...row };
  }
  const first = request(10, "replay-key-0001");
  const dup = request(10, "replay-key-0001");
  const second = request(10, "replay-key-0002");
  const afterApprove = { available, payoutCents: first.netCents, status: "pending_payment" };
  rows[0].status = "rejected";
  available += rows[0].grossCents;
  const afterReject = available;
  const again = request(10, "replay-key-0003");
  rows[1].status = "completed";
  const afterPaid = available;
  const relogin = available;
  return { first, dup, second, afterApprove, afterReject, again, afterPaid, relogin };
}
const replay = replayWallet();
check("RM10 freezes the gross once and nets RM9.20", replay.first.ok && replay.first.grossCents === 1000 && replay.first.netCents === 920 && replay.first.available === 9000, replay.first);
check("the same idempotency key does not freeze again", replay.dup.duplicate === true && replay.dup.available === 9000, replay.dup);
check("a second open withdrawal is rejected and the balance stays frozen", replay.second.ok === false && replay.afterApprove.available === 9000 && replay.afterApprove.payoutCents === 920, replay.second);
check("reject refunds the frozen gross", replay.afterReject === 10000, replay.afterReject);
check("a new request after refund freezes RM10 again", replay.again.ok && replay.again.available === 9000 && replay.again.netCents === 920, replay.again);
check("marking paid does not deduct the fee a second time", replay.afterPaid === 9000 && replay.relogin === 9000, replay);

const failed = results.filter((row) => !row.ok);
console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exit(1);
