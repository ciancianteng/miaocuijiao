/**
 * Fix DATABASE_URL to working Supabase pooler, then migrate services + approve companion.
 * Does not print secrets.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function loadEnvFile(filePath) {
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function upsertEnvKey(filePath, key, value) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (k !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, next.join("\n"), "utf8");
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

async function main() {
  const env = loadEnvFile(ENV_PATH);
  const projectRef = new URL(env.SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split(".")[0];
  const old = new URL(env.DATABASE_URL);
  const password = decodeURIComponent(old.password || "");
  if (!password) throw new Error("DATABASE_URL password missing");

  const fixedUrl =
    `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}` +
    `@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;

  upsertEnvKey(ENV_PATH, "DATABASE_URL", fixedUrl);
  upsertEnvKey(ENV_PATH, "DATABASE_URL_MODE", "pooler-session-ap-southeast-1");
  console.log("DATABASE_URL fixed to pooler-session-ap-southeast-1");

  const client = new pg.Client({
    connectionString: fixedUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  console.log("connected");

  try {
    const servicesSql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20260731_services_catalog.sql"), "utf8");
    await client.query(servicesSql);
    console.log("services migration applied");

    for (const g of MAIN_GAMES) {
      const existing = await client.query(`select id from public.services where name = $1 limit 1`, [g.name]);
      if (existing.rowCount) {
        await client.query(
          `update public.services
           set category=$2, enabled=true, allow_apply=true, allow_order=true, show_home=true, sort=$3, updated_at=now(),
               display_positions='["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb
           where name=$1`,
          [g.name, g.category, g.sort]
        );
      } else {
        await client.query(
          `insert into public.services
             (name, category, icon, default_price, enabled, show_home, allow_apply, allow_order, display_positions, sort)
           values ($1,$2,'🎮','',true,true,true,true,
             '["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb,$3)`,
          [g.name, g.category, g.sort]
        );
      }
    }
    const count = await client.query(`select count(*)::int as n from public.services where enabled=true`);
    console.log("services_enabled", count.rows[0].n);

    const email = "companion@meow.test";
    const profileRes = await client.query(
      `select id from public.profiles where lower(email)=lower($1) limit 1`,
      [email]
    );
    if (!profileRes.rowCount) throw new Error("companion profile missing");
    const userId = profileRes.rows[0].id;
    await client.query(`update public.profiles set status='active' where id=$1`, [userId]);

    const cpRes = await client.query(
      `select id from public.companion_profiles where user_id=$1 limit 1`,
      [userId]
    );
    if (!cpRes.rowCount) throw new Error("companion_profiles missing");
    const companionProfileId = cpRes.rows[0].id;

    await client.query(
      `update public.companion_profiles
       set verification_status='approved',
           application_status='approved',
           media_status=coalesce(nullif(media_status,''),'approved'),
           allow_orders=true,
           updated_at=now()
       where id=$1`,
      [companionProfileId]
    );
    console.log("companion_verification approved");

    const idRows = await client.query(
      `select id from public.companion_identity_verifications
       where user_id=$1 or companion_profile_id=$2
       order by updated_at desc nulls last limit 1`,
      [userId, companionProfileId]
    );
    if (idRows.rowCount) {
      await client.query(
        `update public.companion_identity_verifications
         set status='approved', reject_reason='', reviewed_at=now(), updated_at=now()
         where id=$1`,
        [idRows.rows[0].id]
      );
    } else {
      await client.query(
        `insert into public.companion_identity_verifications
           (companion_profile_id, user_id, status, real_name, identity_no, reviewed_at, updated_at)
         values ($1,$2,'approved','TEST Companion','TEST-ID-APPROVED',now(),now())`,
        [companionProfileId, userId]
      );
    }
    console.log("identity approved");

    const payRows = await client.query(
      `select id from public.companion_payment_accounts
       where user_id=$1 or companion_profile_id=$2
       order by submitted_at desc nulls last, updated_at desc nulls last limit 1`,
      [userId, companionProfileId]
    );
    if (payRows.rowCount) {
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
        [payRows.rows[0].id]
      );
    } else {
      await client.query(
        `insert into public.companion_payment_accounts
           (companion_profile_id, user_id, status, bank_name, account_name, bank_account, account_last4, method, reviewed_at, updated_at)
         values ($1,$2,'approved','Maybank','TEST Companion','1234567890','7890','bank',now(),now())`,
        [companionProfileId, userId]
      );
    }
    console.log("payment_account approved");

    await client.query(`notify pgrst, 'reload schema'`);

    const verify = await client.query(
      `select verification_status, application_status from public.companion_profiles where id=$1`,
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
