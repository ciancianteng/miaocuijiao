-- PENDING PRODUCTION — apply only with explicit human approval, before deploying the
-- "收款渠道收款图片" release. Identical to supabase/migrations/20261005_payment_bank_account_qr.sql.
-- Additive + idempotent; safe to re-run. The private bucket `payment-channel-images`
-- is created on first upload by the API (ensurePrivateBucket).
alter table if exists public.payment_bank_accounts
  add column if not exists qr_image_path text not null default '',
  add column if not exists instructions text not null default '';

notify pgrst, 'reload schema';
