-- Companion tags (separate from levels)
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

insert into public.companion_tags (id, name, tag_group, sort_order, is_enabled)
values
  ('tag-1', '随和', '风格', 1, true),
  ('tag-2', '技术流', '风格', 2, true),
  ('tag-3', '话多', '风格', 3, true),
  ('tag-4', '耐心', '风格', 4, true),
  ('tag-5', '幽默', '风格', 5, true),
  ('tag-6', '搞笑', '风格', 6, true),
  ('tag-7', '娱乐', '风格', 7, true),
  ('tag-8', '夜猫子', '风格', 8, true),
  ('tag-9', '连麦', '风格', 9, true),
  ('tag-10', '猛男', '风格', 10, true)
on conflict (id) do nothing;
