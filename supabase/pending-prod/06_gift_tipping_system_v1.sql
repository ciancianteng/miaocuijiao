-- Gift / tipping system V1 (PR179)
-- Safe to re-run. Does not drop data.
-- Extends gifts catalog + permanent companion gift wall + future reward hooks.

-- 1) Catalog metadata for rarity / effect (admin-configurable, not hardcoded)
alter table public.gifts
  add column if not exists rarity text not null default 'common';
alter table public.gifts
  add column if not exists effect_type text not null default 'float';

comment on column public.gifts.rarity is 'common|rare|epic|legendary — display + future achievement hooks';
comment on column public.gifts.effect_type is 'none|float|burst|rain — client animation effect';
comment on column public.gifts.animation_level is 'legacy alias; prefer effect_type for new clients';

-- 2) Permanent companion gift wall (aggregated received gifts)
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

create index if not exists idx_companion_gift_wall_companion
  on public.companion_gift_wall (companion_id, quantity desc);

alter table public.companion_gift_wall enable row level security;
grant select, insert, update, delete on public.companion_gift_wall to service_role;

-- 3) Extensibility stub for future achievement / badge / reward engine
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

create index if not exists idx_reward_events_subject
  on public.reward_events (subject_type, subject_id, created_at desc);
create index if not exists idx_reward_events_type
  on public.reward_events (event_type, created_at desc);

alter table public.reward_events enable row level security;
grant select, insert on public.reward_events to service_role;

comment on table public.reward_events is 'Append-only reward/achievement hook; gift sends emit gift_received events';

notify pgrst, 'reload schema';
