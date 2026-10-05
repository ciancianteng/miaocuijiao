-- Admin 收款渠道 (payment_bank_accounts): one optional main payment image + boss-facing instructions.
-- qr_image_path stores the object path inside the PRIVATE bucket `payment-channel-images`;
-- the API signs it on every read (no permanent public URL is stored).
alter table if exists public.payment_bank_accounts
  add column if not exists qr_image_path text not null default '',
  add column if not exists instructions text not null default '';

notify pgrst, 'reload schema';
