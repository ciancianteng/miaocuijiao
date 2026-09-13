-- Web Push subscriptions (multi-device per authenticated user).
-- Writes only via service role from /api/push (no direct client RLS access).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'boss',
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  device_label text not null default '',
  status text not null default 'active'
    check (status in ('active', 'disabled', 'expired', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text not null default '',
  unique (endpoint_hash)
);

create index if not exists push_subscriptions_user_status_idx
  on public.push_subscriptions (user_id, status);

create index if not exists push_subscriptions_role_status_idx
  on public.push_subscriptions (role, status);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_deny_all on public.push_subscriptions;
create policy push_subscriptions_deny_all
  on public.push_subscriptions
  for all
  using (false)
  with check (false);

comment on table public.push_subscriptions is
  'Web Push endpoints bound to authenticated user_id. Never share across accounts.';
