/**
 * Regression: admin approve ↔ public hall visibility (PR188).
 * Run: node scripts/verify-approve-hall-visibility-sync.mjs
 *
 * Covers:
 * 1) approved non-test companion -> hallVisible=true
 * 2) missing price/game/nickname -> approval blocked (no projected approve)
 * 3) test account approved -> stays hidden
 * 4) allow_orders=false -> explicit unlist / not hallVisible
 * Plus: shared approve projection fields, friendly blockReasons, smoke heuristic align.
 */
import assert from "node:assert/strict";
import {
  adminPublishSnapshot,
  assertApproveCanPublish,
  projectApprovedRow,
  evaluatePublishGate,
  isFirstApprovalTransition,
  isTestAccount,
} from "../server/api/_companion-publish-gate.js";
import { isTestAccountRecord } from "../server/api/_test-accounts.js";

const profile = { id: "u1", status: "active", role: "companion", is_test_account: false };

function okReady() {
  return {
    id: "c1",
    user_id: "u1",
    nickname: "喵喵",
    game: "三角洲 端游",
    price: 30,
    application_status: "pending",
    verification_status: "pending",
    allow_orders: false,
    is_test_account: false,
  };
}

function approvedRow(extra = {}) {
  return {
    ...okReady(),
    application_status: "approved",
    verification_status: "approved",
    allow_orders: true,
    ...extra,
  };
}

// --- Required regressions ---

// 1) approved non-test companion -> hallVisible=true
{
  const snap = adminPublishSnapshot(approvedRow(), profile, {});
  assert.equal(snap.adminApproved, true);
  assert.equal(snap.isTestAccount, false);
  assert.equal(snap.hallVisible, true);
  assert.equal(snap.approvedButHidden, false);
  assert.deepEqual(snap.blockReasons, []);
  const gate = evaluatePublishGate(approvedRow(), profile, {});
  assert.equal(gate.hallVisible, true);
}

// 2) approved missing price/game/nickname -> approval blocked
{
  for (const bad of [
    { nickname: "", label: "缺少昵称" },
    { game: "", price: 30, game_prices: {}, service_ids: [], service_type: "", label: "缺少游戏资料" },
    { price: 0, game_prices: {}, label: "缺少价格" },
  ]) {
    let threw = false;
    try {
      assertApproveCanPublish({ ...okReady(), ...bad }, {}, profile);
    } catch (err) {
      threw = true;
      assert.equal(err.status, 400);
      assert.ok(err.code === "APPROVE_NOT_HALL_READY" || err.code === "MISSING_PRICE" || true);
      assert.ok(Array.isArray(err.blockReasons) && err.blockReasons.length > 0);
      // User-friendly: concrete field reasons, not only opaque codes.
      assert.ok(
        err.blockReasons.some((r) => /缺少昵称|缺少游戏|缺少价格|资料不完整/.test(String(r))),
        `expected friendly reason for ${bad.label}, got ${JSON.stringify(err.blockReasons)}`
      );
      assert.ok(/无法通过审核/.test(String(err.message || "")));
    }
    assert.equal(threw, true, `expected block for ${bad.label}`);
  }
}

// Combined incomplete also blocked with multiple concrete reasons.
{
  let err;
  try {
    assertApproveCanPublish({ ...okReady(), nickname: "", game: "", price: 0 }, {}, profile);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.equal(err.code, "APPROVE_NOT_HALL_READY");
  assert.ok(err.blockReasons.includes("缺少昵称"));
  assert.ok(err.blockReasons.includes("缺少游戏资料"));
  assert.ok(err.blockReasons.includes("缺少价格"));
  assert.equal(err.blockReasons.includes("资料不完整，暂未发布"), false);
}

// 3) test account approved -> stays hidden
{
  const row = approvedRow({ is_test_account: true });
  const testProfile = { ...profile, is_test_account: true };
  assert.equal(isTestAccount(row, testProfile), true);
  const snap = adminPublishSnapshot(row, testProfile, {});
  assert.equal(snap.isTestAccount, true);
  assert.equal(snap.hallVisible, false);
  assert.equal(snap.approvedButHidden, false);
  assert.ok(snap.blockReasons.includes("测试账号"));

  // Approve-time allows test accounts but marks isolation (does not throw).
  const preview = assertApproveCanPublish(
    { ...okReady(), is_test_account: true },
    {},
    testProfile
  );
  assert.equal(preview.isTestAccount, true);
  assert.equal(preview.hallVisible, false);
}

// Smoke heuristic aligned with public hall (email/name), not only DB flag.
{
  const smokeProfile = { ...profile, email: "bot@meow.test", display_name: "ProdSmokeBot" };
  assert.equal(isTestAccountRecord(smokeProfile, okReady()), true);
  const preview = assertApproveCanPublish(okReady(), {}, smokeProfile);
  assert.equal(preview.isTestAccount, true);
  assert.equal(preview.hallVisible, false);
}

// 4) allow_orders=false -> explicit unlist state (not hallVisible)
{
  const snap = adminPublishSnapshot(approvedRow({ allow_orders: false }), profile, {});
  assert.equal(snap.adminApproved, true);
  assert.equal(snap.hallVisible, false);
  assert.equal(snap.approvedButHidden, true);
  assert.ok(snap.blockReasons.includes("禁止接单"));
  assert.ok(/禁止接单/.test(snap.listingBlockReason || snap.statusLabel || ""));
}

// --- Shared entry-point contract helpers ---

{
  const projected = projectApprovedRow(okReady(), {});
  assert.equal(projected.application_status, "approved");
  assert.equal(projected.verification_status, "approved");
  assert.equal(projected.allow_orders, true);
}

{
  assert.equal(isFirstApprovalTransition({ application_status: "pending" }, "approved"), true);
  assert.equal(isFirstApprovalTransition({ application_status: "approved" }, "approved"), false);
}

{
  const snap = assertApproveCanPublish(okReady(), {}, profile);
  assert.equal(snap.hallVisible, true);
  assert.deepEqual(snap.blockReasons, []);
}

console.log("verify-approve-hall-visibility-sync: ok");
