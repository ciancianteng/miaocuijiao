-- Gifts catalog + settings + ledger (idempotent)
-- Prefer native tables; admin API falls back to platform_content_items when absent.

create extension if not exists "pgcrypto";

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text not null default '',
  cat_food_price numeric(12,2) not null check (cat_food_price > 0),
  enabled boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  animation_level text not null default 'normal',
  commission_rate numeric(8,4),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gifts add column if not exists commission_rate numeric(8,4);

create table if not exists public.gift_settings (
  id integer primary key default 1 check (id = 1),
  commission_rate numeric(8,4) not null default 20,
  updated_at timestamptz not null default now()
);
insert into public.gift_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.gift_transactions (
  id uuid primary key default gen_random_uuid(),
  tx_no text not null unique,
  sender_boss_id uuid not null references public.profiles(id),
  receiver_companion_id uuid not null references public.profiles(id),
  gift_id uuid references public.gifts(id),
  gift_name text not null default '',
  quantity integer not null default 1,
  gross_cat_food numeric(12,2) not null,
  platform_commission_rate numeric(8,4) not null default 0,
  platform_commission_amount numeric(12,2) not null default 0,
  companion_income numeric(12,2) not null default 0,
  message text not null default '',
  related_order_id uuid,
  kind text not null default 'gift' check (kind in ('gift', 'tip')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_gifts_enabled_sort on public.gifts (enabled, sort_order)
  where deleted_at is null;
create index if not exists idx_gift_tx_receiver on public.gift_transactions (receiver_companion_id, created_at desc);
create index if not exists idx_gift_tx_sender on public.gift_transactions (sender_boss_id, created_at desc);

alter table public.gifts enable row level security;
alter table public.gift_settings enable row level security;
alter table public.gift_transactions enable row level security;

grant select, insert, update, delete on public.gifts to service_role;
grant select, insert, update, delete on public.gift_settings to service_role;
grant select, insert, update, delete on public.gift_transactions to service_role;

insert into public.gifts (name, icon_url, cat_food_price, featured, sort_order, commission_rate)
select * from (values
  ('小鱼干', '', 5::numeric, true, 10, null::numeric),
  ('猫爪', '', 10::numeric, true, 20, null::numeric),
  ('小蛋糕', '', 30::numeric, true, 30, null::numeric),
  ('皇冠', '', 100::numeric, true, 40, null::numeric),
  ('火箭', '', 500::numeric, false, 50, null::numeric)
) as v(name, icon_url, cat_food_price, featured, sort_order, commission_rate)
where not exists (select 1 from public.gifts limit 1);

notify pgrst, 'reload schema';
