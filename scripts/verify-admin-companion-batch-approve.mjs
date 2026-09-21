#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/admin-companion-applications.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../server/api/admin/players.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");

assert.match(html, /admin-companion-applications\.js\?v=20260922batchApprove1/);

assert.match(ui, /data-capp-check/);
assert.match(ui, /data-capp-select-all/);
assert.match(ui, /已选择/);
assert.match(ui, /批量通过/);
assert.match(ui, /确认通过已选择的/);
assert.match(ui, /batch_review_application/);
assert.match(ui, /selectedEligibleIds/);
assert.match(ui, /isBatchEligible/);
assert.match(ui, /disabled/);
assert.match(ui, /已拒绝\/已通过/);
assert.doesNotMatch(ui, /data-capp-batch-approve[\s\S]{0,200}review\(ids\[0\]/);

assert.match(api, /function isBatchApprovableApplication/);
assert.match(api, /async function batchReviewApplications/);
assert.match(api, /batch_review_application/);
assert.match(api, /BATCH_APPROVE_MAX/);
assert.match(api, /当前状态不可批量通过/);
assert.match(api, /成功 " \+ successCount \+ "，失败 " \+ failCount/);

const batchIdx = api.indexOf('action === "batch_review_application"');
const missingIdIdx = api.indexOf('缺少陪玩 ID');
assert.ok(batchIdx > 0 && missingIdIdx > batchIdx, "batch action must run before missing-id guard");

const rejectSkip = api.slice(api.indexOf("function isBatchApprovableApplication"), api.indexOf("async function batchReviewApplications"));
assert.match(rejectSkip, /rejected/);
assert.match(rejectSkip, /approved/);
assert.match(rejectSkip, /resubmit/);

console.log("verify-admin-companion-batch-approve: PASS");
