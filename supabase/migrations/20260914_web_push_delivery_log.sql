-- Web Push business-event delivery log (idempotency / dedupe).
-- One row per (event_type, order_id, target_user_id) — retries must not re-push.

create table if not exists public.web_push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  event_type text not null,
  order_id text not null default '',
  target_user_id uuid not null,
  title text not null default '',
  body text not null default '',
  click_url text not null default '',
  sent_count int not null default 0,
  failed_count int not null default 0,
  skipped text not null default '',
  created_at timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists web_push_delivery_log_order_idx
  on public.web_push_delivery_log (order_id, event_type);

create index if not exists web_push_delivery_log_user_idx
  on public.web_push_delivery_log (target_user_id, created_at desc);

alter table public.web_push_delivery_log enable row level security;

drop policy if exists web_push_delivery_log_deny_all on public.web_push_delivery_log;
create policy web_push_delivery_log_deny_all
  on public.web_push_delivery_log
  for all
  using (false)
  with check (false);

comment on table public.web_push_delivery_log is
  'Idempotent Web Push delivery claims for business events. Service-role only.';
