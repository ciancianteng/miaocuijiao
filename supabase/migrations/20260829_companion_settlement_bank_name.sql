-- Companion apply: settlement bank selection (银行卡 → bank_name).
-- companion_payment_accounts.bank_name already exists (companion-admin-data.sql).
-- This migration is a no-op safety net for environments that only apply numbered migrations.
-- Safe / idempotent: ADD COLUMN IF NOT EXISTS; does not wipe existing application rows.

alter table public.companion_payment_accounts
  add column if not exists bank_name text not null default '';

comment on column public.companion_payment_accounts.bank_name is
  '银行名称（申请页下拉：Maybank / CIMB / … / Other 自定义）';
