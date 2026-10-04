#!/usr/bin/env node
/**
 * Offline: grab-hall / companion order views never expose internal order-note markers.
 * node scripts/verify-hall-internal-markers-offline.mjs
 */
import assert from "node:assert/strict";
import { stripInternalMarkers, sanitizeHallOrderView } from "../server/api/_order-assignment.js";

const raw = [
  "cursor_acceptance grab confirm-assign repro 游戏ID：CA-GRAB-ASSIGN-1791129749660",
  "[[PAYMENT_PROOF]] bucket=companion-payment-proofs path=/payment-proofs//1791129747215-6e915653-proof-v1.png",
  '[[BOSS_INTENT]]{"companion_id":"61c0fb64-0467-4d8c-9c1a-2d4c1a670ec9","companion_name":"A"}[[/BOSS_INTENT]]',
  "[[CLAIMED_AT]] 2026-10-04T15:58:43Z",
  "[[REVIEW_STAFF:abc]] reviewer",
  "老板备注：带我上分",
].join("\n");

const LEAK = /PAYMENT_PROOF|bucket=|path=|payment-proofs|BOSS_INTENT|CLAIMED_AT|REVIEW_STAFF|\[\[/;

const cleaned = stripInternalMarkers(raw);
assert.ok(!LEAK.test(cleaned), cleaned);
assert.ok(cleaned.includes("游戏ID：CA-GRAB-ASSIGN-1791129749660"));
assert.ok(cleaned.includes("老板备注：带我上分"));

const hall = sanitizeHallOrderView({ id: "o1", serviceContent: raw, bossNotes: raw, remark: raw });
assert.ok(!LEAK.test(JSON.stringify(hall)), JSON.stringify(hall));
assert.equal(stripInternalMarkers("普通备注 [不是标记]"), "普通备注 [不是标记]");

console.log("PASS hall internal markers offline");
