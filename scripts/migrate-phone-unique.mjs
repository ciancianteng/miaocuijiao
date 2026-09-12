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

const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260803_phone_e164_unique.sql"), "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query(sql);
  const idx = await c.query(
    `select indexname from pg_indexes where schemaname='public' and tablename='profiles' and indexname='profiles_phone_e164_unique_idx'`
  );
  console.log("ok", idx.rows);
} catch (e) {
  console.error("migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
