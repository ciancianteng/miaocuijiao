/**
 * Apply 20260804_finance_payout_complete.sql (payout logs + staff notifications + wage fields).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260804_finance_payout_complete.sql");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(i > 0 ? 0 : 0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const ref = url ? new URL(url).hostname.split(".")[0] : "missing";
  console.log("project_ref=" + ref);
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    const check = await client.query(`
      select to_regclass('public.finance_payout_logs') as finance_payout_logs,
             to_regclass('public.staff_notifications') as staff_notifications
    `);
    console.log(check.rows[0]);
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("migration_ok=true");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
