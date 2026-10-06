-- PENDING PRODUCTION — p1: create public.payment_bank_accounts (+ qr_image_path / instructions)
--
-- Supersedes p1_payment_bank_account_qr.sql (that ALTER is a no-op on Production,
-- where the table does not exist). Running both is harmless.
--
-- Column set = supabase/migrations/20260731_payment_settings.sql
--            + supabase/migrations/20261005_payment_bank_account_qr.sql
--
-- Additive + idempotent: no DROP / DELETE / UPDATE / type change. Does not touch
-- platform_settings, payment_channels, Storage buckets, or insert any row.
--
-- Run only after explicit approval ("批准 Production migration").
-- Verify afterwards with p1_payment_bank_accounts_verify.sql (read-only).

begin;

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
  updated_at timestamptz not null default now(),
  qr_image_path text not null default '',
  instructions text not null default ''
);

-- If the table already existed with fewer columns, add only what is missing.
alter table public.payment_bank_accounts
  add column if not exists bank_name text not null default '',
  add column if not exists account_name text not null default '',
  add column if not exists enterprise_name text not null default '',
  add column if not exists account_number_mask text not null default '',
  add column if not exists encrypted_payload text,
  add column if not exists currency text not null default 'MYR',
  add column if not exists usage text not null default '充值收款',
  add column if not exists is_default boolean not null default false,
  add column if not exists enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists qr_image_path text not null default '',
  add column if not exists instructions text not null default '';

-- Server code reaches this table only with SUPABASE_SERVICE_ROLE_KEY.
grant select, insert, update, delete on public.payment_bank_accounts to service_role;

-- Holds account names + encrypted account numbers: keep it off the anon/authenticated
-- PostgREST surface. No policies on purpose; service_role bypasses RLS.
alter table public.payment_bank_accounts enable row level security;

commit;

notify pgrst, 'reload schema';
