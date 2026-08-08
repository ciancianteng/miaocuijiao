-- Companion popularity ranking system
-- Run in Supabase SQL Editor after companion-marketplace.sql

create table if not exists public.popularity_rules (
  id integer primary key default 1 check (id = 1),
  completed_order_points numeric(10,2) not null default 20,
  five_star_points numeric(10,2) not null default 15,
  four_star_points numeric(10,2) not null default 8,
  gift_points_per_10_cat_food numeric(10,2) not null default 1,
  online_hour_points numeric(10,2) not null default 1,
  streak_day_points numeric(10,2) not null default 3,
  favorite_points numeric(10,2) not null default 2,
  cancel_penalty numeric(10,2) not null default 10,
  complaint_penalty numeric(10,2) not null default 30,
  reject_penalty numeric(10,2) not null default 5,
  timeout_penalty numeric(10,2) not null default 3,
  gift_daily_cap_points numeric(10,2) not null default 50,
  display_count integer not null default 10,
  show_score boolean not null default true,
  show_orders boolean not null default true,
  show_gifts boolean not null default true,
  show_online boolean not null default false,
  enable_weekly boolean not null default true,
  enable_monthly boolean not null default true,
  enable_total boolean not null default true,
  enable_daily boolean not null default false,
  enabled boolean not null default true,
  rewards_enabled boolean not null default false,
  reward_top1 numeric(12,2) not null default 100,
  reward_top2 numeric(12,2) not null default 60,
  reward_top3 numeric(12,2) not null default 30,
  updated_at timestamptz not null default now()
);
insert into public.popularity_rules (id) values (1) on conflict (id) do nothing;

create table if not exists public.companion_popularity_stats (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  period_type text not null check (period_type in ('daily','weekly','monthly','total')),
  period_start date not null,
  period_end date not null,
  game_key text not null default '',
  completed_orders integer not null default 0,
  five_star_reviews integer not null default 0,
  four_star_reviews integer not null default 0,
  gift_cat_food numeric(12,2) not null default 0,
  online_minutes integer not null default 0,
  favorites integer not null default 0,
  cancellations integer not null default 0,
  complaints integer not null default 0,
  rejected_orders integer not null default 0,
  timeout_count integer not null default 0,
  streak_days integer not null default 0,
  popularity_score numeric(14,2) not null default 0,
  rank integer not null default 0,
  anomaly_flag boolean not null default false,
  anomaly_note text not null default '',
  updated_at timestamptz not null default now(),
  unique (companion_id, period_type, period_start, game_key)
);
create index if not exists idx_pop_stats_rank
  on public.companion_popularity_stats (period_type, period_start, game_key, popularity_score desc);

create table if not exists public.popularity_history (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  period_type text not null,
  period_start date not null,
  period_end date not null,
  game_key text not null default '',
  final_score numeric(14,2) not null default 0,
  final_rank integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  reward_status text not null default 'none',
  created_at timestamptz not null default now()
);
create index if not exists idx_pop_history_period
  on public.popularity_history (period_type, period_start, game_key, final_rank);

create table if not exists public.popularity_adjustments (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  points numeric(12,2) not null,
  reason text not null,
  operator_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.companion_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  boss_id uuid not null references public.profiles(id),
  companion_id uuid not null references public.profiles(id),
  rating integer not null check (rating between 1 and 5),
  content text not null default '',
  status text not null default 'published',
  created_at timestamptz not null default now()
);
create index if not exists idx_companion_reviews_companion
  on public.companion_reviews (companion_id, created_at desc);

create table if not exists public.companion_favorites (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id),
  companion_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (boss_id, companion_id)
);

create table if not exists public.companion_complaints (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  boss_id uuid references public.profiles(id),
  order_id uuid references public.orders(id),
  reason text not null default '',
  status text not null default 'pending',
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.companion_online_sessions (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'online'
);
create index if not exists idx_online_sessions_companion
  on public.companion_online_sessions (companion_id, started_at desc);

create table if not exists public.popularity_anomaly_logs (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null,
  period_type text not null default '',
  note text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.popularity_reward_records (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null,
  period_type text not null,
  period_start date not null,
  rank integer not null,
  reward_cat_food numeric(12,2) not null default 0,
  status text not null default 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.popularity_rules to service_role;
grant select, insert, update, delete on public.companion_popularity_stats to service_role;
grant select, insert, update, delete on public.popularity_history to service_role;
grant select, insert, update, delete on public.popularity_adjustments to service_role;
grant select, insert, update, delete on public.companion_reviews to service_role;
grant select, insert, update, delete on public.companion_favorites to service_role;
grant select, insert, update, delete on public.companion_complaints to service_role;
grant select, insert, update, delete on public.companion_online_sessions to service_role;
grant select, insert, update, delete on public.popularity_anomaly_logs to service_role;
grant select, insert, update, delete on public.popularity_reward_records to service_role;

notify pgrst, 'reload schema';

-- Optional columns for reject detection / refund clawback
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists note text;
alter table public.gift_transactions add column if not exists refunded_at timestamptz;
