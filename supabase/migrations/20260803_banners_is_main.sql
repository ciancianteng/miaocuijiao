-- Homepage multi-banner + unique main flag
alter table public.banners add column if not exists is_main boolean not null default false;

-- At most one main banner
create unique index if not exists banners_one_main_idx
  on public.banners (is_main)
  where is_main = true;

-- Helpful listing order
create index if not exists banners_active_sort_idx
  on public.banners (is_active, is_main desc, sort_order asc, updated_at desc);
