-- Platform services catalog (服务管理)
-- Run this in Supabase SQL Editor before using admin「服务管理」.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '其他',
  icon text not null default '🎮',
  default_price text not null default '',
  enabled boolean not null default true,
  show_home boolean not null default true,
  allow_apply boolean not null default true,
  allow_order boolean not null default true,
  display_positions jsonb not null default '["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.services add column if not exists icon text not null default '🎮';
alter table public.services add column if not exists default_price text not null default '';
alter table public.services add column if not exists display_positions jsonb not null default '["home","gameplay","boss_order","companion_apply","cs_order","companion_profile"]'::jsonb;

create index if not exists idx_services_enabled_sort on public.services(enabled, sort);
create index if not exists idx_services_category on public.services(category);
create index if not exists idx_services_show_home on public.services(show_home, enabled, sort);

alter table public.services enable row level security;

do $$ begin
  create policy "services_public_read_enabled" on public.services for select using (enabled = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "services_admin_all" on public.services for all using (public.mcj_current_role() = 'admin') with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

grant select on public.services to anon, authenticated;
grant all on public.services to service_role;

-- Maintainable categories (not hardcoded in frontend)
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_categories enable row level security;

do $$ begin
  create policy "service_categories_public_read"
    on public.service_categories for select
    using (is_enabled = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "service_categories_admin_all"
    on public.service_categories for all
    using (public.mcj_current_role() = 'admin')
    with check (public.mcj_current_role() = 'admin');
exception when duplicate_object then null; end $$;

grant select on public.service_categories to anon, authenticated;
grant all on public.service_categories to service_role;

insert into public.service_categories (name, sort_order)
values
  ('手游', 1),
  ('端游', 2),
  ('语音', 3),
  ('娱乐', 4),
  ('定制', 5),
  ('其他', 6)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
