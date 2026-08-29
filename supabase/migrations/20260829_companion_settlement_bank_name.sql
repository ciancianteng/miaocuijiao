-- Companion apply: settlement bank selection (银行卡 → bank_name).
-- companion_payment_accounts.bank_name already exists (companion-admin-data.sql).
-- This migration is a no-op safety net for environments that only apply numbered migrations.

alter table public.companion_payment_accounts
  add column if not exists bank_name text not null default '';

comment on column public.companion_payment_accounts.bank_name is
  '开户银行（申请页选择：Maybank / CIMB / Public Bank / …）';
