/**
 * Ensure companion@meow.test can withdraw: identity + deposit + payment account approved.
 * Usage: node scripts/ensure-companion-withdraw-ready.mjs
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

const email = "companion@meow.test";
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const profileRes = await client.query(
  `select id, role, status from public.profiles where lower(email)=lower($1) limit 1`,
  [email]
);
if (!profileRes.rowCount) throw new Error("profile missing");
const userId = profileRes.rows[0].id;
await client.query(`update public.profiles set status='active', role='companion' where id=$1`, [userId]);

const cpRes = await client.query(
  `select id from public.companion_profiles where user_id=$1 limit 1`,
  [userId]
);
if (!cpRes.rowCount) throw new Error("companion_profiles missing");
const cpId = cpRes.rows[0].id;
await client.query(
  `update public.companion_profiles
   set verification_status='approved', application_status='approved',
       media_status=coalesce(nullif(media_status,''),'approved'),
       deposit_status='approved', allow_orders=true, updated_at=now()
   where id=$1`,
  [cpId]
);

await client.query(`
  insert into public.companion_identity_verifications
    (companion_profile_id, user_id, status, real_name, identity_no, reviewed_at, updated_at)
  select $1, $2, 'approved', 'TEST Companion', 'TEST-ID-APPROVED', now(), now()
  where not exists (
    select 1 from public.companion_identity_verifications
    where user_id=$2 or companion_profile_id=$1
  )
`, [cpId, userId]);
await client.query(
  `update public.companion_identity_verifications
   set status='approved', reject_reason='', reviewed_at=now(), updated_at=now()
   where user_id=$1 or companion_profile_id=$2`,
  [userId, cpId]
);

await client.query(`
  insert into public.companion_deposits
    (user_id, companion_profile_id, status, required_amount, paid_amount, reviewed_at, updated_at, created_at)
  select $1, $2, 'approved', 100, 100, now(), now(), now()
  where not exists (
    select 1 from public.companion_deposits where user_id=$1 or companion_profile_id=$2
  )
`, [userId, cpId]).catch(async () => {
  // schema may differ — try minimal columns
  await client.query(`
    update public.companion_deposits set status='approved', updated_at=now()
    where user_id=$1 or companion_profile_id=$2
  `, [userId, cpId]).catch(() => null);
});
await client.query(
  `update public.companion_deposits
   set status='approved', paid_amount=coalesce(paid_amount,100), updated_at=now()
   where user_id=$1 or companion_profile_id=$2`,
  [userId, cpId]
).catch(() => null);

const pay = await client.query(
  `select id from public.companion_payment_accounts
   where user_id=$1 or companion_profile_id=$2
   order by updated_at desc nulls last limit 1`,
  [userId, cpId]
);
let payId = pay.rows[0]?.id || null;
if (!payId) {
  const ins = await client.query(
    `insert into public.companion_payment_accounts
       (user_id, companion_profile_id, status, bank_name, account_name, bank_account, account_last4, method, reviewed_at, updated_at, submitted_at)
     values ($1,$2,'approved','Maybank','TEST Companion','1234567890','7890','bank',now(),now(),now())
     returning id`,
    [userId, cpId]
  );
  payId = ins.rows[0].id;
} else {
  await client.query(
    `update public.companion_payment_accounts
     set status='approved', reject_reason='', reviewed_at=now(), updated_at=now()
     where id=$1`,
    [payId]
  );
}

const check = await client.query(
  `select
     p.status as profile_status,
     cp.verification_status, cp.application_status, cp.deposit_status,
     (select status from companion_identity_verifications where user_id=p.id order by updated_at desc limit 1) as identity,
     (select status from companion_deposits where user_id=p.id order by updated_at desc limit 1) as deposit,
     (select status from companion_payment_accounts where user_id=p.id order by updated_at desc limit 1) as payment,
     (select id from companion_payment_accounts where user_id=p.id and status in ('approved','verified') limit 1) as payment_id
   from profiles p
   join companion_profiles cp on cp.user_id=p.id
   where p.id=$1`,
  [userId]
);
console.log(JSON.stringify({ userId, payId, ...check.rows[0] }, null, 2));
await client.end();
