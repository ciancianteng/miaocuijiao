-- Minimal payment_orders for wallet recharge / callback (safe if already exists)

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  payment_no text not null unique,
  boss_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null default 0,
  cat_food_amount numeric(12,2) not null default 0,
  paid_cat_food numeric(12,2) not null default 0,
  bonus_cat_food numeric(12,2) not null default 0,
  payment_method text not null default '',
  status text not null default 'pending',
  payment_url text not null default '',
  campaign_id uuid,
  credit_idempotency_key text,
  provider_trade_no text not null default '',
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  credited_at timestamptz
);

alter table public.payment_orders add column if not exists paid_cat_food numeric(12,2) not null default 0;
alter table public.payment_orders add column if not exists bonus_cat_food numeric(12,2) not null default 0;
alter table public.payment_orders add column if not exists campaign_id uuid;
alter table public.payment_orders add column if not exists credit_idempotency_key text;
alter table public.payment_orders add column if not exists provider_trade_no text not null default '';
alter table public.payment_orders add column if not exists credited_at timestamptz;

create index if not exists idx_payment_orders_boss_created on public.payment_orders(boss_id, created_at desc);
create index if not exists idx_payment_orders_status_created on public.payment_orders(status, created_at desc);

alter table public.payment_orders enable row level security;

grant select, insert, update, delete on public.payment_orders to service_role;
