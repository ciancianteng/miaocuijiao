# Order notification redesign — pending DDL (REVIEW ONLY)

**DO NOT APPLY** in the design PR. Staging/Prod apply happens only in implementation PRs (N1+).

See `docs/order-notification-system-redesign.md`.

## N1 — companion_notifications CREATE (fix empty migration)

```sql
create table if not exists public.companion_notifications (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  notice_key text not null,
  category text not null default 'system',
  title text not null default '',
  body text not null default '',
  href text not null default '',
  notification_type text,
  related_application_id uuid,
  order_id uuid,
  created_at timestamptz not null default now(),
  unique (companion_id, notice_key)
);

create index if not exists idx_companion_notifications_companion_created
  on public.companion_notifications (companion_id, created_at desc);
```

## N2 — boss_notifications order fields

```sql
alter table public.boss_notifications
  add column if not exists notice_key text,
  add column if not exists order_id uuid,
  add column if not exists href text not null default '',
  add column if not exists category text not null default 'wallet',
  add column if not exists meta jsonb not null default '{}'::jsonb;

create unique index if not exists boss_notifications_boss_notice_uidx
  on public.boss_notifications (boss_id, notice_key)
  where notice_key is not null and btrim(notice_key) <> '';
```

## N3 — notification_outbox

```sql
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  audience text not null,
  order_id uuid,
  recipient_id uuid not null,
  notice_key text not null,  -- order:{orderId}:{recipientId}:{event}:{version}
  payload jsonb not null default '{}'::jsonb,
  channels text[] not null default '{inbox}',
  status text not null default 'pending',
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notice_key)
);

create index if not exists idx_notification_outbox_poll
  on public.notification_outbox (status, next_retry_at)
  where status in ('pending','failed');
```

## N6 — order_reminder_jobs (prestart idempotent claim)

```sql
create table if not exists public.order_reminder_jobs (
  order_id uuid not null references public.orders(id) on delete cascade,
  reminder_type text not null,
  claimed_at timestamptz not null default now(),
  notice_key text,
  primary key (order_id, reminder_type)
);
```
