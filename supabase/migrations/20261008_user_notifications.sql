-- Unified unread inbox for PWA badge. Additive only.
-- Service role writes. Clients read through /api/notifications.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_key text not null,
  type text not null default 'system',
  category text not null default 'system',
  entity_type text not null default '',
  entity_id text not null default '',
  title text not null default '',
  body text not null default '',
  url text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, event_key)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_unread_idx
  on public.user_notifications (user_id, created_at desc)
  where is_read = false;

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_deny_all on public.user_notifications;
create policy user_notifications_deny_all
  on public.user_notifications
  for all
  using (false)
  with check (false);

comment on table public.user_notifications is
  'Per-user unread events for the app badge. One row per (user_id, event_key).';

notify pgrst, 'reload schema';
