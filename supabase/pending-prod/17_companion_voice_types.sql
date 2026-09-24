-- Mirror of migrations/20260804_companion_voice_types.sql for pending-prod apply pipeline.
-- Safe / idempotent. Does not touch companion_profiles.voice_type.

create table if not exists public.companion_voice_types (
  id text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_companion_voice_types_name
  on public.companion_voice_types (lower(name));
create index if not exists idx_companion_voice_types_sort
  on public.companion_voice_types (sort_order, name);

alter table public.companion_voice_types enable row level security;

do $$ begin
  create policy "companion_voice_types_public_read"
    on public.companion_voice_types for select
    using (is_enabled = true);
exception when duplicate_object then null; end $$;

grant select on public.companion_voice_types to anon, authenticated;
grant select, insert, update, delete on public.companion_voice_types to service_role;

insert into public.companion_voice_types (id, name, description, sort_order, is_enabled)
values
  ('voice-tianmei', '甜妹', '甜美可爱', 1, true),
  ('voice-yujie', '御姐', '成熟自信', 2, true),
  ('voice-shaoyu', '少御', '少年御姐感', 3, true),
  ('voice-luoli', '萝莉', '娇软萝莉', 4, true),
  ('voice-wenrou', '温柔', '温柔细腻', 5, true),
  ('voice-qingleng', '清冷', '清冷淡然', 6, true),
  ('voice-yonglan', '慵懒', '慵懒随性', 7, true),
  ('voice-cixing', '磁性', '低沉磁性', 8, true),
  ('voice-shaonian', '少年', '清亮少年', 9, true),
  ('voice-qingshu', '青叔', '青叔稳重', 10, true),
  ('voice-dashu', '大叔', '大叔低沉', 11, true),
  ('voice-other', '其他', '自定义声线', 12, true)
on conflict (id) do nothing;
