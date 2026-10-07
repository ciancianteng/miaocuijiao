#!/usr/bin/env node
/**
 * Staging-only: apply service standards + order service_snapshot columns.
 * Refuses Production (jqfaknpmcnqwqvatrwgo).
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
  "supabase/migrations/20261004_service_standard_snapshot.sql",
  "supabase/pending-prod/21_service_standard_snapshot.sql",
];

async function main() {
  const oneshotDb = String(
    process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
  ).trim();
  const oneshotPass = String(
    process.env.STAGING_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || ""
  ).trim();
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
        "File: supabase/migrations/20261004_service_standard_snapshot.sql",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[service-standard] sql=${sqlPath}`);
  console.log(`[service-standard] stagingRef=${STAGING_PROJECT_REF}`);
  console.log("[service-standard] Production was NOT targeted.");
  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, sql)
    : await applySqlViaManagementApi(oneshotPat, sql);
  console.log("[service-standard] ok", result.ok, result.via);
}

main().catch((err) => {
  console.error("[service-standard] failed:", err.message || err);
  process.exit(1);
});
