-- Payment settings tables for admin Payment Settings module.
-- Boss recharge/payment reads enabled channels + credentials from here.

create table if not exists public.payment_channels (
  id text primary key,
  channel_id text not null unique,
  name text not null default '',
  icon text not null default '',
  payment_type text not null default '',
  category text not null default 'api',
  currencies jsonb not null default '[]'::jsonb,
  config_status text not null default '未配置',
  mode text not null default 'test',
  enabled boolean not null default false,
  visible boolean not null default false,
  sort integer not null default 100,
  data jsonb not null default '{}'::jsonb,
  test_result jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_channel_credentials (
  id text primary key,
  channel_id text not null unique references public.payment_channels(channel_id) on delete cascade,
  credential_status text not null default '未配置',
  credential_keys text[] not null default '{}',
  encrypted_payload text,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_bank_accounts (
  id text primary key,
  bank_name text not null default '',
  account_name text not null default '',
  enterprise_name text not null default '',
  account_number_mask text not null default '',
  encrypted_payload text,
  currency text not null default 'MYR',
  usage text not null default '充值收款',
  is_default boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_exchange_rates (
  id text primary key,
  base_currency text not null default 'MYR',
  target_currency text not null default 'CNY',
  api_rate numeric(18,6) not null default 0,
  manual_rate numeric(18,6) not null default 0,
  auto_update boolean not null default false,
  markup_percent numeric(10,4) not null default 0,
  final_rate numeric(18,6) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_webhooks (
  id text primary key,
  event_name text not null default '',
  webhook_url text not null default '',
  secret_status text not null default '未配置',
  encrypted_secret text,
  enabled boolean not null default false,
  last_status text not null default '未测试',
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id text primary key,
  payment_no text,
  channel_id text,
  boss_id uuid,
  amount numeric(12,2) not null default 0,
  currency text not null default 'MYR',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.payment_operation_logs (
  id text primary key,
  action text not null default '',
  target_id text,
  operator_role text,
  ip text,
  device text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

-- Boss-facing payment method catalog used by /api/recharge
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  is_enabled boolean not null default false,
  sort_order integer not null default 100,
  mode text not null default 'test',
  api_base_url text not null default '',
  merchant_id text not null default '',
  api_key text not null default '',
  api_secret text not null default '',
  callback_secret text not null default '',
  redirect_url text not null default '',
  callback_url text not null default '',
  category text not null default 'api',
  updated_at timestamptz not null default now()
);

alter table public.payment_methods add column if not exists category text not null default 'api';
alter table public.payment_methods add column if not exists mode text not null default 'test';
alter table public.payment_methods add column if not exists api_base_url text not null default '';
alter table public.payment_methods add column if not exists merchant_id text not null default '';
alter table public.payment_methods add column if not exists api_key text not null default '';
alter table public.payment_methods add column if not exists api_secret text not null default '';
alter table public.payment_methods add column if not exists callback_secret text not null default '';
alter table public.payment_methods add column if not exists redirect_url text not null default '';
alter table public.payment_methods add column if not exists callback_url text not null default '';
