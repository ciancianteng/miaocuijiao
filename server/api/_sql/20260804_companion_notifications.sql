-- N1 / P0: companion_notifications CREATE (fixes empty migration).
-- Idempotent: safe when table already exists (Staging/Prod).
-- Does NOT drop data. No runtime notify behavior in this migration.

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

-- Existing deployments may have been created without later columns / constraints.
alter table public.companion_notifications
  add column if not exists notification_type text,
  add column if not exists related_application_id uuid,
  add column if not exists order_id uuid,
  add column if not exists href text,
  add column if not exists category text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists created_at timestamptz;

-- Backfill defaults for any newly added nullables that should be non-null in app writes.
update public.companion_notifications set href = coalesce(href, '') where href is null;
update public.companion_notifications set category = coalesce(nullif(btrim(category), ''), 'system') where category is null or btrim(category) = '';
update public.companion_notifications set title = coalesce(title, '') where title is null;
update public.companion_notifications set body = coalesce(body, '') where body is null;
update public.companion_notifications set created_at = coalesce(created_at, now()) where created_at is null;

create index if not exists idx_companion_notifications_companion_created
  on public.companion_notifications (companion_id, created_at desc);

create index if not exists idx_companion_notifications_order_id
  on public.companion_notifications (order_id)
  where order_id is not null;

-- Unique (companion_id, notice_key): table constraint may already exist from CREATE.
-- Also ensure a named unique index for older tables created without the constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companion_notifications'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%companion_id%notice_key%'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'companion_notifications'
      and indexdef ilike '%unique%companion_id%notice_key%'
  ) then
    execute 'create unique index companion_notifications_companion_notice_uidx on public.companion_notifications (companion_id, notice_key)';
  end if;
exception when others then
  -- concurrent create / already exists
  null;
end $$;

comment on table public.companion_notifications is
  'Companion inbox SoT. notice_key unique per companion. N1 storage readiness only.';
