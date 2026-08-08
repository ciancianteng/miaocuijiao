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

async function safe(sql) {
  try {
    return { ok: true, rows: (await c.query(sql)).rows };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

const tables = await safe(`
  select table_name from information_schema.tables
  where table_schema='public'
    and (
      table_name ilike '%banner%'
      or table_name ilike '%recharge%'
      or table_name ilike '%payment%'
      or table_name ilike '%boss%'
      or table_name ilike '%companion%'
      or table_name ilike '%wallet%'
      or table_name ilike '%gameplay%'
      or table_name ilike '%profile%'
      or table_name ilike '%user%'
    )
  order by 1
`);

const bannersCols = await safe(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='banners' order by ordinal_position
`);

const banners = await safe(`select * from public.banners limit 5`);
const campaigns = await safe(`select * from public.recharge_campaigns limit 5`);
const payMethods = await safe(`select * from public.payment_methods limit 5`);
const payChannels = await safe(`select * from public.payment_channels limit 5`);

const out = {
  tables: tables.ok ? tables.rows.map((r) => r.table_name) : tables.err,
  bannersCols: bannersCols.ok ? bannersCols.rows.map((r) => r.column_name) : bannersCols.err,
  banners,
  campaigns,
  payMethods,
  payChannels,
};

fs.writeFileSync(path.join(ROOT, "scripts/inspect-meeting-demo-db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
await c.end();
