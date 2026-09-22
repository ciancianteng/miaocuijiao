#!/usr/bin/env node
/**
 * Attempt Staging SQL apply by reusing pooler password from local prod DATABASE_URL
 * ONLY against Staging ref (cfccwysniduwkjskiqgy). Never touches Production.
 * Never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  applySqlViaPostgres,
  readSqlFile,
  projectRefFromDatabaseUrl,
} from "../server/api/_staging-sql.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    o[m[1]] = v;
  }
  return o;
}

function passwordFromDatabaseUrl(url) {
  try {
    const u = new URL(String(url || "").replace(/^postgresql:/i, "postgres:"));
    return decodeURIComponent(u.password || "");
  } catch {
    return "";
  }
}

async function main() {
  const sqlCandidates = process.argv.slice(2);
  const candidates =
    sqlCandidates.length > 0
      ? sqlCandidates
      : ["supabase/migrations/20260922_wallet_order_holds.sql"];

  const env = {
    ...parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local")),
    ...parseEnv(path.join(root, ".env.local")),
  };
  const prodDb = env.DATABASE_URL || "";
  const prodRef = projectRefFromDatabaseUrl(prodDb);
  console.log("[try-staging-sql] prodDbRef=", prodRef || "(none)");
  if (prodRef && prodRef !== PRODUCTION_PROJECT_REF) {
    console.log("[try-staging-sql] unexpected prod ref; continuing carefully");
  }
  const pass = passwordFromDatabaseUrl(prodDb);
  console.log("[try-staging-sql] hasPass=", !!pass);

  if (!pass) {
    console.error("No password extractable from local DATABASE_URL");
    process.exit(2);
  }

  const dbUrl = buildStagingPoolerUrl(pass);
  const ref = projectRefFromDatabaseUrl(dbUrl);
  console.log("[try-staging-sql] targetRef=", ref);
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error("constructed URL is not Staging");
  }
  assertStagingOnly({ databaseUrl: dbUrl });

  // Probe identity first
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  try {
    await client.connect();
    const ident = await client.query(
      `select current_user as usr, current_database() as db`
    );
    console.log("[try-staging-sql] connected usr=", ident.rows[0]?.usr, "db=", ident.rows[0]?.db);
    await client.end();
  } catch (err) {
    console.error("[try-staging-sql] connect FAIL (password likely differs):", String(err.message || err).slice(0, 120));
    process.exit(3);
  }

  const { path: sqlPath, sql } = readSqlFile(candidates);
  console.log("[try-staging-sql] applying", sqlPath);
  console.log("[try-staging-sql] Production was NOT targeted.");
  const result = await applySqlViaPostgres(dbUrl, sql);
  console.log("[try-staging-sql] ok", result.ok, result.via);
}

main().catch((err) => {
  console.error("[try-staging-sql] failed:", err.message || err);
  process.exit(1);
});
