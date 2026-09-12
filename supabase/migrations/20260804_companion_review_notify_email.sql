-- Optional columns for review notifications + email_pending queue.
-- Safe to re-run.

alter table public.companion_notifications
  add column if not exists notification_type text,
  add column if not exists related_application_id uuid;

create table if not exists public.companion_notification_emails (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  notice_key text not null default '',
  email text not null default '',
  subject text not null default '',
  body text not null default '',
  related_application_id uuid,
  email_status text not null default 'email_pending',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_companion_notification_emails_companion
  on public.companion_notification_emails (companion_id, created_at desc);

alter table public.companion_notification_emails enable row level security;

do $$ begin
  create policy "companion_notification_emails_self_read"
    on public.companion_notification_emails for select
    using (auth.uid() = companion_id);
exception when duplicate_object then null; end $$;

grant select on public.companion_notification_emails to authenticated;
grant all on public.companion_notification_emails to service_role;
