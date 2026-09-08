#!/usr/bin/env node
/**
 * Staging-only: apply OTP password_reset_requests fix migration.
 * Refuses Production. Does not send mail or mutate orders.
 *
 *   STAGING_DATABASE_URL=… node scripts/apply-otp-fix-staging.mjs
 *   STAGING_DB_PASSWORD=… node scripts/apply-otp-fix-staging.mjs
 *
 * Prefers Session pooler (IPv4) over direct db.*.supabase.co (often IPv6-only).
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

function isDirectDbHost(dbUrl) {
  try {
    const host = new URL(String(dbUrl || "")).hostname.toLowerCase();
    return /^db\.[a-z0-9]+\.supabase\.co$/.test(host);
  } catch {
    return false;
  }
}

function resolveCandidates() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const list = [];
  const push = (url, via) => {
    const s = String(url || "").trim();
    if (!s) return;
    if (list.some((x) => x.url === s)) return;
    list.push({ url: s, via });
  };
  if (oneshotPass) push(buildStagingPoolerUrl(oneshotPass), "pooler_password");
  try {
    if (oneshotDb) {
      const passUrl = decodeURIComponent(new URL(oneshotDb).password || "");
      if (passUrl && passUrl !== oneshotPass) {
        const u = new URL("postgresql://x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres");
        u.username = `postgres.${STAGING_PROJECT_REF}`;
        u.password = passUrl;
        push(u.toString(), "pooler_from_database_url_password");
      }
    }
  } catch {
    /* ignore */
  }
  if (oneshotDb && !isDirectDbHost(oneshotDb)) push(oneshotDb, "database_url");
  if (oneshotDb) push(oneshotDb, "database_url_direct");
  return list;
}

async function main() {
  const oneshotPat = String(
    process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || ""
  ).trim();
  const stagingUrl = String(process.env.STAGING_SUPABASE_URL || "").trim();
  const candidates = resolveCandidates();

  if (stagingUrl) {
    const ref = projectRefFromSupabaseUrl(stagingUrl);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production STAGING_SUPABASE_URL");
    assertStagingOnly({ supabaseUrl: stagingUrl });
  }
  for (const c of candidates) {
    const ref = projectRefFromDatabaseUrl(c.url);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production DATABASE_URL");
    assertStagingOnly({ databaseUrl: c.url, supabaseUrl: stagingUrl || undefined });
  }

  if (!candidates.length && !oneshotPat) {
    console.error(
      [
        "Missing Staging credentials.",
        `Expected Session-pooler STAGING_DATABASE_URL (ref ${STAGING_PROJECT_REF}) or STAGING_DB_PASSWORD or SUPABASE_ACCESS_TOKEN.`,
        `SQL: supabase/migrations/20260908_otp_password_reset_requests_fix.sql`,
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[otp-fix] sql=${sqlPath}`);
  console.log(`[otp-fix] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[otp-fix] Production was NOT targeted.`);
  console.log(`[otp-fix] ddl candidates=${candidates.map((c) => c.via).join(",") || "management_api"}`);

  let result = null;
  const errors = [];
  for (const c of candidates) {
    try {
      result = { ...(await applySqlViaPostgres(c.url, sql)), viaDetail: c.via };
      break;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      errors.push(`${c.via}: ${msg.slice(0, 160)}`);
      console.warn(`[otp-fix] ${c.via} failed: ${msg.slice(0, 160)}`);
    }
  }
  if (!result) {
    if (oneshotPat) {
      result = await applySqlViaManagementApi(oneshotPat, sql);
    } else {
      throw new Error(
        `DDL apply failed. Tried: ${errors.join(" | ")}. ` +
          `Need Session pooler URI (aws-0-*.pooler.supabase.com / postgres.${STAGING_PROJECT_REF}) ` +
          `with matching password, or SUPABASE_ACCESS_TOKEN.`
      );
    }
  }
  console.log("[otp-fix] apply ok", result);

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
