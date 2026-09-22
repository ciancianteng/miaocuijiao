#!/usr/bin/env node
/**
 * Staging-only: resolve credentials via Vercel Preview env pull (or process env),
 * then apply 20260919_orders_parent_order_id.sql.
 * Never prints secret values. Refuses Production.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  applySqlViaPostgres,
  applySqlViaManagementApi,
  readSqlFile,
  projectRefFromDatabaseUrl,
  buildStagingPoolerUrl,
} from "../server/api/_staging-sql.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".env.vercel.staging.resolve");

function parseEnvText(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!v || /\[SENSITIVE\]/i.test(v)) continue;
    env[m[1]] = v;
  }
  return env;
}

function pullPreviewEnv() {
  const pull = spawnSync(
    "npx",
    [
      "vercel",
      "env",
      "pull",
      out,
      "--project",
      "meow-cuijiao-homepage",
      "--environment=preview",
      "--yes",
    ],
    { encoding: "utf8", shell: true, cwd: root }
  );
  if (pull.status !== 0) {
    throw new Error(`vercel env pull failed: ${pull.status}`);
  }
  const text = fs.readFileSync(out, "utf8");
  fs.unlinkSync(out);
  return parseEnvText(text);
}

async function main() {
  const fromProcess = {
    STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL || "",
    DATABASE_URL: process.env.DATABASE_URL || "",
    STAGING_DB_PASSWORD: process.env.STAGING_DB_PASSWORD || "",
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD || "",
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN || "",
    STAGING_SUPABASE_ACCESS_TOKEN: process.env.STAGING_SUPABASE_ACCESS_TOKEN || "",
  };
  let env = { ...fromProcess };
  try {
    const pulled = pullPreviewEnv();
    env = { ...pulled, ...fromProcess };
    console.log("[parent-order-id] vercel preview keys:", Object.keys(pulled).join(",") || "(none)");
  } catch (err) {
    console.log("[parent-order-id] vercel pull skipped:", err.message || err);
  }

  const pgCandidates = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/postgres(ql)?:\/\//i.test(String(v || ""))) continue;
    if (String(v).includes(PRODUCTION_PROJECT_REF)) {
      console.log("[parent-order-id] SKIP_PROD_KEY", k);
      continue;
    }
    if (String(v).includes(STAGING_PROJECT_REF)) pgCandidates.push(k);
  }
  const pass =
    env.STAGING_DB_PASSWORD ||
    env.SUPABASE_DB_PASSWORD ||
    env.POSTGRES_PASSWORD ||
    env.DATABASE_PASSWORD ||
    "";
  const pat =
    env.SUPABASE_ACCESS_TOKEN || env.STAGING_SUPABASE_ACCESS_TOKEN || "";

  console.log("[parent-order-id] stagingRef=", STAGING_PROJECT_REF);
  console.log("[parent-order-id] pgKeys=", pgCandidates.join(",") || "none");
  console.log("[parent-order-id] hasPass=", !!pass, "hasPat=", !!pat);

  let dbUrl =
    env.STAGING_DATABASE_URL ||
    (pgCandidates[0] ? env[pgCandidates[0]] : "") ||
    (pass ? buildStagingPoolerUrl(pass) : "");

  if (dbUrl) {
    const ref = projectRefFromDatabaseUrl(dbUrl);
    console.log("[parent-order-id] dbRef=", ref);
    if (ref === PRODUCTION_PROJECT_REF) {
      throw new Error("Refusing Production DATABASE_URL");
    }
    assertStagingOnly({ databaseUrl: dbUrl });
  }

  if (!dbUrl && !pat) {
    console.error(
      [
        "Missing Staging credentials after Vercel Preview pull.",
        "Set STAGING_DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN,",
        `or apply SQL manually: https://supabase.com/dashboard/project/${STAGING_PROJECT_REF}/sql/new`,
        "File: supabase/migrations/20260919_orders_parent_order_id.sql",
      ].join("\n")
    );
    process.exit(2);
  }

  const { path: sqlPath, sql } = readSqlFile([
    "supabase/migrations/20260919_orders_parent_order_id.sql",
  ]);
  console.log("[parent-order-id] sql=", sqlPath);
  console.log("[parent-order-id] Production was NOT targeted.");
  const result = dbUrl
    ? await applySqlViaPostgres(dbUrl, sql)
    : await applySqlViaManagementApi(pat, sql);
  console.log("[parent-order-id] ok", result.ok, result.via);
}

main().catch((err) => {
  console.error("[parent-order-id] failed:", err.message || err);
  process.exit(1);
});
