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

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
console.log("hasUrl", Boolean(url));
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const cols = await client.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='profiles' order by ordinal_position`
);
console.log("profiles cols:", cols.rows.map((r) => r.column_name).join(", "));

const hasBoss = cols.rows.some((r) => r.column_name === "boss_uid");
if (!hasBoss) {
  console.log("Applying boss-uid.sql first...");
  const bossSql = fs.readFileSync(path.join(ROOT, "supabase/boss-uid.sql"), "utf8");
  await client.query(bossSql);
}

const mig = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260803_account_codes_mcj_pw.sql"), "utf8");
await client.query(mig);
console.log("Applied account codes migration");

const bosses = await client.query(
  `select boss_uid, display_name, email from public.profiles where role='boss' and boss_uid is not null order by boss_uid asc limit 15`
);
const companions = await client.query(
  `select companion_code, companion_uid, nickname, application_status from public.companion_profiles where companion_code is not null order by companion_code asc limit 15`
).catch(async () => {
  // column may just have been added empty
  return client.query(
    `select companion_code, companion_uid, nickname, application_status from public.companion_profiles order by created_at asc nulls last limit 15`
  );
});
const admins = await client.query(
  `select email, display_name, role::text as role, status from public.profiles where role::text in ('admin','super_admin') order by created_at`
);
const cs = await client.query(
  `select display_name, email, status from public.profiles where role='customer_service' order by created_at limit 20`
);

const report = {
  appliedAt: new Date().toISOString(),
  bosses: bosses.rows,
  companions: companions.rows,
  admins: admins.rows,
  customerServices: cs.rows,
  firstBossCode: bosses.rows[0]?.boss_uid || null,
  firstCompanionCode: companions.rows.find((r) => r.companion_code)?.companion_code || null,
  adminCount: admins.rows.length,
};
fs.writeFileSync(path.join(ROOT, "scripts/account-codes-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await client.end();
