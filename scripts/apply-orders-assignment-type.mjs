/**
 * Apply orders.assignment_type migration + dirty-row cleanup.
 * Usage: node scripts/apply-orders-assignment-type.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
for (const name of [".env.local", ".env"]) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) continue;
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

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
if (!dbUrl) {
  console.error("FAIL: DATABASE_URL missing");
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260804_orders_assignment_type.sql"),
  "utf8"
);

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  const cols = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='orders' and column_name='assignment_type'`
  );
  const counts = await client.query(
    `select assignment_type, count(*)::int as n
     from public.orders
     group by assignment_type
     order by assignment_type`
  );
  const dirty = await client.query(
    `select count(*)::int as n from public.orders
     where companion_id is not null and status in ('pending','waiting_boss_confirm')`
  );
  console.log("OK assignment_type present=", cols.rowCount > 0);
  console.log("counts", counts.rows);
  console.log("dirty_hall_with_companion=", dirty.rows[0]?.n ?? -1);
} catch (e) {
  try {
    await client.query("rollback");
  } catch {
    /* ignore */
  }
  console.error("FAIL", e.message || e);
  process.exit(1);
} finally {
  await client.end();
}
