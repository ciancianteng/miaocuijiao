#!/usr/bin/env node
/**
 * Offline (F1): Boss / Customer Service / Admin order outputs never expose internal
 * [[MARKERS]], payment-proof bucket/path, while marker-driven logic still reads raw rows.
 * node scripts/verify-order-output-markers-offline.mjs
 */
import assert from "node:assert/strict";
import { viewOrder } from "../server/api/orders.js";
import { safeOrder as csSafeOrder } from "../server/api/customer-service.js";
import { safeOrder as adminSafeOrder } from "../server/api/admin/orders.js";
import { sanitizeOrderText, scrubInternalOutput, isSignedStorageUrl } from "../server/api/_output-sanitize.js";

const BOSS_ID = "11111111-2222-4333-8444-555555555555";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF_PATH = `${BOSS_ID}/payment-proofs/${ORDER_ID}/proof-v2.jpg`;
const SIGNED =
  `https://cfccwysniduwkjskiqgy.supabase.co/storage/v1/object/sign/companion-payment-proofs/${PROOF_PATH}?token=eyJhbGciOi.test`;

const MARKER_LINES = [
  `[[PAYMENT_PROOF]] bucket=companion-payment-proofs path=${PROOF_PATH}`,
  "[[CLAIMED_AT]] 2026-10-05T03:00:00Z",
  "[[GRAB_LISTING]]{\"listing\":1}[[/GRAB_LISTING]]",
  "[[HALL_OPEN_AT]] 2026-10-05T02:00:00Z",
  '[[BOSS_INTENT]]{"companion_id":"c1","companion_name":"A"}[[/BOSS_INTENT]]',
  "[[REPLACED_BY]]ffffffff-0000-4000-8000-000000000001",
  "[[NO_TAKER_REFUND]] amount=30 at=2026-10-05T04:00:00Z",
  "[[SETTLEMENT_SKIPPED]] reason=refund",
  '[[ORDER_GRABS]][{"companion_id":"c2"}][[/ORDER_GRABS]]',
  "[[COMPLETION_PENDING]]",
  "[[COMPLETION_REQUESTED_AT]] 2026-10-05T05:00:00Z",
  "[[COMPLETION_METHOD]] manual",
  "[[COMPLETION_AUTO_PAUSED]]",
  "[[ORDER_FROZEN]] dispute",
  "[[ORDER_DISPUTE]] boss",
  "[[COMPANION_UNAVAILABLE]]|reason:无法接单|companion:cA",
  "[[KEEP_REMAINING_APPLIED]]",
  "[[REVIEW_STAFF:staff-1]] 审核员",
  "[[REVIEWER_ROLE:customer_service]]",
  "[[WALLET_HOLD_PENDING_REVIEW]]",
  '[[DEPOSIT_PAY]]{"x":1}[[/DEPOSIT_PAY]]',
  "[[CLAWBACK]] 10",
  "[[PARTIAL_CLAWBACK]] 5",
  "[[MULTI_ORDER_ROLLBACK]]",
  "[[AFTER_SALE_CLOSED]]",
  "[[ORDER_EXPIRED]]",
  "[[PARENT_ORDER]] p1",
  "[[REPLACEMENT_CHILD]]|replaces:c0",
  "[[SOME_FUTURE_MARKER:abc]] anything",
];
const USER_LINES = ["老板备注：带我上分", "游戏ID：E2E-DELTA-001"];
const RAW = [USER_LINES[0], ...MARKER_LINES, USER_LINES[1]].join("\n");

