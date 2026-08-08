/**
 * Probe companion withdrawals / payment accounts schema (no secrets printed).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const ref = url ? new URL(url).hostname.split(".")[0] : "missing";
  console.log("project_ref=" + ref);
  console.log("has_database_url=" + !!process.env.DATABASE_URL);

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    const tables = await client.query(
      `select table_name from information_schema.tables
       where table_schema='public'
         and table_name in (
           'companion_withdrawals','companion_payment_accounts','companion_profiles',
           'profiles','transactions','finance_settings'
         )
       order by 1`
    );
    console.log("tables=" + tables.rows.map((r) => r.table_name).join(","));

    const exists = await client.query(`select to_regclass('public.companion_withdrawals') as t`);
    console.log("companion_withdrawals=" + exists.rows[0].t);

    const payCols = await client.query(
      `select column_name, data_type
       from information_schema.columns
       where table_schema='public' and table_name='companion_payment_accounts'
       order by ordinal_position`
    );
    console.log("payment_accounts_cols=");
    for (const r of payCols.rows) console.log(" - " + r.column_name + ":" + r.data_type);

    const prof = await client.query(
      `select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='profiles'
         and column_name in ('id','role','email')`
    );
    console.log("profiles_cols=");
    for (const r of prof.rows) console.log(" - " + r.column_name + ":" + r.data_type);

    const cp = await client.query(
      `select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='companion_profiles'
         and column_name in ('id','user_id')`
    );
    console.log("companion_profiles_cols=");
    for (const r of cp.rows) console.log(" - " + r.column_name + ":" + r.data_type);

    const u = await client.query(
      `select p.id, p.email, p.role
       from public.profiles p
       where lower(p.email)=lower('companion@meow.test')
       limit 1`
    );
    console.log("companion_user=" + JSON.stringify(u.rows[0] || null));
    if (u.rows[0]) {
      const uid = u.rows[0].id;
      const acc = await client.query(
        `select id, user_id, companion_profile_id, bank_name, account_name, bank_account,
                account_last4, status, method
         from public.companion_payment_accounts
         where user_id=$1
            or companion_profile_id in (select id from public.companion_profiles where user_id=$1)
         order by submitted_at desc nulls last
         limit 5`,
        [uid]
      );
      console.log(
        "accounts=" +
          JSON.stringify(
            acc.rows.map((a) => ({
              id: a.id,
              status: a.status,
              bank: a.bank_name,
              holder: a.account_name,
              last4: a.account_last4,
              bank_account_len: String(a.bank_account || "").length,
              method: a.method,
            }))
          )
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
