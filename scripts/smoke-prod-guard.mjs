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

console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} ${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
