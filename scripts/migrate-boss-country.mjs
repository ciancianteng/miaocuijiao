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

const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260803_boss_country_phone.sql"), "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);
const cols = await c.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('country_code','phone_e164','phone')`
);
console.log(JSON.stringify(cols.rows, null, 2));
await c.end();
