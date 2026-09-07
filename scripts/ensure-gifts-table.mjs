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
  id integer primary key default 1 check (id = 1),
  commission_rate numeric(8,4) not null default 20,
  updated_at timestamptz not null default now()
);

insert into public.gift_settings (id) values (1)
on conflict (id) do nothing;

create index if not exists idx_gifts_sort on public.gifts (sort_order asc, created_at desc);

alter table public.gifts add column if not exists rarity text not null default 'common';
alter table public.gifts add column if not exists effect_type text not null default 'float';

create table if not exists public.companion_gift_wall (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  gift_id uuid references public.gifts(id) on delete set null,
  gift_name text not null default '',
  icon_url text not null default '',
  rarity text not null default 'common',
  effect_type text not null default 'float',
  quantity integer not null default 0 check (quantity >= 0),
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (companion_id, gift_id)
);
create index if not exists idx_companion_gift_wall_companion on public.companion_gift_wall (companion_id, quantity desc);
alter table public.companion_gift_wall enable row level security;
grant select, insert, update, delete on public.companion_gift_wall to service_role;

create table if not exists public.reward_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_id uuid,
  subject_id uuid,
  subject_type text not null default 'companion',
  payload jsonb not null default '{}'::jsonb,
  source_table text not null default '',
  source_id uuid,
  created_at timestamptz not null default now()
);
alter table public.reward_events enable row level security;
grant select, insert on public.reward_events to service_role;

grant select, insert, update, delete on public.gifts to service_role;
grant select, update on public.gift_settings to service_role;
notify pgrst, 'reload schema';
`;

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await client.connect();
try {
  await client.query(sql);
  console.log("OK ensured gifts + gift_wall + reward_events");
} finally {
  await client.end();
}
