-- Approve companion@meow.test identity + deposit so withdraw works.
-- Safe / re-runnable. Run in Supabase SQL Editor.

update public.companion_identity_verifications i
set status = 'approved',
    reject_reason = '',
    reviewed_at = now(),
    updated_at = now()
from public.profiles p
where p.email = 'companion@meow.test'
  and (i.user_id = p.id);

update public.companion_deposits d
set status = 'approved',
    paid_amount = coalesce(nullif(paid_amount, 0), 100),
    updated_at = now()
from public.profiles p
where p.email = 'companion@meow.test'
  and (d.user_id = p.id);

update public.companion_profiles cp
set verification_status = 'approved',
    application_status = 'approved',
    deposit_status = 'approved',
    allow_orders = true,
    updated_at = now()
from public.profiles p
where p.email = 'companion@meow.test'
  and cp.user_id = p.id;

update public.companion_payment_accounts a
set status = 'approved',
    reject_reason = '',
    reviewed_at = now(),
    updated_at = now()
from public.profiles p
where p.email = 'companion@meow.test'
  and a.user_id = p.id;

-- expect: identity/deposit/payment all approved for companion@meow.test
select
  p.email,
  cp.verification_status,
  cp.deposit_status,
  (select status from companion_identity_verifications where user_id=p.id order by updated_at desc limit 1) as identity,
  (select status from companion_deposits where user_id=p.id order by updated_at desc limit 1) as deposit,
  (select status from companion_payment_accounts where user_id=p.id order by updated_at desc limit 1) as payment
from profiles p
join companion_profiles cp on cp.user_id = p.id
where p.email = 'companion@meow.test';
