#!/usr/bin/env node
/**
 * Staging-only: apply OTP password_reset_requests fix migration.
 * Refuses Production. Does not send mail or mutate orders.
 *
 *   STAGING_DATABASE_URL=… node scripts/apply-otp-fix-staging.mjs
 *   STAGING_DB_PASSWORD=… node scripts/apply-otp-fix-staging.mjs
 */
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  readSqlFile,
  applySqlViaPostgres,
  applySqlViaManagementApi,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";

const SQL_CANDIDATES = [
  "supabase/migrations/20260908_otp_password_reset_requests_fix.sql",
  "server/api/_sql/20260908_otp_password_reset_requests_fix.sql",
];

async function main() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const oneshotPat = String(
    process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || ""
  ).trim();
  const stagingUrl = String(process.env.STAGING_SUPABASE_URL || "").trim();
  const dbUrl = oneshotDb || (oneshotPass ? buildStagingPoolerUrl(oneshotPass) : "");

  if (stagingUrl) {
    const ref = projectRefFromSupabaseUrl(stagingUrl);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production STAGING_SUPABASE_URL");
    assertStagingOnly({ supabaseUrl: stagingUrl, databaseUrl: dbUrl });
  }
  if (dbUrl) {
    const ref = projectRefFromDatabaseUrl(dbUrl);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production DATABASE_URL");
    assertStagingOnly({ databaseUrl: dbUrl });
  }

  if (!dbUrl && !oneshotPat) {
    console.error(
      [
        "Missing Staging credentials.",
        `Expected STAGING_DATABASE_URL (ref ${STAGING_PROJECT_REF}) or STAGING_DB_PASSWORD or SUPABASE_ACCESS_TOKEN.`,
        `SQL: supabase/migrations/20260908_otp_password_reset_requests_fix.sql`,
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[otp-fix] sql=${sqlPath}`);
  console.log(`[otp-fix] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[otp-fix] Production was NOT targeted.`);

  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, sql)
    : await applySqlViaManagementApi(oneshotPat, sql);
  console.log("[otp-fix] apply ok", result);

  // Optional schema probe via REST if Staging key present
  const key = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const url = stagingUrl || `https://${STAGING_PROJECT_REF}.supabase.co`;
  if (key) {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/password_reset_requests?select=id,kind,delivery_status,provider_message_id&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[otp-fix] probe FAIL", res.status, text.slice(0, 300));
      process.exit(1);
    }
    console.log("[otp-fix] probe PASS — table selectable");
  } else {
    console.log("[otp-fix] skip REST probe (no STAGING_SUPABASE_SERVICE_ROLE_KEY)");
  }
}

main().catch((err) => {
  console.error("[otp-fix] failed:", err.message || err);
  process.exit(err.status === 2 ? 2 : 1);
});
