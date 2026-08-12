#!/usr/bin/env node
/**
 * Ensure popularity ranking tables exist. Requires DATABASE_URL.
 * Usage: DATABASE_URL=... node scripts/ensure-popularity-tables.mjs
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

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl || databaseUrl === "[SENSITIVE]") {
  console.error("DATABASE_URL missing — skip popularity DDL apply");
  process.exit(0);
}

const sqlPath = path.join(ROOT, "supabase", "popularity-ranking.sql");
const sql = fs.readFileSync(sqlPath, "utf8") + "\nnotify pgrst, 'reload schema';\n";

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await client.connect();
try {
  await client.query(sql);
  console.log("OK ensured popularity ranking tables from supabase/popularity-ranking.sql");
} finally {
  await client.end();
}
