#!/usr/bin/env node
/**
 * ONE-SHOT Production apply — single scoped P0 SQL file only.
 * DELETE or leave uncommitted after use; do not batch-apply.
 *
 * Gates (both required):
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * Required:
 *   P0_SQL_REL=supabase/pending-prod/p0_01_orders_settlement_columns.sql
 *   EXPECTED_MIGRATION_SHA256=<sha256 of that file>
 *   PRODUCTION_DATABASE_URL or DATABASE_URL (Production ref)
 *
 * Usage example:
 *   $env:ALLOW_PROD_SUPABASE_WRITE='1'
 *   $env:CONFIRM_PROD_WRITE='I_UNDERSTAND_PROD_RISK'
 *   $env:P0_SQL_REL='supabase/pending-prod/p0_01_orders_settlement_columns.sql'
 *   $env:EXPECTED_MIGRATION_SHA256=(Get-FileHash -Algorithm SHA256 $env:P0_SQL_REL).Hash.ToLower()
 *   node scripts/p0-apply-settlement-sql-ONCE.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  loadEnvFiles,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const require = createRequire(import.meta.url);
const pg = require("pg");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(ROOT);
loadEnvFiles(path.resolve(ROOT, "..", "meow-cuijiao-homepage"));

const ALLOWED_RELS = new Set([
  "supabase/pending-prod/p0_01_orders_settlement_columns.sql",
  "supabase/pending-prod/p0_02_transactions_companion_income_uidx.sql",
]);

function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(String(dbUrl || ""));
    const host = (u.hostname || "").toLowerCase();
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    if (host.includes(PRODUCTION_SUPABASE_REF)) return PRODUCTION_SUPABASE_REF;
    return "";
  } catch {
    return "";
  }
}

function assertSqlSafe(sql) {
  const stripped = String(sql || "")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const bad =
    /\b(drop\s+table|drop\s+schema|truncate|delete\s+from|insert\s+into\s+public\.(?!)|update\s+public\.(?!orders\b)|alter\s+table\s+public\.orders\s+drop)/i;
  // Allow only ADD COLUMN / CREATE UNIQUE INDEX / COMMENT / NOTIFY / DO $$ blocks for index
  if (/\bdrop\s+table\b/i.test(stripped) || /\btruncate\b/i.test(stripped) || /\bdelete\s+from\b/i.test(stripped)) {
    throw new Error("SQL safety: DROP TABLE / TRUNCATE / DELETE forbidden");
  }
  if (/\bupdate\s+public\./i.test(stripped)) {
    throw new Error("SQL safety: UPDATE business data forbidden in P0 scoped apply");
  }
  if (/\binsert\s+into\b/i.test(stripped)) {
    throw new Error("SQL safety: INSERT forbidden in P0 scoped apply");
  }
}

async function main() {
  if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1") {
    throw new Error("Refusing: set ALLOW_PROD_SUPABASE_WRITE=1");
  }
  if (process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") {
    throw new Error("Refusing: set CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK");
  }

  const rel = String(process.env.P0_SQL_REL || "").replace(/\\/g, "/").trim();
  if (!ALLOWED_RELS.has(rel)) {
    throw new Error(`Refusing: P0_SQL_REL must be one of ${[...ALLOWED_RELS].join(" | ")}`);
  }
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) throw new Error(`SQL missing: ${full}`);
  const sql = fs.readFileSync(full, "utf8");
  const sha = crypto.createHash("sha256").update(sql).digest("hex");
  const expected = String(process.env.EXPECTED_MIGRATION_SHA256 || "").trim().toLowerCase();
  if (!expected || expected !== sha) {
    throw new Error(`Checksum mismatch: expected ${expected || "(empty)"} got ${sha}`);
  }
  assertSqlSafe(sql);

  const dbUrl = String(
    process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || ""
  ).trim();
  if (!dbUrl) throw new Error("Missing PRODUCTION_DATABASE_URL / DATABASE_URL");
  const ref = projectRefFromDatabaseUrl(dbUrl) || supabaseProjectRef(process.env.SUPABASE_URL || "");
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing: db ref=${ref || "(unknown)"} is not Production`);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // Prechecks
    if (rel.includes("p0_01")) {
      const before = await client.query(`
        select column_name from information_schema.columns
        where table_schema='public' and table_name='orders'
          and column_name in ('platform_fee','companion_income','settlement_status','settlement_note','platform_fee_rate')
        order by 1`);
      console.log("PRECHECK_COLUMNS_BEFORE", before.rows.map((r) => r.column_name));
    }
    if (rel.includes("p0_02")) {
      const dup = await client.query(`
        select order_id, user_id, count(*)::int as n
        from public.transactions
        where transaction_type = 'companion_income'
          and order_id is not null
          and coalesce(status,'') <> 'cancelled'
        group by 1,2 having count(*) > 1`);
      if (dup.rows.length) {
        throw new Error(`Duplicate companion_income rows exist (${dup.rows.length}); refuse unique index`);
      }
      console.log("PRECHECK_DUP_COMPANION_INCOME=0");
      const idx = await client.query(`
        select indexname from pg_indexes
        where schemaname='public' and indexname='transactions_companion_income_order_uidx'`);
      console.log("PRECHECK_INDEX_BEFORE", idx.rows.map((r) => r.indexname));
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
      console.log("APPLY_OK", { rel, sha, otherMigrations: 0 });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("APPLY_ROLLBACK", e.message || e);
      throw e;
    }

    if (rel.includes("p0_01")) {
      const after = await client.query(`
        select column_name from information_schema.columns
        where table_schema='public' and table_name='orders'
          and column_name in ('platform_fee','companion_income','settlement_status','settlement_note','platform_fee_rate')
        order by 1`);
      const names = after.rows.map((r) => r.column_name);
      console.log("POSTCHECK_COLUMNS", names);
      for (const need of [
        "platform_fee",
        "companion_income",
        "settlement_status",
        "settlement_note",
        "platform_fee_rate",
      ]) {
        if (!names.includes(need)) throw new Error(`POSTCHECK missing column ${need}`);
      }
    }
    if (rel.includes("p0_02")) {
      const idx = await client.query(`
        select indexname, indexdef from pg_indexes
        where schemaname='public' and indexname='transactions_companion_income_order_uidx'`);
      if (!idx.rows.length) throw new Error("POSTCHECK unique index missing");
      console.log("POSTCHECK_INDEX", idx.rows[0]);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("APPLY_FAILED", e.message || e);
  process.exit(1);
});
