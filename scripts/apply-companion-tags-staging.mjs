#!/usr/bin/env node
/**
 * Apply supabase/companion-tags.sql to Staging ONLY (cfccwysniduwkjskiqgy).
 *
 * Usage:
 *   STAGING_DATABASE_URL='postgresql://…cfccwysniduwkjskiqgy…' node scripts/apply-companion-tags-staging.mjs
 *   STAGING_DB_PASSWORD='…' node scripts/apply-companion-tags-staging.mjs
 *   SUPABASE_ACCESS_TOKEN='sbp_…' node scripts/apply-companion-tags-staging.mjs
 *
 * Refuses Production (jqfaknpmcnqwqvatrwgo) and any other project ref.
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
  "supabase/companion-tags.sql",
  "server/api/_sql/companion-tags.sql",
];

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
        "File: supabase/companion-tags.sql",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[apply] sql=${sqlPath}`);
  console.log(`[apply] stagingRef=${STAGING_PROJECT_REF}`);

  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, sql)
    : await applySqlViaManagementApi(oneshotPat, sql);

  console.log("[apply] ok", result);
  console.log("[apply] Production was NOT touched.");
}

main().catch((err) => {
  console.error("[apply] failed:", err.message || err);
  process.exit(1);
});
