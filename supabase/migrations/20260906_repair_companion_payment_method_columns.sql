-- Repair misfiled companion settlement accounts (legacy workbench bug).
-- When method is blank/银行卡, bank_name is empty, and bank_account looks like a
-- Malaysian mobile, move the value into tng_account and set method = TNG Wallet.
-- Safe / idempotent. Does not touch Production unless explicitly applied.

update public.companion_payment_accounts
set
  method = 'TNG Wallet',
  tng_account = coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account),
  payment_phone = coalesce(nullif(payment_phone, ''), nullif(tng_account, ''), bank_account),
  payment_account = coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account),
  bank_account = '',
  bank_name = '',
  alipay_account = '',
  account_last4 = right(
    regexp_replace(
      coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account, ''),
      '\s',
      '',
      'g'
    ),
    4
  ),
  updated_at = now()
where
  coalesce(nullif(method, ''), '银行卡') in ('银行卡', 'bank', 'Bank', 'Bank Transfer')
  and coalesce(bank_name, '') = ''
  and coalesce(tng_account, '') = ''
  and coalesce(alipay_account, '') = ''
  and coalesce(bank_account, '') ~ '^(\+?60|0)?1[0-9]{8,9}$';

-- If method is already TNG Wallet but phone still only lives in bank_account, move it.
update public.companion_payment_accounts
set
  tng_account = coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account),
  payment_phone = coalesce(nullif(payment_phone, ''), nullif(tng_account, ''), bank_account),
  payment_account = coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account),
  bank_account = '',
  bank_name = '',
  alipay_account = '',
  account_last4 = right(
    regexp_replace(
      coalesce(nullif(tng_account, ''), nullif(payment_phone, ''), bank_account, ''),
      '\s',
      '',
      'g'
    ),
    4
  ),
  updated_at = now()
where
  method in ('TNG Wallet', 'TNG', 'tng')
  and coalesce(tng_account, '') = ''
  and coalesce(bank_account, '') <> '';

-- If method is 支付宝 but value only lives in bank_account, move it.
update public.companion_payment_accounts
set
  alipay_account = coalesce(nullif(alipay_account, ''), nullif(payment_account, ''), bank_account),
  payment_account = coalesce(nullif(alipay_account, ''), nullif(payment_account, ''), bank_account),
  bank_account = '',
  bank_name = '',
  tng_account = '',
  payment_phone = '',
  account_last4 = right(
    regexp_replace(
      coalesce(nullif(alipay_account, ''), nullif(payment_account, ''), bank_account, ''),
      '\s',
      '',
      'g'
    ),
    4
  ),
  updated_at = now()
where
  method in ('支付宝', 'Alipay', 'alipay')
  and coalesce(alipay_account, '') = ''
  and coalesce(bank_account, '') <> '';
