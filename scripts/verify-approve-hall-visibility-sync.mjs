/**
 * Contract checks: admin approve ↔ public hall visibility.
 * Run: node scripts/verify-approve-hall-visibility-sync.mjs
 */
import assert from "node:assert/strict";
import {
  adminPublishSnapshot,
  assertApproveCanPublish,
  projectApprovedRow,
  evaluatePublishGate,
  isTestAccount,
} from "../server/api/_companion-publish-gate.js";

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

// 1) Projected approve row sets required status fields.
{
  const projected = projectApprovedRow(okReady(), {});
  assert.equal(projected.application_status, "approved");
  assert.equal(projected.verification_status, "approved");
  assert.equal(projected.allow_orders, true);
}

// 2) Ready companion becomes hallVisible after approve projection.
{
  const snap = assertApproveCanPublish(okReady(), {}, profile);
  assert.equal(snap.hallVisible, true);
  assert.equal(snap.approvedButHidden, false);
  assert.deepEqual(snap.blockReasons, []);
}

// 3) Incomplete companion cannot be first-approved (clear blockReasons).
{
  let threw = false;
  try {
    assertApproveCanPublish(
      { ...okReady(), nickname: "", game: "", price: 0 },
      {},
      profile
    );
  } catch (err) {
    threw = true;
    assert.equal(err.code, "APPROVE_NOT_HALL_READY");
    assert.ok(Array.isArray(err.blockReasons) && err.blockReasons.length > 0);
    assert.ok(err.blockReasons.some((r) => /昵称|游戏|价格|资料不完整/.test(String(r))));
  }
  assert.equal(threw, true);
}

// 4) adminApproved + non-test + !hallVisible => approvedButHidden with reasons.
{
  const snap = adminPublishSnapshot(
    {
      ...okReady(),
      application_status: "approved",
      verification_status: "approved",
      allow_orders: true,
      price: 0,
      game_prices: {},
    },
    profile,
    {}
  );
  assert.equal(snap.adminApproved, true);
  assert.equal(snap.hallVisible, false);
  assert.equal(snap.approvedButHidden, true);
  assert.ok(snap.blockReasons.includes("缺少价格") || snap.blockReasons.some((r) => /价格|资料不完整/.test(r)));
}

// 5) Test accounts stay isolated (not approvedButHidden — intentional isolation).
{
  const row = {
    ...okReady(),
    application_status: "approved",
    verification_status: "approved",
    allow_orders: true,
    is_test_account: true,
  };
  const testProfile = { ...profile, is_test_account: true };
  assert.equal(isTestAccount(row, testProfile), true);
  const snap = adminPublishSnapshot(row, testProfile, {});
  assert.equal(snap.isTestAccount, true);
  assert.equal(snap.hallVisible, false);
  assert.equal(snap.approvedButHidden, false);
  assert.ok(snap.blockReasons.includes("测试账号"));
}

// 6) Gate equation for ready approved companion.
{
  const gate = evaluatePublishGate(projectApprovedRow(okReady(), {}), profile, {});
  assert.equal(gate.hallVisible, true);
  assert.equal(gate.adminApproved, true);
}

console.log("verify-approve-hall-visibility-sync: ok");
