#!/usr/bin/env node
/**
 * Staging-only N1: apply companion_notifications CREATE IF NOT EXISTS.
 * Session Pooler preferred. Refuses Production. No emit / order-flow changes.
 *
 *   STAGING_DB_PASSWORD=… node scripts/apply-companion-notifications-n1-staging.mjs
 *   STAGING_DATABASE_URL='postgresql://postgres.<ref>@aws-0-….pooler.supabase.com:5432/postgres' \
 *     node scripts/apply-companion-notifications-n1-staging.mjs
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
  "supabase/migrations/20260804_companion_notifications.sql",
  "server/api/_sql/20260804_companion_notifications.sql",
];

function isDirectDbHost(dbUrl) {
  try {
    return /^db\.[a-z0-9]+\.supabase\.co$/i.test(new URL(String(dbUrl || "")).hostname);
  } catch {
    return false;
  }
}

function resolvePoolerOnlyUrls() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const out = [];
  const push = (url, via) => {
    const s = String(url || "").trim();
    if (!s || out.some((x) => x.url === s)) return;
    if (isDirectDbHost(s)) {
      console.warn(`[n1] skip Direct db.* URL (${via}) — Session Pooler only`);
      return;
    }
    out.push({ url: s, via });
  };

  if (oneshotPass) push(buildStagingPoolerUrl(oneshotPass), "STAGING_DB_PASSWORD+pooler");
  if (oneshotDb && !isDirectDbHost(oneshotDb)) push(oneshotDb, "STAGING_DATABASE_URL");
  // If only Direct URL is set, rewrite via password or URL password → pooler.
  if (oneshotDb && isDirectDbHost(oneshotDb)) {
    try {
      const fromUrl = decodeURIComponent(new URL(oneshotDb).password || "");
      if (oneshotPass) push(buildStagingPoolerUrl(oneshotPass), "direct→pooler+STAGING_DB_PASSWORD");
      if (fromUrl && fromUrl !== oneshotPass) push(buildStagingPoolerUrl(fromUrl), "direct→pooler+urlPassword");
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function probeRest() {
  const url = String(process.env.STAGING_SUPABASE_URL || `https://${STAGING_PROJECT_REF}.supabase.co`).replace(
    /\/$/,
    ""
  );
  const key = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return { skipped: true };
  const ref = projectRefFromSupabaseUrl(url);
  if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production STAGING_SUPABASE_URL");
  assertStagingOnly({ supabaseUrl: url });

  const required = [
    "id",
    "companion_id",
    "notice_key",
    "category",
    "title",
    "body",
    "href",
    "created_at",
    "notification_type",
    "related_application_id",
    "order_id",
  ];
  const res = await fetch(
    `${url}/rest/v1/companion_notifications?select=${required.join(",")}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 400) };
  }
  return { ok: true, status: res.status };
}

async function main() {
  const stagingUrl = String(process.env.STAGING_SUPABASE_URL || "").trim();
  if (stagingUrl) {
    const ref = projectRefFromSupabaseUrl(stagingUrl);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production STAGING_SUPABASE_URL");
    assertStagingOnly({ supabaseUrl: stagingUrl });
  }

  const oneshotPat = String(
    process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || ""
  ).trim();
  const candidates = resolvePoolerOnlyUrls();
  for (const c of candidates) {
    const ref = projectRefFromDatabaseUrl(c.url);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production DATABASE_URL");
    assertStagingOnly({ databaseUrl: c.url, supabaseUrl: stagingUrl });
  }

  if (!candidates.length && !oneshotPat) {
    console.error(
      [
        "Missing Staging Session Pooler credentials.",
        `Need STAGING_DB_PASSWORD or pooler STAGING_DATABASE_URL (postgres.${STAGING_PROJECT_REF}@*.pooler.supabase.com).`,
        "Direct db.*.supabase.co is not used (IPv6 ENETUNREACH on Cloud Agents).",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile(SQL_CANDIDATES);
  console.log(`[n1] sql=${sqlPath}`);
  console.log(`[n1] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[n1] Production was NOT targeted.`);
  console.log(`[n1] dbCandidates=${candidates.map((c) => c.via).join(" | ") || "(management_api)"}`);

  let applied = false;
  const errors = [];
  for (const c of candidates) {
    try {
      console.log(`[n1] trying via=${c.via}`);
      const result = await applySqlViaPostgres(c.url, sql);
      console.log("[n1] apply ok", result);
      applied = true;
      break;
    } catch (err) {
      const msg = String(err?.message || err || "");
      errors.push(`${c.via}: ${msg.slice(0, 180)}`);
      console.warn(`[n1] ${c.via} failed: ${msg.slice(0, 180)}`);
    }
  }
  if (!applied && oneshotPat) {
    console.log("[n1] trying Management API");
    console.log("[n1] apply ok", await applySqlViaManagementApi(oneshotPat, sql));
    applied = true;
  }
  if (!applied) {
    throw new Error(`N1 Staging DDL failed. Tried: ${errors.join(" | ") || "none"}`);
  }

  const probe = await probeRest();
  if (probe.skipped) {
    console.log("[n1] REST probe skipped (no STAGING_SUPABASE_SERVICE_ROLE_KEY)");
  } else if (!probe.ok) {
    console.error("[n1] REST probe FAIL", probe.status, probe.body);
    process.exit(1);
  } else {
    console.log("[n1] REST probe PASS — required columns selectable");
  }

  console.log("[n1] PASS Staging storage readiness (no emit behavior)");
}

main().catch((err) => {
  console.error("[n1] failed:", err.message || err);
  process.exit(1);
});
