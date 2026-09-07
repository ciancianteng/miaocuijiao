/**
 * Offline verification: production E2E order/wallet/settlement freeze.
 * node scripts/verify-prod-e2e-settlement-freeze.mjs
 */
import assert from "node:assert/strict";
import {
  looksLikeE2eAutomation,
  assertAllPartiesAreDbTestAccounts,
  assertE2eOrderPaymentSettlementAllowed,
  PROD_E2E_SETTLEMENT_FROZEN_CODE,
  PROD_E2E_NON_TEST_PARTY_CODE,
} from "../server/api/_prod-e2e-freeze.js";
import {
  assertProdE2eOrderPaymentSettlementFrozen,
  assertE2ePartiesAreDbTestAccounts,
  isKnownProductionSupabase,
  PRODUCTION_SUPABASE_REF,
} from "./lib/prod-guard.mjs";

assert.equal(looksLikeE2eAutomation({ idempotencyKey: "pr180-settle-1788792439118" }), true);
assert.equal(looksLikeE2eAutomation({ description: "PR180 settlement verify" }), true);
assert.equal(looksLikeE2eAutomation({ reason: "PR180 E2E settlement verify (temp)" }), true);
assert.equal(looksLikeE2eAutomation({ idempotencyKey: "pr180-verify-credit-1" }), true);
assert.equal(looksLikeE2eAutomation({ headers: { "x-mcj-e2e": "1" } }), true);
assert.equal(looksLikeE2eAutomation({ idempotencyKey: "po-page-abc-123", description: "陪玩订单" }), false);

const realBoss = {
  id: "boss-real",
  email: "xiangzai42@gmail.com",
  display_name: "九纹祥",
  is_test_account: false,
};
const testBoss = {
  id: "boss-test",
  email: "boss@meow.test",
  display_name: "ProdSmokeBoss",
  is_test_account: true,
};
const testComp = {
  id: "comp-test",
  email: "pw@meow.test",
  display_name: "SmokePW",
  is_test_account: true,
};

assert.equal(assertAllPartiesAreDbTestAccounts([realBoss]).ok, false);
assert.equal(assertAllPartiesAreDbTestAccounts([testBoss, testComp]).ok, true);
// Heuristic-only smoke name WITHOUT DB flag must fail.
assert.equal(
  assertAllPartiesAreDbTestAccounts([
    { id: "x", email: "x@gmail.com", display_name: "ProdSmokeBoss", is_test_account: false },
  ]).ok,
  false
);

const prodFrozen = assertE2eOrderPaymentSettlementAllowed(
  {
    idempotencyKey: "pr180-settle-1",
    description: "PR180 settlement verify",
    parties: [testBoss, testComp],
  },
  { VERCEL_ENV: "production" }
);
assert.equal(prodFrozen.ok, false);
assert.equal(prodFrozen.code, PROD_E2E_SETTLEMENT_FROZEN_CODE);
assert.equal(prodFrozen.frozen, true);

const previewBlockedReal = assertE2eOrderPaymentSettlementAllowed(
  {
    idempotencyKey: "pr180-settle-1",
    parties: [realBoss, testComp],
  },
  { VERCEL_ENV: "preview" }
);
assert.equal(previewBlockedReal.ok, false);
assert.equal(previewBlockedReal.code, PROD_E2E_NON_TEST_PARTY_CODE);

const previewOk = assertE2eOrderPaymentSettlementAllowed(
  {
    idempotencyKey: "e2e-settle-1",
    parties: [testBoss, testComp],
  },
  { VERCEL_ENV: "preview" }
);
assert.equal(previewOk.ok, true);

const realUserTraffic = assertE2eOrderPaymentSettlementAllowed(
  {
    idempotencyKey: "po-page-user-1",
    description: "三角洲开黑",
    parties: [realBoss],
  },
  { VERCEL_ENV: "production" }
);
assert.equal(realUserTraffic.ok, true, "organic traffic must not be frozen");

const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
assert.equal(isKnownProductionSupabase(prodUrl), true);
assert.throws(() =>
  assertProdE2eOrderPaymentSettlementFrozen({
    script: "unit",
    supabaseUrl: prodUrl,
  })
);
// Override env must NOT unlock settlement E2E freeze.
process.env.ALLOW_PROD_SUPABASE_WRITE = "1";
process.env.CONFIRM_PROD_WRITE = "I_UNDERSTAND_PROD_RISK";
assert.throws(() =>
  assertProdE2eOrderPaymentSettlementFrozen({
    script: "unit-override",
    supabaseUrl: prodUrl,
  })
);
delete process.env.ALLOW_PROD_SUPABASE_WRITE;
delete process.env.CONFIRM_PROD_WRITE;

assert.throws(() => assertE2ePartiesAreDbTestAccounts([realBoss], "unit"));
assert.equal(assertE2ePartiesAreDbTestAccounts([testBoss, testComp], "unit").ok, true);

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "production E2E order/wallet/settlement freeze verification passed",
      prodE2eFrozen: true,
      nonTestPartiesBlocked: true,
      organicTrafficAllowed: true,
      overrideCannotUnlock: true,
    },
    null,
    2
  )
);
