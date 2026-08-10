/** Apply payment review staff snapshot migration using DATABASE_URL from .env.local. */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260810_payment_review_staff_snapshot.sql");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  if (!fs.existsSync(SQL_PATH)) throw new Error("migration sql missing");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(fs.readFileSync(SQL_PATH, "utf8"));
    await client.query("commit");
    const check = await client.query(`
      select
        to_regclass('public.payment_review_history') as payment_review_history,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='payment_receipts' and column_name='reviewed_by_staff_name'
        ) as receipts_staff_name,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='payment_orders' and column_name='reviewed_by_staff_name'
        ) as orders_staff_name
    `);
    console.log(check.rows[0]);
    console.log("migration_ok=true");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("FAILED", error.message || error);
  process.exit(1);
});
