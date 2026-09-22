#!/usr/bin/env node
/**
 * Staging-only: apply profiles/companion_profiles.is_test_account.
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

const SQL_CANDIDATES = ["supabase/migrations/20260903_profiles_is_test_account.sql"];

const RELOAD = `
notify pgrst, 'reload schema';
`;

async function main() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || "").trim();
  const oneshotPat = String(process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || "").trim();
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
        "File: supabase/migrations/20260903_profiles_is_test_account.sql",
        "Then: notify pgrst, 'reload schema';",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  const fullSql = `${sql}\n${RELOAD}`;
  console.log(`[is_test_account] sql=${sqlPath}`);
  console.log(`[is_test_account] stagingRef=${STAGING_PROJECT_REF}`);
  console.log("[is_test_account] Production was NOT targeted.");
  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, fullSql)
    : await applySqlViaManagementApi(oneshotPat, fullSql);
  console.log("[is_test_account] ok", result.ok, result.via);
}

main().catch((err) => {
  console.error("[is_test_account] failed:", err.message || err);
  process.exit(1);
});
