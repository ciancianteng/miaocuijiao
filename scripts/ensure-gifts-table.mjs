/**
 * Ensure public.gifts (+ gift_settings) exist. Requires DATABASE_URL.
 * Usage: DATABASE_URL=... node scripts/ensure-gifts-table.mjs
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

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl || databaseUrl === "[SENSITIVE]") {
  console.error("DATABASE_URL missing — skip gifts DDL apply");
  process.exit(0);
}

const sql = `
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text not null default '',
  cat_food_price numeric(12,2) not null check (cat_food_price > 0),
  enabled boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  animation_level text not null default 'normal',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_settings (
  id integer primary key,
  commission_rate numeric(8,4) not null default 20,
  updated_at timestamptz not null default now()
);

insert into public.gift_settings (id, commission_rate)
values (1, 20)
on conflict (id) do nothing;

create index if not exists idx_gifts_sort on public.gifts (sort_order asc, created_at desc);
`;

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await client.connect();
try {
  await client.query(sql);
  console.log("OK ensured public.gifts + gift_settings");
} finally {
  await client.end();
}
