import assert from "node:assert/strict";
import {
  applicationPhase,
  credentialPhase,
  isApplicationQueueRow,
  matchesPlayerAuditFilter,
  matchesPlayerDepositFilter,
  matchesPlayerIdentityFilter,
  reviewCredential,
} from "../server/api/_credential-review.js";

const depositOnly = reviewCredential({
  identityStatus: "",
  identityFile: false,
  depositStatus: "pending",
  depositFile: true,
});
assert.equal(depositOnly.deposit.phase, "pending");
assert.equal(depositOnly.deposit.label, "已上传，待审核");
assert.equal(depositOnly.deposit.required, true);
assert.equal(depositOnly.identity.label, "尚未上传身份证（必填）");
assert.equal(depositOnly.satisfied, false);

const idOnly = reviewCredential({
  identityStatus: "approved",
  identityFile: true,
  depositStatus: "pending",
  depositFile: false,
});
assert.equal(idOnly.identity.phase, "approved");
assert.equal(idOnly.identity.label, "已通过");
assert.equal(idOnly.deposit.phase, "missing");
assert.equal(idOnly.deposit.label, "尚未上传押金（身份证已通过，非必填）");
assert.equal(idOnly.deposit.required, false);
assert.equal(idOnly.satisfied, true);

const neither = reviewCredential({
  identityStatus: "pending",
  identityFile: false,
  depositStatus: "pending",
  depositFile: false,
});
assert.equal(neither.identity.phase, "missing");
assert.equal(neither.deposit.phase, "missing");
assert.equal(neither.deposit.label, "尚未上传押金（必填）");
assert.equal(neither.identity.label, "尚未上传身份证（必填）");
assert.equal(neither.satisfied, false);

const uploadedNotApproved = reviewCredential({
  identityStatus: "draft",
  identityFile: true,
  depositStatus: "paid",
  depositFile: true,
});
assert.equal(uploadedNotApproved.identity.phase, "uploaded");
assert.equal(uploadedNotApproved.identity.label, "已上传");
assert.equal(uploadedNotApproved.deposit.phase, "approved");
assert.equal(credentialPhase({ status: "rejected", hasFile: true }), "rejected");
assert.equal(credentialPhase({ status: "pending", hasFile: false }), "missing");

const rejected = reviewCredential({
  identityStatus: "",
  identityFile: false,
  depositStatus: "rejected",
  depositFile: true,
});
assert.equal(rejected.deposit.phase, "rejected");
assert.equal(rejected.deposit.label, "已拒绝");
assert.equal(rejected.satisfied, false);

const pendingApp = { id: "a", application_status: "pending", application_submitted_at: "2026-10-18T00:00:00Z" };
const approvedApp = { id: "b", application_status: "approved", application_submitted_at: "2026-10-01T00:00:00Z" };
const draftApp = { id: "c", application_status: "draft" };
const legacyPending = { id: "d", application_status: "pending" };
const blank = { id: "e", application_status: "" };
assert.equal(applicationPhase(pendingApp), "pending");
assert.equal(applicationPhase(approvedApp), "approved");
assert.equal(applicationPhase(draftApp), "draft");
assert.equal(applicationPhase(legacyPending), "pending");
assert.equal(applicationPhase(blank), "draft");
assert.equal(isApplicationQueueRow(pendingApp), true);
assert.equal(isApplicationQueueRow(approvedApp), true);
assert.equal(isApplicationQueueRow(draftApp), false);
assert.equal(isApplicationQueueRow(legacyPending), true);
assert.equal(isApplicationQueueRow(blank), false);

const phases = ["pending", "approved", "rejected", "draft"];
for (const phase of phases) {
  const buckets = ["未审核", "已通过", "已拒绝"].filter((filter) => matchesPlayerAuditFilter(filter, phase));
  if (phase === "pending") assert.deepEqual(buckets, ["未审核"]);
  if (phase === "approved") assert.deepEqual(buckets, ["已通过"]);
  if (phase === "rejected") assert.deepEqual(buckets, ["已拒绝"]);
  if (phase === "draft") assert.deepEqual(buckets, []);
  assert.equal(matchesPlayerAuditFilter("待审核", phase), phase === "pending");
  assert.equal(matchesPlayerAuditFilter("审核中", phase), phase === "pending");
}
assert.equal(matchesPlayerIdentityFilter("已认证", "approved"), true);
assert.equal(matchesPlayerIdentityFilter("已上传", "pending"), false);
assert.equal(matchesPlayerIdentityFilter("审核中", "pending"), true);
assert.equal(matchesPlayerIdentityFilter("未认证", "missing"), true);
assert.equal(matchesPlayerDepositFilter("未缴纳", "pending"), false);
assert.equal(matchesPlayerDepositFilter("待审核", "pending"), true);
assert.equal(matchesPlayerDepositFilter("待审核", "uploaded"), true);
assert.equal(matchesPlayerDepositFilter("未缴纳", "missing"), true);
assert.equal(matchesPlayerDepositFilter("已缴纳", "approved"), true);

console.log("credential-review: pass");
