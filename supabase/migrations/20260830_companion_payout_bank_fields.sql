-- Companion apply payout bank fields (bank-only settlement form).
-- Keeps legacy method / bank_name / account_name / bank_account for compatibility.

alter table public.companion_payment_accounts
  add column if not exists payout_bank_name text not null default '';

alter table public.companion_payment_accounts
  add column if not exists payout_account_number text not null default '';

alter table public.companion_payment_accounts
  add column if not exists payout_account_holder text not null default '';

comment on column public.companion_payment_accounts.payout_bank_name is
  '结款银行名称（申请页必填）';
comment on column public.companion_payment_accounts.payout_account_number is
  '结款户口号码（申请页必填）';
comment on column public.companion_payment_accounts.payout_account_holder is
  '结款户口持有人姓名（申请页必填）';

-- Backfill from legacy columns when new fields are empty.
update public.companion_payment_accounts
set
  payout_bank_name = coalesce(nullif(payout_bank_name, ''), bank_name, ''),
  payout_account_number = coalesce(nullif(payout_account_number, ''), bank_account, ''),
  payout_account_holder = coalesce(nullif(payout_account_holder, ''), account_name, '')
where
  coalesce(payout_bank_name, '') = ''
  or coalesce(payout_account_number, '') = ''
  or coalesce(payout_account_holder, '') = '';
