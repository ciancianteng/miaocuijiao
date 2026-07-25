create extension if not exists "pgcrypto";

create table if not exists public.platform_content_items (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  slug text not null,
  title text not null default '',
  status text not null default 'draft',
  enabled boolean not null default true,
  sort integer not null default 100,
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  version integer not null default 0,
  created_by text,
  updated_by text,
  published_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint platform_content_items_type_slug_unique unique (type, slug)
);

alter table public.platform_content_items
  alter column status set default 'draft';

alter table public.platform_content_items
  drop constraint if exists platform_content_items_status_check;

alter table public.platform_content_items
  add constraint platform_content_items_status_check
  check (status in ('draft','pending','published','unpublished','disabled'));

create index if not exists platform_content_items_type_sort_idx
  on public.platform_content_items (type, sort, updated_at desc);

create index if not exists platform_content_items_published_idx
  on public.platform_content_items (type, enabled, status, sort)
  where status = 'published' and enabled = true;

create table if not exists public.admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  target_type text,
  target_id text,
  operator_role text,
  ip text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_operation_logs_module_time_idx
  on public.admin_operation_logs (module, created_at desc);
