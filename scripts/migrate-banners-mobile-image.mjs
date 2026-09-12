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
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
  alter table public.banners
    add column if not exists mobile_image_url text
`);
await c.query(`
  alter table public.banners
    add column if not exists mobile_crop_meta jsonb not null default '{}'::jsonb
`);

const cols = await c.query(
  `select column_name, data_type
   from information_schema.columns
   where table_schema='public' and table_name='banners'
   order by 1`
);
const sample = await c.query(
  `select id, left(coalesce(image_url,''),48) as desktop,
          left(coalesce(mobile_image_url,''),48) as mobile
   from public.banners
   order by updated_at desc nulls last
   limit 8`
);
console.log(JSON.stringify({ ok: true, cols: cols.rows, sample: sample.rows }, null, 2));
await c.end();
