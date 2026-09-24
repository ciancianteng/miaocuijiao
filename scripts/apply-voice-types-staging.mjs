#!/usr/bin/env node
/**
 * Staging-only: apply companion_voice_types DDL.
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
const SQL_REL = "supabase/migrations/20260804_companion_voice_types.sql";

function parseEnvText(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
    ["vercel", "env", "pull", out, "--project", "meow-cuijiao-homepage", "--environment=preview", "--yes"],
    { encoding: "utf8", shell: true, cwd: root }
  );
  if (pull.status !== 0) throw new Error(`vercel env pull failed: ${pull.status}`);
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
  } catch (err) {
    console.warn("[voice-types] vercel pull skipped:", err.message || err);
  }

  const sqlBundle = readSqlFile([SQL_REL, path.join(root, SQL_REL)]);
  const sql = sqlBundle.sql;
  const oneshotDb = String(env.STAGING_DATABASE_URL || env.DATABASE_URL || "").trim();
  const oneshotPass = String(env.STAGING_DB_PASSWORD || env.SUPABASE_DB_PASSWORD || "").trim();
  const oneshotPat = String(env.SUPABASE_ACCESS_TOKEN || env.STAGING_SUPABASE_ACCESS_TOKEN || "").trim();

  let dbUrl = "";
  if (oneshotDb) {
    const ref = projectRefFromDatabaseUrl(oneshotDb);
    if (ref === PRODUCTION_PROJECT_REF) {
      throw new Error(`Refusing Production DATABASE_URL (${PRODUCTION_PROJECT_REF}).`);
    }
    assertStagingOnly(oneshotDb);
    dbUrl = oneshotDb;
  } else if (oneshotPass) {
    dbUrl = buildStagingPoolerUrl(oneshotPass);
    assertStagingOnly(dbUrl);
  }

  console.log(`[voice-types] stagingRef=${STAGING_PROJECT_REF} sql=${SQL_REL}`);
  if (dbUrl) {
    await applySqlViaPostgres(dbUrl, sql);
    console.log("[voice-types] applied via postgres");
  } else if (oneshotPat) {
    await applySqlViaManagementApi(STAGING_PROJECT_REF, oneshotPat, sql);
    console.log("[voice-types] applied via management api");
  } else {
    throw new Error("Need STAGING_DATABASE_URL or STAGING_DB_PASSWORD or SUPABASE_ACCESS_TOKEN");
  }
}

main().catch((err) => {
  console.error("[voice-types] FAILED", err.message || err);
  process.exit(1);
});
