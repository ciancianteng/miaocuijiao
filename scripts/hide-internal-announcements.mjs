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

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const r = await client.query(`
  update public.announcements
  set is_active = false, audience = 'system_internal'
  where title like '%MCJ_CS_DOCK_REWARD_SETTINGS%'
     or content like '%MCJ_CS_DOCK_REWARD_SETTINGS%'
  returning id, title, is_active
`);
console.log("deactivated", r.rows);
await client.query("notify pgrst, 'reload schema'");
await client.end();
