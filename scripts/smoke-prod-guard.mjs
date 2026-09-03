/**
 * Offline unit smoke for scripts/lib/prod-guard.mjs
 * Does not touch network or databases.
 */
import assert from "node:assert/strict";
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

const results = [];
function step(name, fn) {
  try {
    fn();
    results.push({ step: name, result: "PASS" });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ step: name, result: "FAIL", detail: String(err?.message || err) });
    console.log(`[FAIL] ${name} :: ${err?.message || err}`);
  }
}

step("refs_constant", () => {
  assert.equal(STAGING_SUPABASE_REF, "cfccwysniduwkjskiqgy");
  assert.equal(PRODUCTION_SUPABASE_REF, "jqfaknpmcnqwqvatrwgo");
});

step("parse_supabase_ref", () => {
  assert.equal(supabaseProjectRef(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`), PRODUCTION_SUPABASE_REF);
  assert.equal(supabaseProjectRef(`https://${STAGING_SUPABASE_REF}.supabase.co`), STAGING_SUPABASE_REF);
});

step("classify_supabase", () => {
  assert.equal(isKnownProductionSupabase(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`), true);
  assert.equal(isKnownStagingSupabase(`https://${STAGING_SUPABASE_REF}.supabase.co`), true);
  assert.equal(isKnownProductionSupabase(`https://${STAGING_SUPABASE_REF}.supabase.co`), false);
});

step("classify_app_hosts", () => {
  assert.equal(isProductionAppBase("https://www.meowcuijiao.com"), true);
  assert.equal(isProductionAppBase("https://meowcuijiao.com"), true);
  assert.equal(isStagingOrPreviewAppBase("https://meow-cuijiao-homepage-staging.vercel.app"), true);
  assert.equal(isStagingOrPreviewAppBase("https://meow-cuijiao-homepage-git-abc.vercel.app"), true);
  assert.equal(isProductionAppBase("https://meow-cuijiao-homepage-staging.vercel.app"), false);
});

step("refuse_production_supabase_without_override", () => {
  delete process.env.ALLOW_PROD_SUPABASE_WRITE;
  delete process.env.CONFIRM_PROD_WRITE;
  delete process.env.ALLOW_PROD_MUTATION;
  delete process.env.CONFIRM_PROD_MUTATION;
  assert.throws(() =>
    assertNonProductionSupabase("unit", `https://${PRODUCTION_SUPABASE_REF}.supabase.co`)
  );
});

step("refuse_production_base_for_smoke", () => {
  delete process.env.ALLOW_PROD_SUPABASE_WRITE;
  delete process.env.CONFIRM_PROD_WRITE;
  assert.throws(() =>
    assertSmokeTargetAllowed({
      script: "unit",
      base: "https://www.meowcuijiao.com",
      supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    })
  );
});

step("allow_staging_smoke", () => {
  const ok = assertSmokeTargetAllowed({
    script: "unit",
    base: "https://meow-cuijiao-homepage-staging.vercel.app",
    supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    requireStagingSupabase: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.bypassed, false);
});

step("refuse_production_database_url", () => {
  assert.throws(() =>
    assertSmokeTargetAllowed({
      script: "unit",
      base: "https://meow-cuijiao-homepage-staging.vercel.app",
      databaseUrl: `postgresql://postgres.${PRODUCTION_SUPABASE_REF}:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    })
  );
});

step("override_requires_dual_flags", () => {
  process.env.ALLOW_PROD_SUPABASE_WRITE = "1";
  process.env.CONFIRM_PROD_WRITE = "I_UNDERSTAND_PROD_RISK";
  const ok = assertSmokeTargetAllowed({
    script: "unit-override",
    base: "https://www.meowcuijiao.com",
    supabaseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
  });
  assert.equal(ok.bypassed, true);
  delete process.env.ALLOW_PROD_SUPABASE_WRITE;
  delete process.env.CONFIRM_PROD_WRITE;
});

const failed = results.filter((r) => r.result !== "PASS");
console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
process.exit(failed.length ? 1 : 0);
