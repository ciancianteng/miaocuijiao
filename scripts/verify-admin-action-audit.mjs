/**
 * Guards against admin UI fake-success regressions found in the backend action audit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = fs.readFileSync(path.join(root, "src/admin-suite.js"), "utf8");
const players = fs.readFileSync(path.join(root, "server/api/admin/players.js"), "utf8");
const gate = fs.readFileSync(path.join(root, "server/api/_companion-publish-gate.js"), "utf8");

assert.equal(/alert\('已执行：'/.test(suite), false, "fake data-action success alert must stay removed");
assert.match(suite, /未接入真实后台接口|未写入数据库/);

assert.equal(/data-action="batch-select"/.test(suite), false);
assert.equal(/data-action="export-csv"/.test(suite), false);
assert.equal(/data-action="export-excel"/.test(suite), false);

assert.equal(/invite\|ban\/\.test\(bossAct\)/.test(suite), false);
assert.match(suite, /bossViewTabs/);
assert.match(suite, /bossAct==='ban'/);
assert.match(suite, /bossAct==='unban'/);
assert.match(suite, /bossAct==='blacklist'/);

assert.match(suite, /客服创建订单[\s\S]{0,120}尚未接入真实订单接口|尚未接入真实订单接口/);
assert.match(suite, /测试下单入口已禁用|测试订单[\s\S]{0,40}已禁用/);

assert.match(suite, /rejectReason:1/);
assert.match(players, /applicationRejectReason/);
assert.match(players, /Bare rejectReason/);
assert.equal(
  /if \(payload\.rejectReason != null \|\| payload\.applicationRejectReason/.test(players),
  false
);

assert.match(suite, /Generic approve\/reject stubs removed/);
assert.match(gate, /isFirstApprovalTransition/);
assert.match(players, /isFirstApprovalTransition/);

console.log("verify-admin-action-audit: ok");
