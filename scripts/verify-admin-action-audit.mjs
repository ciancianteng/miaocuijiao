/**
 * Guards against admin UI fake-success / placeholder / frontend-only regressions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = fs.readFileSync(path.join(root, "src/admin-suite.js"), "utf8");
const players = fs.readFileSync(path.join(root, "server/api/admin/players.js"), "utf8");
const gate = fs.readFileSync(path.join(root, "server/api/_companion-publish-gate.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");

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

assert.match(suite, /客服创建订单[\s\S]{0,120}尚未接入真实订单接口|客服创建订单（未接入）|尚未接入真实订单接口/);
assert.match(suite, /测试下单入口已禁用|测试订单[\s\S]{0,40}已禁用|创建测试订单（已禁用）/);

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

// Production-readiness: no orphan companion-level local delete after early return
assert.equal(
  /data-delete-companion-level[\s\S]{0,180}确认删除/.test(suite),
  false,
  "orphaned companion-level confirm-delete after early return must stay removed"
);

// No live-looking webhook save/test buttons in suite fallback
assert.equal(/data-webhook-save=/.test(suite), false);
assert.equal(/data-webhook-test=/.test(suite), false);
assert.match(suite, /Webhook 配置未接入生产安全接口/);

// V1 localStorage account CRUD disabled
assert.match(suite, /blocked V1 localStorage write/);
assert.match(suite, /V1 本地账号管理已停用/);
assert.equal(/function v1Write\(key,val\)\{localStorage\.setItem/.test(suite), false);

// Local data-delete must not mutate collections
assert.match(suite, /已禁用本地假数据删除/);
assert.equal(
  /closest\('\[data-delete\]'\)\)\{var arr=read\(del\.dataset\.delete\);arr\.splice/.test(suite),
  false
);

// Order export must not pretend to hit a missing API successfully
assert.match(suite, /导出（未接入）|订单导出尚未接入真实订单接口/);

// Popularity remains honestly disabled in HTML
assert.match(adminHtml, /data-mcj-popularity-disabled="1"/);

// Platform content must not fall back to localStorage writes
assert.match(suite, /已禁止平台内容写入 localStorage/);
assert.match(suite, /function isLocalPlatformContentType\(type\)\{return false\}/);

console.log("verify-admin-action-audit: ok");
