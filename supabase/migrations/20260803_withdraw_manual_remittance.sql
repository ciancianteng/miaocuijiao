-- Manual remittance fields for companion withdrawals (idempotent).
alter table public.companion_withdrawals add column if not exists bank_reference text;
alter table public.companion_withdrawals add column if not exists payment_remark text;
alter table public.companion_withdrawals add column if not exists receipt_url text;
alter table public.companion_withdrawals add column if not exists receipt_file_type text;

notify pgrst, 'reload schema';
