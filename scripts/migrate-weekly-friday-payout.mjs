/**
 * Apply 20260804_weekly_friday_payout.sql
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260804_weekly_friday_payout.sql");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
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
      select to_regclass('public.payout_requests') as payout_requests,
             to_regclass('public.payout_source_locks') as payout_source_locks,
             (select count(*) from information_schema.columns
               where table_schema='public' and table_name='finance_settings'
                 and column_name='application_cutoff_time') as has_cutoff,
             (select count(*) from information_schema.columns
               where table_schema='public' and table_name='companion_withdrawals'
                 and column_name='settlement_date') as wd_settle,
             (select count(*) from information_schema.columns
               where table_schema='public' and table_name='staff_payrolls'
                 and column_name='settlement_date') as pay_settle
    `);
    console.log(check.rows[0]);
    const open = await client.query(`
      select 'companion_withdrawals' as t, status, settlement_date::text, count(*)::int as n
      from public.companion_withdrawals
      where status not in ('completed','rejected','cancelled','pay_failed')
      group by 1,2,3
      union all
      select 'staff_payrolls', status, settlement_date::text, count(*)::int
      from public.staff_payrolls
      where status not in ('completed','rejected','cancelled','pay_failed')
      group by 1,2,3
      order by 1,2
    `);
    console.log("open_rows=", JSON.stringify(open.rows));
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
