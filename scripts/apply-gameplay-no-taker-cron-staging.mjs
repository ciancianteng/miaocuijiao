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
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  readSqlFile,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";

const DEFAULT_URL = "https://meow-cuijiao-homepage-staging.vercel.app/api/cron/gameplay-no-taker";
const SQL_FILE = "supabase/migrations/20261004_gameplay_no_taker_pg_cron.sql";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);

/** Optional env file (e.g. `vercel env pull`) consulted for DB credentials only; never merged into process.env. */
function parseEnvFile(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").replace(/\\n$/, "").trim();
  }
  return out;
}
const envFile = String(args["env-file"] || process.env.STAGING_ENV_FILE || "").trim();
const fileEnv = parseEnvFile(envFile);

const DB_URL_KEYS = ["STAGING_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL", "SUPABASE_DB_URL"];
const DB_PASSWORD_KEYS = ["STAGING_DB_PASSWORD", "SUPABASE_DB_PASSWORD", "POSTGRES_PASSWORD"];
const PAT_KEYS = ["STAGING_SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"];

/** Key names + project refs only (no values) — safe to print. */
export function describeCredentialSources() {
  const sources = { file: envFile ? `${path.basename(envFile)} (${Object.keys(fileEnv).length} keys)` : "(none)", found: [] };
  const sbRef = projectRefFromSupabaseUrl(fileEnv.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "");
  sources.fileSupabaseRef = sbRef || "(none)";
  for (const k of DB_URL_KEYS) if (fileEnv[k]) sources.found.push(`${k}→ref=${projectRefFromDatabaseUrl(fileEnv[k]) || "?"}`);
  for (const k of [...DB_PASSWORD_KEYS, ...PAT_KEYS]) if (fileEnv[k]) sources.found.push(`${k}(present)`);
  return sources;
}

export function stagingDbTarget() {
  const fromFile = (k) => String(fileEnv[k] || "").trim();
  const fileSbRef = projectRefFromSupabaseUrl(fileEnv.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "");
  const candidates = [];
  for (const k of DB_URL_KEYS) if (fromFile(k)) candidates.push({ source: `file:${k}`, url: fromFile(k) });
  // A bare password is only trusted when the same file's Supabase URL is the Staging project.
  for (const k of DB_PASSWORD_KEYS) {
    if (fromFile(k) && (k === "STAGING_DB_PASSWORD" || fileSbRef === STAGING_PROJECT_REF)) {
      candidates.push({ source: `file:${k}+staging-pooler`, url: buildStagingPoolerUrl(fromFile(k)) });
    }
  }
  if (process.env.STAGING_DATABASE_URL) candidates.push({ source: "env:STAGING_DATABASE_URL", url: process.env.STAGING_DATABASE_URL.trim() });
  if (process.env.STAGING_DB_PASSWORD) candidates.push({ source: "env:STAGING_DB_PASSWORD+staging-pooler", url: buildStagingPoolerUrl(process.env.STAGING_DB_PASSWORD) });
  // Generic DATABASE_URL may point at Production; only an exact Staging ref is ever used.
  const hit = candidates.find((c) => c.url && projectRefFromDatabaseUrl(c.url) === STAGING_PROJECT_REF);
  if (hit) {
    if (projectRefFromDatabaseUrl(hit.url) === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production database.");
    assertStagingOnly({ databaseUrl: hit.url });
    return { via: "postgres", source: hit.source, ref: STAGING_PROJECT_REF, dbUrl: hit.url };
  }
  const patKey = PAT_KEYS.find((k) => fromFile(k)) || (process.env.STAGING_SUPABASE_ACCESS_TOKEN ? "env:STAGING_SUPABASE_ACCESS_TOKEN" : "");
  const pat = patKey.startsWith("env:") ? process.env.STAGING_SUPABASE_ACCESS_TOKEN : fromFile(patKey);
  if (pat) return { via: "management_api", source: patKey, ref: STAGING_PROJECT_REF, pat };
  return null;
}

/** Read-only identity proof before any write: the target must contain a known Staging-only order UUID. */
export async function assertStagingIdentity(target, fingerprintOrderId) {
  if (target.ref !== STAGING_PROJECT_REF) throw new Error(`Target ref ${target.ref} is not ${STAGING_PROJECT_REF}`);
  if (!fingerprintOrderId) return { ref: target.ref, fingerprint: "skipped" };
  if (!/^[0-9a-f-]{36}$/i.test(fingerprintOrderId)) throw new Error("bad fingerprint uuid");
  const rows = await stagingQuery(target, `select order_no from public.orders where id = '${fingerprintOrderId}'`);
  if (rows.length !== 1) throw new Error("Staging fingerprint order not found — refusing to run.");
  return { ref: target.ref, fingerprint: `ok (${rows[0].order_no})` };
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
  const sources = describeCredentialSources();
  const target = stagingDbTarget();
  if (!target) {
    console.error(
      [
        `Missing Staging DB credentials. Sources (names only): ${JSON.stringify(sources)}`,
        `Need one of: a DB URL whose ref is ${STAGING_PROJECT_REF} (STAGING_DATABASE_URL / POSTGRES_URL / DATABASE_URL), STAGING_DB_PASSWORD, or SUPABASE_ACCESS_TOKEN.`,
        `SQL Editor: https://supabase.com/dashboard/project/${STAGING_PROJECT_REF}/sql/new`,
        `File: ${SQL_FILE}`,
      ].join("\n")
    );
    process.exit(2);
  }
  const identity = await assertStagingIdentity(target, String(args["fingerprint-order"] || ""));
  console.log(
    `[gameplay-cron] target ref=${identity.ref} via=${target.via} source=${target.source} fingerprint=${identity.fingerprint}; Production NOT targeted.`
  );
  if (args.check) {
    const ext = await stagingQuery(
      target,
      "select name, installed_version, default_version from pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault') order by name"
    );
    console.log(JSON.stringify(ext));
    return;
  }

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
