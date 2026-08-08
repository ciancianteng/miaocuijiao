/**
 * Create public.services (+ categories), seed main games,
 * approve companion@meow.test for real status/grab/withdraw testing.
 * Does not print secrets.
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
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

const MAIN_GAMES = [
  { name: "VALORANT", category: "端游", sort: 1 },
  { name: "三角洲", category: "手游", sort: 2 },
  { name: "APEX", category: "端游", sort: 3 },
  { name: "CS2", category: "端游", sort: 4 },
  { name: "英雄联盟", category: "端游", sort: 5 },
  { name: "王者荣耀", category: "手游", sort: 6 },
  { name: "和平精英", category: "手游", sort: 7 },
  { name: "其他", category: "其他", sort: 8 },
];

function buildPoolerUrl(databaseUrl, supabaseUrl) {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password || "");
  if (!password) throw new Error("DATABASE_URL password missing");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return (
    `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}` +
    `@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
  );
}

async function connectWithFallback() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const attempts = [{ label: "DATABASE_URL", url: databaseUrl }];
  if (supabaseUrl) {
    attempts.push({ label: "pooler-session-ap-southeast-1", url: buildPoolerUrl(databaseUrl, supabaseUrl) });
  }
  let lastErr = null;
  for (const attempt of attempts) {
    const client = new pg.Client({
      connectionString: attempt.url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      console.log("connected via", attempt.label);
      return client;
    } catch (error) {
      lastErr = error;
      console.log("connect failed", attempt.label, error.code || error.message);
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error("Unable to connect to database");
}

async function main() {
  loadEnv();
  const client = await connectWithFallback();

  try {
    const servicesSql = fs.readFileSync(path.join(ROOT, "supabase", "services.sql"), "utf8");
    await client.query(servicesSql);
    console.log("services.sql applied");

    // Seed games (idempotent by name)
    for (const g of MAIN_GAMES) {
      const existing = await client.query(`select id from public.services where name = $1 limit 1`, [g.name]);
      if (existing.rowCount) {
        await client.query(
          `update public.services
           set category = $2, enabled = true, allow_apply = true, allow_order = true,
               show_home = true, sort = $3, updated_at = now(),
               display_positions = '["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb
           where name = $1`,
          [g.name, g.category, g.sort]
        );
      } else {
        await client.query(
          `insert into public.services
             (name, category, icon, default_price, enabled, show_home, allow_apply, allow_order, display_positions, sort)
           values
             ($1, $2, '🎮', '', true, true, true, true,
              '["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb, $3)`,
          [g.name, g.category, g.sort]
        );
      }
    }
    const count = await client.query(`select count(*)::int as n from public.services where enabled = true`);
    console.log("services_enabled", count.rows[0].n);

    // Approve test companion + unlock withdraw prerequisites
    const email = "companion@meow.test";
    const profileRes = await client.query(
      `select id, role, status from public.profiles where lower(email) = lower($1) limit 1`,
      [email]
    );
    if (!profileRes.rowCount) throw new Error(`profile not found: ${email}`);
    const userId = profileRes.rows[0].id;
    console.log("companion_user_id", userId);

    await client.query(
      `update public.profiles set status = 'active' where id = $1`,
      [userId]
    );

    const cpRes = await client.query(
      `select id, verification_status, application_status, online_status
       from public.companion_profiles where user_id = $1 limit 1`,
      [userId]
    );
    if (!cpRes.rowCount) throw new Error("companion_profiles row missing");
    const companionProfileId = cpRes.rows[0].id;

    await client.query(
      `update public.companion_profiles
       set verification_status = 'approved',
           application_status = 'approved',
           media_status = coalesce(nullif(media_status,''), 'approved'),
           allow_orders = true,
           updated_at = now()
       where id = $1`,
      [companionProfileId]
    );
    console.log("companion_verification approved");

    // Identity row (optional for withdraw if verification_status already approved, but keep consistent)
    await client.query(`
      create table if not exists public.companion_identity_verifications (
        id uuid primary key default gen_random_uuid(),
        companion_profile_id uuid,
        user_id uuid,
        status text not null default 'pending',
        reject_reason text not null default '',
        identity_no text not null default '',
        real_name text not null default '',
        reviewed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    const idRows = await client.query(
      `select id from public.companion_identity_verifications
       where user_id = $1 or companion_profile_id = $2
       order by updated_at desc nulls last limit 1`,
      [userId, companionProfileId]
    );
    if (idRows.rowCount) {
      await client.query(
        `update public.companion_identity_verifications
         set status = 'approved', reject_reason = '', reviewed_at = now(), updated_at = now()
         where id = $1`,
        [idRows.rows[0].id]
      );
    } else {
      await client.query(
        `insert into public.companion_identity_verifications
           (companion_profile_id, user_id, status, real_name, identity_no, reviewed_at, updated_at)
         values ($1, $2, 'approved', 'TEST Companion', 'TEST-ID-APPROVED', now(), now())`,
        [companionProfileId, userId]
      );
    }
    console.log("identity approved");

    // Payment account required for withdraw
    await client.query(`
      alter table public.companion_payment_accounts add column if not exists account_last4 text not null default '';
      alter table public.companion_payment_accounts add column if not exists method text not null default '';
      alter table public.companion_payment_accounts add column if not exists tng_account text not null default '';
      alter table public.companion_payment_accounts add column if not exists alipay_account text not null default '';
      alter table public.companion_payment_accounts add column if not exists reject_reason text not null default '';
      alter table public.companion_payment_accounts add column if not exists submitted_at timestamptz not null default now();
    `);
    const payRows = await client.query(
      `select id from public.companion_payment_accounts
       where user_id = $1 or companion_profile_id = $2
       order by submitted_at desc nulls last, updated_at desc nulls last limit 1`,
      [userId, companionProfileId]
    );
    if (payRows.rowCount) {
      await client.query(
        `update public.companion_payment_accounts
         set status = 'approved',
             bank_name = coalesce(nullif(bank_name,''), 'Maybank'),
             account_name = coalesce(nullif(account_name,''), 'TEST Companion'),
             bank_account = coalesce(nullif(bank_account,''), '1234567890'),
             account_last4 = coalesce(nullif(account_last4,''), '7890'),
             method = coalesce(nullif(method,''), 'bank'),
             reject_reason = '',
             reviewed_at = now(),
             updated_at = now()
         where id = $1`,
        [payRows.rows[0].id]
      );
    } else {
      await client.query(
        `insert into public.companion_payment_accounts
           (companion_profile_id, user_id, status, bank_name, account_name, bank_account, account_last4, method, reviewed_at, updated_at)
         values ($1, $2, 'approved', 'Maybank', 'TEST Companion', '1234567890', '7890', 'bank', now(), now())`,
        [companionProfileId, userId]
      );
    }
    console.log("payment_account approved");

    await client.query(`notify pgrst, 'reload schema'`);

    const verify = await client.query(
      `select verification_status, application_status, online_status
       from public.companion_profiles where id = $1`,
      [companionProfileId]
    );
    console.log("verify_row", verify.rows[0]);
    console.log("DONE");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAIL", err.message || err);
  process.exit(1);
});
