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

if (!process.env.DATABASE_URL) {
  console.error("NO DATABASE_URL");
  process.exit(1);
}

const sql = fs.readFileSync("supabase/migrations/20260803_companion_cert_tags.sql", "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query(sql);
  console.log("MIGRATION_OK");
  const tags = await c.query("select id, name, is_enabled from companion_cert_tags order by sort_order");
  console.log("TAGS", tags.rows);
} catch (e) {
  console.error("MIGRATION_FAIL", e.message);
  process.exit(1);
} finally {
  await c.end();
}
