-- More-gameplays mall products (更多玩法商城商品)
create table if not exists public.gameplay_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '其他',
  game_ids jsonb not null default '[]'::jsonb,
  games_text text not null default '',
  cover_url text not null default '',
  short_description text not null default '',
  description text not null default '',
  price numeric(12,2) not null default 0,
  pricing_unit text not null default '每单',
  fixed_price boolean not null default true,
  status text not null default 'published',
  featured boolean not null default false,
  sold_count integer not null default 0,
  sort_order integer not null default 100,
  dispatch_to_cs boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gameplay_products_status_sort
  on public.gameplay_products(status, sort_order, updated_at desc);
create index if not exists idx_gameplay_products_category
  on public.gameplay_products(category);
create index if not exists idx_gameplay_products_featured
  on public.gameplay_products(featured, status, sort_order);

alter table public.gameplay_products enable row level security;

do $$ begin
  create policy "gameplay_products_public_read"
    on public.gameplay_products for select
    using (status = 'published' and deleted_at is null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "gameplay_products_admin_all"
    on public.gameplay_products for all
    using (public.mcj_current_role() = 'admin')
    with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;
