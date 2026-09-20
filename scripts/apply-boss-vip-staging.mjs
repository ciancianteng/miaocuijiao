#!/usr/bin/env node
/**
 * Staging-only: apply Boss VIP spend tables.
 * Refuses Production.
 *
 *   STAGING_DATABASE_URL=… node scripts/apply-boss-vip-staging.mjs
 *   STAGING_DB_PASSWORD=… node scripts/apply-boss-vip-staging.mjs
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
} from "../server/api/_staging-sql.js";

const SQL_CANDIDATES = [
  "supabase/migrations/20260915090000_boss_vip_spend.sql",
  "server/api/_sql/20260915_boss_vip_spend.sql",
];

async function main() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const oneshotPat = String(
    process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || ""
  ).trim();
  const dbUrl = oneshotDb || (oneshotPass ? buildStagingPoolerUrl(oneshotPass) : "");

  if (dbUrl) {
    const ref = projectRefFromDatabaseUrl(dbUrl);
    if (ref === PRODUCTION_PROJECT_REF) {
      throw new Error(`Refusing Production DATABASE_URL (${PRODUCTION_PROJECT_REF}).`);
    }
    assertStagingOnly({ databaseUrl: dbUrl });
  }

  if (!dbUrl && !oneshotPat) {
    console.error(
      [
        "Missing Staging credentials.",
        `Expected STAGING_DATABASE_URL (ref ${STAGING_PROJECT_REF}) or STAGING_DB_PASSWORD or SUPABASE_ACCESS_TOKEN.`,
        `SQL Editor: https://supabase.com/dashboard/project/${STAGING_PROJECT_REF}/sql/new`,
        "File: supabase/migrations/20260915090000_boss_vip_spend.sql",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[boss-vip] sql=${sqlPath}`);
  console.log(`[boss-vip] stagingRef=${STAGING_PROJECT_REF}`);
  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, sql)
    : await applySqlViaManagementApi(oneshotPat, sql);
  console.log("[boss-vip] apply ok", result.ok, result.via);
}

main().catch((err) => {
  console.error("[boss-vip] apply failed:", err.message || err);
  process.exit(1);
});
