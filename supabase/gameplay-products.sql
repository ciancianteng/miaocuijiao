-- More-gameplays mall products (更多玩法商城商品)
-- id is text so slug seeds (gp-*) and UUID ids both work.
create table if not exists public.gameplay_products (
  id text primary key,
  name text not null,
  category text not null default '其他',
  game_ids jsonb not null default '[]'::jsonb,
  games_text text not null default '',
  cover_url text not null default '',
  short_description text not null default '',
  description text not null default '',
  rules text not null default '',
  price numeric(12,2) not null default 0,
  pricing_unit text not null default '每单',
  fixed_price boolean not null default true,
  show_server boolean not null default true,
  packages jsonb not null default '[]'::jsonb,
  status text not null default 'published',
  featured boolean not null default false,
  sold_count integer not null default 0,
  sort_order integer not null default 100,
  dispatch_to_cs boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If an older uuid-id table already exists, widen id to text (best-effort).
do $$ begin
  alter table public.gameplay_products alter column id type text using id::text;
exception when others then null; end $$;

do $$ begin
  alter table public.gameplay_products add column if not exists rules text not null default '';
exception when others then null; end $$;
do $$ begin
  alter table public.gameplay_products add column if not exists show_server boolean not null default true;
exception when others then null; end $$;
do $$ begin
  alter table public.gameplay_products add column if not exists packages jsonb not null default '[]'::jsonb;
exception when others then null; end $$;

create index if not exists idx_gameplay_products_status_sort
  on public.gameplay_products(status, sort_order, updated_at desc);
create index if not exists idx_gameplay_products_category
  on public.gameplay_products(category);
create index if not exists idx_gameplay_products_featured
  on public.gameplay_products(featured, status, sort_order);

alter table public.gameplay_products enable row level security;

drop policy if exists "gameplay_products_public_read" on public.gameplay_products;
create policy "gameplay_products_public_read"
  on public.gameplay_products for select
  using (status = 'published' and deleted_at is null);

drop policy if exists "gameplay_products_admin_all" on public.gameplay_products;
create policy "gameplay_products_admin_all"
  on public.gameplay_products for all
  using (public.mcj_current_role() in ('admin', 'super_admin'))
  with check (public.mcj_current_role() in ('admin', 'super_admin'));

notify pgrst, 'reload schema';
