-- Provider-level Web Push diagnostics.
-- No subscription or business rows are deleted or rewritten.

-- One browser scope has one PushManager endpoint, but different authenticated
-- users can legitimately use that same Android PWA. Keep ownership per user
-- instead of letting the latest login overwrite another account.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_hash_key;

create unique index if not exists push_subscriptions_user_role_endpoint_key
  on public.push_subscriptions (user_id, role, endpoint_hash);

create unique index if not exists push_subscriptions_active_role_endpoint_key
  on public.push_subscriptions (role, endpoint_hash)
  where status = 'active';

alter table public.push_subscriptions
  add column if not exists last_provider_status integer,
  add column if not exists last_provider_response text not null default '',
  add column if not exists last_provider_request_id text not null default '';

alter table public.web_push_delivery_log
  add column if not exists provider_results jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.push_subscriptions.last_provider_status is
  'Latest Web Push provider HTTP status (normally 201; 404/410 means expired endpoint).';
comment on column public.web_push_delivery_log.provider_results is
  'Per-subscription provider outcomes without endpoint or key material.';

notify pgrst, 'reload schema';
