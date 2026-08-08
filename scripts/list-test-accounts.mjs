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

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const rows = await c.query(`
  select role, email, display_name, status, boss_uid,
    (select companion_code from companion_profiles cp where cp.user_id = profiles.id limit 1) as companion_code
  from profiles
  where email ilike '%@meow.test'
     or email ilike '%mcjtest%'
     or email ilike '%ciancian%'
  order by role, created_at desc
  limit 40
`);
console.log(JSON.stringify(rows.rows, null, 2));
await c.end();
