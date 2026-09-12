-- Companion marketplace: availability, public IDs, services, gifts, order extras.
-- Run in Supabase SQL Editor.

-- 1) Availability + public companion UID
alter table public.companion_profiles
  add column if not exists availability_status text not null default 'offline',
  add column if not exists last_online_at timestamptz,
  add column if not exists status_updated_at timestamptz,
  add column if not exists companion_uid bigint,
  add column if not exists pricing_unit text not null default '小时',
  add column if not exists tags text not null default '';

update public.companion_profiles
set availability_status = case
  when online_status = 'online' then 'online'
  when online_status = 'busy' then 'busy'
  when online_status = 'paused' then 'paused'
  else 'offline'
end
where coalesce(availability_status, '') in ('', 'offline') and online_status is not null;

create sequence if not exists public.companion_uid_seq start with 100001 increment by 1;
update public.companion_profiles
set companion_uid = nextval('public.companion_uid_seq')
where companion_uid is null;
create unique index if not exists companion_profiles_companion_uid_uidx
  on public.companion_profiles (companion_uid);

create or replace function public.mcj_assign_companion_uid()
returns trigger language plpgsql as $$
begin
  if new.companion_uid is null then
    new.companion_uid := nextval('public.companion_uid_seq');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_companion_uid on public.companion_profiles;
create trigger trg_companion_uid
before insert on public.companion_profiles
for each row execute function public.mcj_assign_companion_uid();

-- 2) Per-companion services
create table if not exists public.companion_services (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  service_id uuid,
  service_name text not null default '',
  price numeric(12,2) not null default 0,
  pricing_unit text not null default '小时',
  specs jsonb not null default '[]'::jsonb,
  requires_game_id boolean not null default true,
  custom_fields jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  review_status text not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_companion_services_companion
  on public.companion_services (companion_id, enabled);

-- 3) Order extras (nullable columns for direct companion checkout)
alter table public.orders
  add column if not exists service_id uuid,
  add column if not exists service_name text not null default '',
  add column if not exists quantity numeric(12,2) not null default 1,
  add column if not exists pricing_unit text not null default '',
  add column if not exists game_id_value text not null default '',
  add column if not exists server_name text not null default '',
  add column if not exists rank_name text not null default '',
  add column if not exists contact_info text not null default '',
  add column if not exists scheduled_at timestamptz,
  add column if not exists start_now boolean not null default false,
  add column if not exists notes text not null default '',
  add column if not exists special_requests text not null default '',
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists paid_cat_food numeric(12,2) not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists price_snapshot jsonb not null default '{}'::jsonb;

create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null and idempotency_key <> '';

-- Prefer claimed = paid waiting companion confirm for direct orders
-- (existing enum; no ALTER TYPE required)

-- 4) Gifts catalog
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

insert into public.gifts (name, icon_url, cat_food_price, featured, sort_order)
select * from (values
  ('小鱼干', '', 5::numeric, true, 10),
  ('猫爪', '', 10::numeric, true, 20),
  ('小蛋糕', '', 30::numeric, true, 30),
  ('皇冠', '', 100::numeric, true, 40),
  ('火箭', '', 500::numeric, false, 50)
) as v(name, icon_url, cat_food_price, featured, sort_order)
where not exists (select 1 from public.gifts limit 1);

-- 5) Gift / tip transactions (immutable snapshot)
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
  related_order_id uuid references public.orders(id),
  kind text not null default 'gift' check (kind in ('gift', 'tip')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_gift_tx_receiver on public.gift_transactions (receiver_companion_id, created_at desc);
create index if not exists idx_gift_tx_sender on public.gift_transactions (sender_boss_id, created_at desc);

-- 6) Platform gift commission default in platform_settings is app-level; store fallback here
create table if not exists public.gift_settings (
  id integer primary key default 1 check (id = 1),
  commission_rate numeric(8,4) not null default 20,
  updated_at timestamptz not null default now()
);
insert into public.gift_settings (id) values (1) on conflict (id) do nothing;

alter table public.companion_services enable row level security;
alter table public.gifts enable row level security;
alter table public.gift_transactions enable row level security;
alter table public.gift_settings enable row level security;

grant select, insert, update, delete on public.companion_services to service_role;
grant select, insert, update, delete on public.gifts to service_role;
grant select, insert, update, delete on public.gift_transactions to service_role;
grant select, update on public.gift_settings to service_role;

notify pgrst, 'reload schema';
