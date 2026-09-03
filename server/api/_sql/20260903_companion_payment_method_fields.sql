-- Companion settlement payment fields (PR154 acceptance)
-- Keep method-specific columns (bank_account / tng_account / alipay_account)
-- and add compatible aliases payment_account / payment_phone.
-- Frontend MUST render fields by payment_method — never reuse「银行账号」for all methods.

alter table public.companion_payment_accounts
  add column if not exists payment_account text not null default '';

alter table public.companion_payment_accounts
  add column if not exists payment_phone text not null default '';

comment on column public.companion_payment_accounts.method is
  'Settlement method: 银行卡 / DuitNow / TNG Wallet / 支付宝 (legacy: bank/tng/alipay)';

comment on column public.companion_payment_accounts.payment_account is
  'Generic settlement account mirror (bank_account OR tng_account OR alipay_account)';

comment on column public.companion_payment_accounts.payment_phone is
  'TNG phone (mirrors tng_account when method is TNG Wallet)';

-- Backfill aliases from existing method-specific columns (idempotent)
update public.companion_payment_accounts
set
  payment_account = coalesce(
    nullif(payment_account, ''),
    nullif(bank_account, ''),
    nullif(tng_account, ''),
    nullif(alipay_account, ''),
    ''
  ),
  payment_phone = coalesce(
    nullif(payment_phone, ''),
    nullif(tng_account, ''),
    ''
  )
where
  coalesce(payment_account, '') = ''
  or coalesce(payment_phone, '') = '';
