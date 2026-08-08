/**
 * Apply cs_commission_settlements migration via Supabase REST... actually needs SQL.
 * Prefer: node scripts/apply-cs-commission-settlements.mjs
 * Uses DATABASE_URL / SUPABASE_DB_URL like other apply scripts.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();

function loadEnvFile(name) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.vercel.tmp");
loadEnvFile(".env.local");
loadEnvFile(".env");

const sqlPath = path.join(ROOT, "supabase/migrations/20260804_cs_commission_settlements.sql");
const dbUrl =
  process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.DIRECT_URL || "";

if (!dbUrl) {
  console.error("FAIL: DATABASE_URL missing — cannot apply SQL. REST-only selftest can still mock settle if table exists.");
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log("OK: cs_commission_settlements applied");
} finally {
  await client.end();
}
