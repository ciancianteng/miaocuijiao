/**
 * Verify platform_content_items seed rows.
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

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const r = await client.query(`
  select id, type, slug, title, status, enabled, published_at, version
  from public.platform_content_items
  where type in ('player_rules','companion_work_rules','club_level_guide','cs_dock_reward_settings')
  order by type, sort
`);
console.log(JSON.stringify(r.rows, null, 2));
console.log("count", r.rows.length);
await client.end();
