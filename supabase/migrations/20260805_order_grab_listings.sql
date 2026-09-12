-- Public grab-hall listings: one open row per order_id (idempotent publish).
create extension if not exists pgcrypto;

create table if not exists public.order_grab_listings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id),
  service_name text,
  game text,
  duration text,
  hours numeric,
  amount numeric not null default 0,
  requirements text,
  published_by_cs_id uuid references public.profiles(id),
  published_at timestamptz not null default now(),
  status text not null default 'open',
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists order_grab_listings_status_published_idx
  on public.order_grab_listings (status, published_at desc);

create index if not exists order_grab_listings_cs_idx
  on public.order_grab_listings (published_by_cs_id, published_at desc);

alter table public.order_grab_listings enable row level security;

do $$ begin
  create policy "order_grab_listings_service_all"
    on public.order_grab_listings for all
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.order_grab_listings to service_role;
grant select on public.order_grab_listings to authenticated;

-- Ensure assignment routing column exists for hall filters.
alter table public.orders add column if not exists assignment_type text;
alter table public.orders add column if not exists paid_at timestamptz;

create index if not exists orders_public_hall_idx
  on public.orders (status, assignment_type)
  where companion_id is null;

notify pgrst, 'reload schema';
