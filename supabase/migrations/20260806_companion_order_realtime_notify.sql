-- Companion order realtime + email notification log hardening.
-- Safe to re-run.

-- 1) Realtime: companion clients subscribe to own orders (companion_id filter).
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception
    when duplicate_object then null;
  end;
end $$;

alter table public.orders replica identity full;

-- 2) Email notification log columns for admin「邮件通知记录」
alter table public.companion_notification_emails
  add column if not exists mail_type text not null default 'generic',
  add column if not exists order_id uuid,
  add column if not exists order_no text not null default '',
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists notification_key text not null default '';

-- Backfill notification_key from notice_key when empty.
update public.companion_notification_emails
set notification_key = notice_key
where coalesce(nullif(notification_key, ''), '') = ''
  and coalesce(nullif(notice_key, ''), '') <> '';

-- Idempotency: one send per notification_key (or notice_key fallback).
create unique index if not exists companion_notification_emails_notice_key_uidx
  on public.companion_notification_emails (notice_key)
  where notice_key is not null and length(trim(notice_key)) > 0;

create unique index if not exists companion_notification_emails_notification_key_uidx
  on public.companion_notification_emails (notification_key)
  where notification_key is not null and length(trim(notification_key)) > 0;

create index if not exists idx_companion_notification_emails_status_created
  on public.companion_notification_emails (email_status, created_at desc);

create index if not exists idx_companion_notification_emails_order
  on public.companion_notification_emails (order_id, created_at desc);
