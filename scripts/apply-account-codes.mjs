/**
 * Apply account-code migration + report current MCJ/PW state.
 * Usage: node scripts/apply-account-codes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sqlPath = path.join(ROOT, "supabase/migrations/20260803_account_codes_mcj_pw.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  try {
    await client.query(sql);
    console.log("OK applied", sqlPath);
  } catch (e) {
    console.error("FAIL apply", e.message);
    await client.end();
    process.exit(1);
  }

  const bosses = await client.query(
    `select boss_uid, display_name, email, created_at
     from public.profiles
     where role = 'boss' and boss_uid is not null
     order by boss_uid asc
     limit 20`
  );
  const companions = await client.query(
    `select companion_code, companion_uid, nickname, application_status
     from public.companion_profiles
     where companion_code is not null
     order by companion_code asc
     limit 20`
  );
  const admins = await client.query(
    `select id, email, display_name, role, status
     from public.profiles
     where role in ('admin','super_admin')
     order by created_at asc`
  );
  const cs = await client.query(
    `select id, display_name, email, status
     from public.profiles
     where role = 'customer_service'
     order by created_at asc
     limit 20`
  );

  const report = {
    appliedAt: new Date().toISOString(),
    bosses: bosses.rows,
    companions: companions.rows,
    admins: admins.rows,
    customerServices: cs.rows,
    firstBossCode: bosses.rows[0]?.boss_uid || null,
    firstCompanionCode: companions.rows[0]?.companion_code || null,
    adminCount: admins.rows.length,
  };
  fs.writeFileSync(path.join(ROOT, "scripts/account-codes-report.json"), JSON.stringify(report, null, 2));
  console.log("bosses sample", bosses.rows.slice(0, 5));
  console.log("companions sample", companions.rows.slice(0, 5));
  console.log("admins", admins.rows.length, admins.rows.map((a) => a.email));
  console.log("cs names", cs.rows.map((r) => r.display_name || "(empty)"));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
