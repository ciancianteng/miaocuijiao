#!/usr/bin/env node
/**
 * Offline checks for payment QR layout and per-user notification read.
 * Does not touch Production or Staging.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeRecords, remainingUnread, userUnreadFilter } from "../server/api/_user-notifications.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "payment-confirm.html"), "utf8");
const badge = readFileSync(path.join(root, "src/app-badge.js"), "utf8");
const notes = readFileSync(path.join(root, "server/api/_user-notifications.js"), "utf8");
const bell = readFileSync(path.join(root, "src/mcj-bell.js"), "utf8");

const mobile = html.slice(html.indexOf("@media(max-width:560px)"));
assert.equal(mobile.includes("min(88vw"), false);
assert.match(mobile, /max-width:100%/);
assert.match(mobile, /height:auto/);
assert.match(mobile, /object-fit:contain/);
assert.equal(mobile.includes("min-width:180px"), false);
assert.match(html, /overflow-wrap:anywhere/);

assert.match(bell, /top:2px;right:2px/);
assert.equal(bell.includes("top:-1px"), false);

const a = userUnreadFilter("user-a");
const b = userUnreadFilter("user-b");
assert.match(a, /user_id=eq\.user-a/);
assert.match(b, /user_id=eq\.user-b/);
assert.equal(a === b, false);
assert.match(a, /is_read\.is\.false/);

const rows = [
  { id: "1", user_id: "user-a", is_read: false },
  { id: "2", user_id: "user-a", is_read: true },
  { id: "3", user_id: "user-b", is_read: false },
];
assert.equal(remainingUnread(rows.filter((row) => row.user_id === "user-a")), 1);
assert.equal(remainingUnread(rows.filter((row) => row.user_id === "user-a"), { all: true }), 0);
assert.equal(remainingUnread(rows.filter((row) => row.user_id === "user-b")), 1);

const created = dedupeRecords([
  { userId: "user-a", eventKey: "order:1:paid" },
  { userId: "user-a", eventKey: "order:1:paid" },
  { userId: "user-a", eventKey: "order:1:done" },
  { userId: "user-b", eventKey: "order:1:paid" },
]);
assert.equal(created.length, 3);

assert.match(notes, /已读状态写入失败/);
assert.match(notes, /userUnreadFilter\(userId\)/);
assert.match(badge, /body\.ok === false/);
assert.match(badge, /data-mcj-notification-center/);
assert.equal(badge.includes("paint(0)"), true);

console.log("verify-pay-layout-and-notify: PASS");
