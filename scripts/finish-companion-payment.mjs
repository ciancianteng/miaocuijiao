import fs from "node:fs";
import pg from "pg";

function loadEnv() {
  const out = {};
  for (const raw of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const userId = "c776e811-6003-48a4-8f11-ed9eb1b70898";
  const cp = (
    await client.query(
      "select id, verification_status, application_status from public.companion_profiles where user_id=$1",
      [userId]
    )
  ).rows[0];
  console.log("companion", cp);

  await client.query(`
    alter table public.companion_payment_accounts add column if not exists account_last4 text not null default '';
    alter table public.companion_payment_accounts add column if not exists method text not null default '';
    alter table public.companion_payment_accounts add column if not exists tng_account text not null default '';
    alter table public.companion_payment_accounts add column if not exists alipay_account text not null default '';
    alter table public.companion_payment_accounts add column if not exists reject_reason text not null default '';
    alter table public.companion_payment_accounts add column if not exists submitted_at timestamptz not null default now();
  `);

  const pay = (
    await client.query(
      "select id, status from public.companion_payment_accounts where user_id=$1 or companion_profile_id=$2 limit 1",
      [userId, cp.id]
    )
  ).rows;

  if (pay[0]) {
    await client.query(
      `update public.companion_payment_accounts
       set status='approved',
           bank_name=coalesce(nullif(bank_name,''),'Maybank'),
           account_name=coalesce(nullif(account_name,''),'TEST Companion'),
           bank_account=coalesce(nullif(bank_account,''),'1234567890'),
           account_last4=coalesce(nullif(account_last4,''),'7890'),
           method=coalesce(nullif(method,''),'bank'),
           reject_reason='',
           reviewed_at=now(),
           updated_at=now()
       where id=$1`,
      [pay[0].id]
    );
  } else {
    await client.query(
      `insert into public.companion_payment_accounts
         (companion_profile_id, user_id, status, bank_name, account_name, bank_account, account_last4, method, reviewed_at, updated_at)
       values ($1,$2,'approved','Maybank','TEST Companion','1234567890','7890','bank',now(),now())`,
      [cp.id, userId]
    );
  }

  await client.query("notify pgrst, 'reload schema'");

  const services = (await client.query("select count(*)::int n from public.services where enabled=true")).rows[0].n;
  const payStatus = (
    await client.query(
      "select status from public.companion_payment_accounts where user_id=$1 or companion_profile_id=$2 limit 1",
      [userId, cp.id]
    )
  ).rows[0]?.status;

  console.log(
    JSON.stringify({
      services,
      verification: cp.verification_status,
      application: cp.application_status,
      payment: payStatus,
    })
  );
  console.log("DONE");
} finally {
  await client.end();
}
