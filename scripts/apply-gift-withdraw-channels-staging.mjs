#!/usr/bin/env node
/**
 * Staging-only: apply 20260922_gift_withdraw_channels_sot.sql
 * Never prints secrets. Refuses Production.
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
const SQL_REL = "supabase/migrations/20260922_gift_withdraw_channels_sot.sql";

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
    console.log("[gift-withdraw-sot] vercel preview keys:", Object.keys(pulled).join(",") || "(none)");
  } catch (err) {
    console.warn("[gift-withdraw-sot] vercel pull skipped:", err.message || err);
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
    if (ref && ref !== STAGING_PROJECT_REF) {
      throw new Error(`Refusing non-Staging DATABASE_URL ref=${ref}`);
    }
    dbUrl = oneshotDb;
  } else if (oneshotPass) {
    dbUrl = buildStagingPoolerUrl(oneshotPass);
  }

  assertStagingOnly({ databaseUrl: dbUrl, supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co` });
  console.log(`[gift-withdraw-sot] stagingRef=${STAGING_PROJECT_REF} sql=${SQL_REL}`);

  if (dbUrl) {
    const r = await applySqlViaPostgres(dbUrl, sql);
    console.log("[gift-withdraw-sot] postgres apply:", r?.ok === false ? "FAIL" : "OK", r?.message || "");
    if (r?.ok === false) process.exit(1);
  } else if (oneshotPat) {
    const r = await applySqlViaManagementApi(oneshotPat, sql);
    console.log("[gift-withdraw-sot] management apply:", r?.ok === false ? "FAIL" : "OK", r?.message || "");
    if (r?.ok === false) process.exit(1);
  } else {
    throw new Error(
      `Need STAGING_DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN. SQL Editor: https://supabase.com/dashboard/project/${STAGING_PROJECT_REF}/sql/new`
    );
  }
  console.log("[gift-withdraw-sot] PASS");
}

main().catch((e) => {
  console.error("[gift-withdraw-sot] FAIL", e.message || e);
  process.exit(1);
});
