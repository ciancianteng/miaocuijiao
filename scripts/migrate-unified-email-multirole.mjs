#!/usr/bin/env node
/**
 * Apply unified email / multi-role migration when DATABASE_URL is available.
 * Usage: node scripts/migrate-unified-email-multirole.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
if (!dbUrl) {
  console.error("DATABASE_URL missing — migration file is at supabase/migrations/20260810_unified_email_multirole.sql");
  process.exit(2);
}

const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260810_unified_email_multirole.sql"), "utf8");
const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query(sql);
  const idx = await c.query(
    `select indexname from pg_indexes where schemaname='public' and indexname='profiles_email_normalized_uidx'`
  );
  const col = await c.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='roles'`
  );
  console.log("ok", { index: idx.rows, rolesColumn: col.rows });
} catch (e) {
  console.error("migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