const LEAK = /\[\[|bucket=|payment-proofs|companion-payment-proofs|path=/;

function leakPaths(value, pathName = "$", out = []) {
  if (typeof value === "string") {
    if (LEAK.test(value) && !isSignedStorageUrl(value)) out.push(`${pathName}=${value.slice(0, 120)}`);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => leakPaths(item, `${pathName}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/^storage_?(path|bucket)$|^storage(Path|Bucket)$/.test(k)) out.push(`${pathName}.${k} (storage key)`);
      leakPaths(v, `${pathName}.${k}`, out);
    }
  }
  return out;
}

let tests = 0;
function check(name, fn) {
  fn();
  tests += 1;
  console.log(`PASS ${name}`);
}

const receipt = {
  id: "rcpt-1",
  status: "pending",
  storage_bucket: "companion-payment-proofs",
  storage_path: PROOF_PATH,
  payment_method: "tng",
  uploaded_at: "2026-10-05T03:00:00Z",
  reject_reason: "[[REVIEW_STAFF:staff-1]] 审核员",
};
const baseRow = {
  id: ORDER_ID,
  order_no: "MCJO999001",
  boss_id: BOSS_ID,
  status: "in_progress",
  game: "三角洲行动",
  title: "三角洲行动爆破模式",
  description: RAW,
  note: RAW,
  notes: "",
  cancel_reason: "",
  total_amount: 30,
  hours: 1,
  unit_price: 30,
  created_at: "2026-10-05T01:00:00Z",
};
const rawSnapshot = JSON.stringify(baseRow);

check("sanitizeOrderText removes every marker and storage hint, keeps user text", () => {
  const out = sanitizeOrderText(RAW);
  assert.ok(!LEAK.test(out), out);
  for (const line of USER_LINES) assert.ok(out.includes(line), `missing user text: ${line}`);
  assert.equal(sanitizeOrderText("普通备注 [不是标记]"), "普通备注 [不是标记]");
});

check("scrubInternalOutput keeps signed URLs, blanks bare proof paths, drops storage keys", () => {
  const out = scrubInternalOutput({ url: SIGNED, bare: PROOF_PATH, receipt, nested: [{ storagePath: PROOF_PATH }] });
  assert.equal(out.url, SIGNED);
  assert.equal(out.bare, "");
  assert.ok(!("storage_path" in out.receipt) && !("storage_bucket" in out.receipt));
  assert.ok(!("storagePath" in out.nested[0]));
  assert.deepEqual(leakPaths(out), []);
});

check("Boss viewOrder: no leak in output; completion logic still reads raw markers", () => {
  const view = viewOrder({ ...baseRow, paymentReceipt: receipt, paymentProofUrl: SIGNED });
  assert.equal(view.completionPending, true);
  assert.equal(view.paymentProofUrl, SIGNED);
  for (const key of ["description", "note", "notes", "bossNotes"]) {
    assert.ok(!LEAK.test(String(view[key] || "")), `${key}: ${view[key]}`);
  }
  assert.deepEqual(leakPaths(scrubInternalOutput(view)), []);
});

check("Boss viewOrder: description-first-line fallback for notes is sanitized", () => {
  const view = viewOrder({ ...baseRow, notes: "", description: `${MARKER_LINES[0]}\n${USER_LINES[0]}` });
  assert.ok(!LEAK.test(String(view.notes || "")), view.notes);
});

check("Boss viewOrder: multi-companion child chips still computed from raw markers", () => {
  const exited = viewOrder({ ...baseRow, parent_order_id: "p1", status: "cancelled", note: "[[COMPANION_UNAVAILABLE]]|reason:无法接单", description: "" });
  assert.equal(exited.companionConfirm?.key, "exited");
  assert.equal(exited.companionConfirm?.needsReplacement, true);
  const kept = viewOrder({ ...baseRow, parent_order_id: "p1", status: "refunded", note: "[[KEEP_REMAINING_APPLIED]]", description: "" });
  assert.equal(kept.companionConfirm?.key, "exited_kept");
  assert.deepEqual(leakPaths(scrubInternalOutput(exited)), []);
});

check("Boss submit_payment_proof response shape: no storage path even when signing fails", () => {
  const body = {
    ok: true,
    receipt: { id: receipt.id, receiptNo: "R1" },
    order: { ...viewOrder({ ...baseRow, status: "awaiting_payment", paymentReceipt: receipt, paymentProofUrl: "" }), paymentProofUrl: "" },
  };
  const out = scrubInternalOutput(body);
  assert.equal(out.order.paymentProofUrl, "");
  assert.deepEqual(leakPaths(out), []);
});

check("CS safeOrder: no leak; needsReassign / completion still read raw note", () => {
  const pending = csSafeOrder({ ...baseRow, status: "pending" }, {}, { paymentReceipt: receipt, paymentProofUrl: SIGNED });
  assert.equal(pending.needsReassign, true);
  assert.equal(pending.completionPending, true);
  assert.ok(!LEAK.test(String(pending.note || "")), pending.note);
  assert.ok(!LEAK.test(String(pending.description || "")), pending.description);
  assert.equal(pending.paymentProofUrl, SIGNED);
  assert.deepEqual(leakPaths(scrubInternalOutput(pending)), []);
});

check("Admin safeOrder: no leak in description / serviceContent; completion still raw", () => {
  const row = { ...baseRow, title: "", service_name: "" };
  const view = adminSafeOrder(row, {}, { paymentReceipt: receipt, paymentProofUrl: SIGNED });
  assert.equal(view.completionPending, true);
  assert.ok(!LEAK.test(String(view.description || "")), view.description);
  assert.ok(!LEAK.test(String(view.serviceContent || "")), view.serviceContent);
  assert.equal(view.paymentProofUrl, SIGNED);
  assert.deepEqual(leakPaths(scrubInternalOutput(view)), []);
});

check("Admin payment-proof center row (receipt + raw order) scrubbed", () => {
  const centerRow = { ...receipt, order: { ...baseRow }, orderNo: baseRow.order_no, proofUrl: SIGNED };
  const out = scrubInternalOutput({ ok: true, pendingPaymentProofs: [centerRow] });
  assert.equal(out.pendingPaymentProofs[0].proofUrl, SIGNED);
  assert.deepEqual(leakPaths(out), []);
});

check("Raw DB row is never mutated by output sanitizing", () => {
  assert.equal(JSON.stringify(baseRow), rawSnapshot);
});

console.log(`PASS F1 order output markers offline (${tests} checks)`);
