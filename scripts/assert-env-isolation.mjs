#!/usr/bin/env node
/**
 * HARD FAIL env isolation guard.
 *
 * - VERCEL_ENV=production  → SUPABASE_URL must be Production ref
 * - VERCEL_ENV=preview     → SUPABASE_URL must NOT be Production ref
 *                            (prefer Staging ref when present)
 *
 * Wire into Vite build / serverless boot so a mis-wired deploy cannot ship.
 */
import {
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const vercelEnv = String(process.env.VERCEL_ENV || process.env.APP_ENV || "").toLowerCase();
const url =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";
const ref = supabaseProjectRef(url);

function fail(msg) {
  console.error(`[assert-env-isolation] FAIL: ${msg}`);
  process.exit(1);
}

if (!vercelEnv) {
  // Local/dev: soft skip unless FORCE_ENV_ISOLATION=1
  if (process.env.FORCE_ENV_ISOLATION === "1") {
    fail("VERCEL_ENV/APP_ENV missing under FORCE_ENV_ISOLATION=1");
  }
  console.log("[assert-env-isolation] skip (no VERCEL_ENV; local)");
  process.exit(0);
}

if (vercelEnv === "production") {
  if (!ref) fail("Production deploy missing SUPABASE_URL");
  if (ref !== PRODUCTION_SUPABASE_REF) {
    fail(
      `Production must use Supabase ${PRODUCTION_SUPABASE_REF}, got "${ref}". ` +
        `Staging ref ${STAGING_SUPABASE_REF} is forbidden on Production.`
    );
  }
  console.log(`[assert-env-isolation] OK production → ${ref}`);
  process.exit(0);
}

if (vercelEnv === "preview" || vercelEnv === "development") {
  if (!ref) fail(`${vercelEnv} deploy missing SUPABASE_URL`);
  if (ref === PRODUCTION_SUPABASE_REF) {
    fail(
      `${vercelEnv} must NOT use Production Supabase ${PRODUCTION_SUPABASE_REF}. ` +
        `Use Staging ${STAGING_SUPABASE_REF}.`
    );
  }
  if (ref !== STAGING_SUPABASE_REF) {
    console.warn(
      `[assert-env-isolation] WARN ${vercelEnv} ref="${ref}" (expected staging ${STAGING_SUPABASE_REF})`
    );
  }
  console.log(`[assert-env-isolation] OK ${vercelEnv} → ${ref}`);
  process.exit(0);
}

console.log(`[assert-env-isolation] skip unknown VERCEL_ENV=${vercelEnv}`);
