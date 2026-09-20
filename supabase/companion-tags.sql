-- Companion tags (ordinary style tags; separate from companion_cert_tags).
-- Idempotent / production-safe:
--   create table if not exists
--   indexes if not exists
--   policy create with duplicate_object guard
--   seed insert on conflict do nothing (never overwrite existing rows)
-- Does NOT drop, truncate, or update existing tag rows.
-- Keep in sync with supabase/migrations/20260915_companion_tags.sql

create table if not exists public.companion_tags (
  id text primary key,
  name text not null,
  tag_group text not null default '风格',
  self_selectable boolean not null default true,
  requires_audit boolean not null default false,
  show_in_hall boolean not null default true,
  supports_filter boolean not null default true,
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_companion_tags_name on public.companion_tags (lower(name));
create index if not exists idx_companion_tags_sort on public.companion_tags(sort_order, name);

alter table public.companion_tags enable row level security;

do $$ begin
  create policy "companion_tags_public_read"
    on public.companion_tags for select
    using (is_enabled = true);
exception when duplicate_object then null; end $$;

grant select on public.companion_tags to anon, authenticated;
grant select, insert, update, delete on public.companion_tags to service_role;

-- Seed matches historical DEFAULT_TAGS used when the table was missing on Production
-- (public /api/platform/content fallback). on conflict do nothing preserves any real rows.
insert into public.companion_tags (id, name, tag_group, sort_order, is_enabled)
values
  ('tag-1', '甜妹', '风格', 1, true),
  ('tag-2', '御姐', '风格', 2, true),
  ('tag-3', '猛男', '风格', 3, true),
  ('tag-4', '幽默', '风格', 4, true),
  ('tag-5', '搞笑', '风格', 5, true),
  ('tag-6', '温柔', '风格', 6, true),
  ('tag-7', '技术', '风格', 7, true),
  ('tag-8', '娱乐', '风格', 8, true),
  ('tag-9', '夜猫子', '风格', 9, true),
  ('tag-10', '连麦', '风格', 10, true)
on conflict (id) do nothing;
