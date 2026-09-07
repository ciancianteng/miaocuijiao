/**
 * Offline unit checks for scripts/lib/prod-guard.mjs (no network).
 * Usage: node scripts/smoke-prod-guard.mjs
 */
import {
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
  isKnownProductionSupabase,
  isKnownStagingSupabase,
  isProductionAppBase,
  isStagingOrPreviewAppBase,
  assertNonProductionSupabase,
  assertSmokeTargetAllowed,
  assertProdE2eOrderPaymentSettlementFrozen,
  assertE2ePartiesAreDbTestAccounts,
} from "./lib/prod-guard.mjs";

let passed = 0;
let failed = 0;

function check(id, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS | ${id}${detail ? ` | ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`FAIL | ${id}${detail ? ` | ${detail}` : ""}`);
  }
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const stagingUrl = `https://${STAGING_SUPABASE_REF}.supabase.co`;

check("ref-prod", supabaseProjectRef(prodUrl) === PRODUCTION_SUPABASE_REF);
check("ref-staging", supabaseProjectRef(stagingUrl) === STAGING_SUPABASE_REF);
check("is-prod-url", isKnownProductionSupabase(prodUrl));
check("is-staging-url", isKnownStagingSupabase(stagingUrl));
check("host-prod", isProductionAppBase("https://www.meowcuijiao.com"));
check("host-staging", isStagingOrPreviewAppBase("https://meow-cuijiao-homepage-staging.vercel.app"));
check(
  "deny-prod-supabase",
  throws(() => assertNonProductionSupabase("unit", prodUrl))
);
check(
  "deny-prod-base",
  throws(() =>
    assertSmokeTargetAllowed({
      script: "unit",
      base: "https://www.meowcuijiao.com",
      supabaseUrl: stagingUrl,
    })
  )
);
check(
  "allow-staging",
  !throws(() =>
    assertSmokeTargetAllowed({
      script: "unit",
      base: "https://meow-cuijiao-homepage-staging.vercel.app",
      supabaseUrl: stagingUrl,
    })
  )
);

check(
  "freeze-prod-e2e-supabase",
  throws(() => assertProdE2eOrderPaymentSettlementFrozen({ script: "unit", supabaseUrl: prodUrl }))
);
check(
  "freeze-prod-e2e-host",
  throws(() =>
    assertProdE2eOrderPaymentSettlementFrozen({
      script: "unit",
      base: "https://www.meowcuijiao.com",
      supabaseUrl: stagingUrl,
    })
  )
);
process.env.ALLOW_PROD_MUTATION = "1";
process.env.CONFIRM_PROD_MUTATION = "I_UNDERSTAND_PROD_RISK";
check(
  "freeze-ignores-override",
  throws(() => assertProdE2eOrderPaymentSettlementFrozen({ script: "unit", supabaseUrl: prodUrl }))
);
delete process.env.ALLOW_PROD_MUTATION;
delete process.env.CONFIRM_PROD_MUTATION;
check(
  "e2e-parties-require-db-flag",
  throws(() =>
    assertE2ePartiesAreDbTestAccounts(
      [{ email: "real@gmail.com", display_name: "九纹祥", is_test_account: false }],
      "unit"
    )
  )
);
check(
  "e2e-parties-ok-when-flagged",
  !throws(() =>
    assertE2ePartiesAreDbTestAccounts(
      [{ email: "boss@meow.test", display_name: "Smoke", is_test_account: true }],
      "unit"
    )
  )
);

console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} ${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
