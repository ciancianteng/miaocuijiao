-- Global platform settings (single-row key/value JSON)
create table if not exists public.platform_settings (
  id text primary key default 'global',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.platform_settings enable row level security;

do $$ begin
  create policy "platform_settings_public_read"
    on public.platform_settings for select
    using (true);
exception when duplicate_object then null; end $$;

insert into public.platform_settings (id, data)
values (
  'global',
  '{
    "siteName": "妙脆角",
    "siteNameEn": "Meow Cui Jiao",
    "contactEmail": "",
    "registerOpen": true,
    "allowBossOrder": true,
    "allowCompanionApply": true,
    "allowCustomerServiceLogin": true,
    "maintenanceMode": false,
    "defaultCommissionRate": 20,
    "defaultRebateRate": 0,
    "defaultDeposit": 100,
    "defaultLevel": "Lv1",
    "sessionHours": 168
  }'::jsonb
)
on conflict (id) do nothing;
