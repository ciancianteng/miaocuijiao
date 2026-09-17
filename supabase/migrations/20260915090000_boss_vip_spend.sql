-- Boss VIP = confirmed spend auto-upgrade.
-- Independent from boss_levels (commission / 直属门槛). Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.boss_vip_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spend_threshold numeric(14,2) not null default 0
    check (spend_threshold >= 0),
  benefits text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boss_vip_levels_active_threshold
  on public.boss_vip_levels (is_active, spend_threshold, sort_order);

create table if not exists public.boss_vip_status (
  boss_id uuid primary key references public.profiles(id),
  current_level_id uuid references public.boss_vip_levels(id) on delete set null,
  confirmed_spend numeric(14,2) not null default 0,
  eligible_order_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_boss_vip_status_level
  on public.boss_vip_status (current_level_id);

create table if not exists public.boss_vip_history (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id),
  old_level_id uuid,
  new_level_id uuid,
  old_level_name text not null default '',
  new_level_name text not null default '',
  confirmed_spend numeric(14,2) not null default 0,
  trigger_order_id uuid,
  reason text not null default 'recast',
  created_at timestamptz not null default now()
);

create index if not exists idx_boss_vip_history_boss_created
  on public.boss_vip_history (boss_id, created_at desc);

comment on table public.boss_vip_levels is
  'Boss VIP spend tiers. Thresholds are admin-configured; not commission rates.';
comment on table public.boss_vip_status is
  'Current VIP for each boss. confirmed_spend = CS-confirmed net payment_transactions.';
comment on table public.boss_vip_history is
  'Append-only VIP recast history (upgrade, refund recast, threshold change, backfill).';

alter table public.boss_vip_levels enable row level security;
alter table public.boss_vip_status enable row level security;
alter table public.boss_vip_history enable row level security;

revoke all on public.boss_vip_levels from anon, authenticated;
revoke all on public.boss_vip_status from anon, authenticated;
revoke all on public.boss_vip_history from anon, authenticated;
grant select, insert, update, delete on public.boss_vip_levels to service_role;
grant select, insert, update, delete on public.boss_vip_status to service_role;
grant select, insert, update, delete on public.boss_vip_history to service_role;

-- Seed starter tiers only when the table is empty so admin edits are never overwritten.
insert into public.boss_vip_levels (id, name, spend_threshold, benefits, sort_order, is_active)
select seed.id, seed.name, seed.spend_threshold, seed.benefits, seed.sort_order, true
from (
  values
    ('a1000000-0000-4000-8000-000000000000'::uuid, '普通会员', 0::numeric, '', 0),
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'VIP1', 500::numeric, '专属优惠', 10),
    ('a1000000-0000-4000-8000-000000000002'::uuid, 'VIP2', 1500::numeric, '优先客服', 20),
    ('a1000000-0000-4000-8000-000000000003'::uuid, 'VIP3', 3000::numeric, '专属活动', 30),
    ('a1000000-0000-4000-8000-000000000004'::uuid, 'VIP4', 5000::numeric, '优先抢名额', 40)
) as seed(id, name, spend_threshold, benefits, sort_order)
where not exists (select 1 from public.boss_vip_levels limit 1);

notify pgrst, 'reload schema';
