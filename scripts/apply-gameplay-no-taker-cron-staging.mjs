#!/usr/bin/env node
/**
 * Staging-only: install the pg_cron job that ticks /api/cron/gameplay-no-taker every minute.
 * Refuses Production (jqfaknpmcnqwqvatrwgo). Never prints the cron secret.
 *
 *   node scripts/apply-gameplay-no-taker-cron-staging.mjs                 # new secret → Vercel Preview env + Vault
 *   node scripts/apply-gameplay-no-taker-cron-staging.mjs --url-only --url=https://<deployment>/api/cron/gameplay-no-taker
 *   node scripts/apply-gameplay-no-taker-cron-staging.mjs --status
 *
 * After a new secret, redeploy Staging (node scripts/deploy-staging.mjs) so the function sees it.
 */
import "../server/api/_load-env.js";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  readSqlFile,
  projectRefFromDatabaseUrl,
} from "../server/api/_staging-sql.js";

const DEFAULT_URL = "https://meow-cuijiao-homepage-staging.vercel.app/api/cron/gameplay-no-taker";
const SQL_FILE = "supabase/migrations/20261004_gameplay_no_taker_pg_cron.sql";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);

export function stagingDbTarget() {
  const pass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const pat = String(process.env.STAGING_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  const candidates = [
    process.env.STAGING_DATABASE_URL,
    pass ? buildStagingPoolerUrl(pass) : "",
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ].map((v) => String(v || "").trim());
  // Generic DATABASE_URL may point at Production locally; only a Staging ref is ever used.
  const dbUrl = candidates.find((u) => u && projectRefFromDatabaseUrl(u) === STAGING_PROJECT_REF);
  if (dbUrl) {
    if (projectRefFromDatabaseUrl(dbUrl) === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production database.");
    assertStagingOnly({ databaseUrl: dbUrl });
    return { via: "postgres", dbUrl };
  }
  if (pat) return { via: "management_api", pat };
  return null;
}

/** Run statements on Staging; returns rows of the last statement. Params only via postgres. */
export async function stagingQuery(target, sql, params = []) {
  if (target.via === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: target.dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });
    await client.connect();
    try {
      const res = await client.query(sql, params);
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      return last?.rows || [];
    } finally {
      await client.end();
    }
  }
  if (params.length) {
    sql = sql.replace(/\$(\d+)/g, (_, i) => `'${String(params[Number(i) - 1]).replace(/'/g, "''")}'`);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${STAGING_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text || "[]");
  return Array.isArray(json) ? json : [];
}

function setVercelPreviewSecret(secret) {
  const res = spawnSync(
    "npx",
    ["vercel", "env", "add", "GAMEPLAY_CRON_SECRET", "preview", "--force", "--sensitive", "--yes", "--project", "meow-cuijiao-homepage"],
    { input: `${secret}\n`, encoding: "utf8", shell: process.platform === "win32" }
  );
  const out = `${res.stdout || ""}\n${res.stderr || ""}`.split(secret).join("***");
  if (res.status !== 0) throw new Error(`vercel env add failed: ${out.slice(-400)}`);
  return out.split(/\r?\n/).filter((l) => /Added|Overrode|Updated|Success/i.test(l)).slice(-1)[0] || "ok";
}

async function status(target) {
  const jobs = await stagingQuery(
    target,
    "select jobid, jobname, schedule, active, command from cron.job where jobname = 'gameplay-no-taker-sweep'"
  );
  const vault = await stagingQuery(
    target,
    "select name, length(decrypted_secret) as len, case when name like '%url' then decrypted_secret end as value from vault.decrypted_secrets where name like 'gameplay_no_taker_cron_%' order by name"
  );
  const runs = await stagingQuery(
    target,
    "select d.status, d.start_time, d.return_message from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'gameplay-no-taker-sweep' order by d.start_time desc limit 5"
  );
  return { jobs, vault, runs };
}

async function main() {
  const target = stagingDbTarget();
  if (!target) {
    console.error(
      [
        "Missing Staging credentials (STAGING_DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN).",
        `SQL Editor: https://supabase.com/dashboard/project/${STAGING_PROJECT_REF}/sql/new`,
        `File: ${SQL_FILE}`,
      ].join("\n")
    );
    process.exit(2);
  }
  console.log(`[gameplay-cron] stagingRef=${STAGING_PROJECT_REF} via=${target.via}; Production NOT targeted.`);

  if (args.status) {
    console.log(JSON.stringify(await status(target), null, 2));
    return;
  }

  const url = String(args.url || DEFAULT_URL).trim();
  if (!/^https:\/\/meow-cuijiao-homepage-[a-z0-9-]+\.vercel\.app\/api\/cron\/gameplay-no-taker$/.test(url)) {
    throw new Error(`Refusing non-Staging cron URL: ${url}`);
  }

  if (args["url-only"]) {
    await stagingQuery(target, "select vault.update_secret(id, $1) from vault.secrets where name = 'gameplay_no_taker_cron_url'", [url]);
    console.log(`[gameplay-cron] url → ${url}`);
  } else {
    const { sql } = readSqlFile([SQL_FILE]);
    await stagingQuery(target, sql);
    console.log("[gameplay-cron] migration applied");
    const secret = randomBytes(32).toString("base64url");
    console.log(`[gameplay-cron] vercel preview env: ${setVercelPreviewSecret(secret)}`);
    await stagingQuery(target, "select public.mcj_set_gameplay_no_taker_cron($1, $2)", [url, secret]);
    console.log(`[gameplay-cron] vault url=${url} secret=(${secret.length} chars, not printed)`);
  }
  const s = await status(target);
  console.log(JSON.stringify({ jobs: s.jobs, vault: s.vault }, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((err) => {
    console.error("[gameplay-cron] failed:", err.message || err);
    process.exit(1);
  });
}
