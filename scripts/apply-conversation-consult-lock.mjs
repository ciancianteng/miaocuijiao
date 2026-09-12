/**
 * Apply conversation consult_type / lock-scope migration.
 * Usage: node scripts/apply-conversation-consult-lock.mjs
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

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlPath = path.join(ROOT, "supabase/migrations/20260804_conversation_consult_lock.sql");
const sql = fs.readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema='public' and table_name='conversations'
      and column_name in ('consult_type','title','customer_service_id','order_id','status')
    order by column_name
  `);
  console.log("ok columns:", cols.rows.map((r) => r.column_name).join(", "));
  const sample = await client.query(`
    select consult_type, count(*)::int as n
    from public.conversations
    group by consult_type
    order by n desc
    limit 10
  `);
  console.log("consult_type counts:", sample.rows);
} finally {
  await client.end();
}
