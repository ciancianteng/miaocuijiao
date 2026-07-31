-- companion_media + related companion admin tables (P0 for avatar/gallery/voice)
-- Safe to re-run. Source: supabase/companion-admin-data.sql

alter table public.companion_profiles add column if not exists tags text not null default '';
alter table public.companion_profiles add column if not exists age integer;
alter table public.companion_profiles add column if not exists gender text not null default '';
alter table public.companion_profiles add column if not exists region text not null default '';
alter table public.companion_profiles add column if not exists contact_phone text not null default '';
alter table public.companion_profiles add column if not exists game_rank text not null default '';
alter table public.companion_profiles add column if not exists position text not null default '';
alter table public.companion_profiles add column if not exists game_id text not null default '';
alter table public.companion_profiles add column if not exists media_status text not null default 'pending';
alter table public.companion_profiles add column if not exists media_reject_reason text not null default '';
alter table public.companion_profiles add column if not exists application_status text not null default 'pending';

create table if not exists public.companion_media (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null references public.companion_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('avatar','gallery','voice')),
  storage_bucket text not null default '',
  storage_path text not null default '',
  content_type text not null default '',
  duration_seconds numeric(10,2),
  status text not null default 'pending',
  reject_reason text not null default '',
  sort_order integer not null default 100,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companion_media_profile_type
  on public.companion_media(companion_profile_id, media_type, sort_order);

alter table public.companion_media enable row level security;

do $$ begin
  create policy "companion_media_self_read" on public.companion_media
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.companion_media to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('companion-gallery', 'companion-gallery', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('companion-audio', 'companion-audio', false, 20971520, array['audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg','audio/x-m4a']),
  ('companion-public', 'companion-public', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
