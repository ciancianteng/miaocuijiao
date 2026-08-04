/**
 * Apply Friday settlement center migrations (additive).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const FILES = [
  "20260804_cs_commission_settlements.sql",
  "20260804_finance_payout_complete.sql",
  "20260804_friday_settlement_center.sql",
];

function loadEnv() {
  for (const name of [".env.local", ".env", ".env.vercel.tmp"]) {
    const envPath = path.join(ROOT, name);
    if (!fs.existsSync(envPath)) continue;
    for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

async function main() {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
  if (!dbUrl) throw new Error("DATABASE_URL missing");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of FILES) {
      const sqlPath = path.join(ROOT, "supabase", "migrations", file);
      const sql = fs.readFileSync(sqlPath, "utf8");
      if (!sql.trim()) {
        console.log("skip_empty=" + file);
        continue;
      }
      console.log("apply=" + file);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
    const check = await client.query(`
      select to_regclass('public.boss_refund_requests') as boss_refund_requests,
             to_regclass('public.settlement_batches') as settlement_batches,
             to_regclass('public.cs_commission_settlements') as cs_commission_settlements,
             to_regclass('public.finance_payout_logs') as finance_payout_logs
    `);
    console.log(check.rows[0]);
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("migration_ok=true");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
