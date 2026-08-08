-- Store uploaded transfer receipt/screenshot reference on withdraw completion.
-- Admin 打款完成 now requires image/PDF proof upload (see server/api/admin/finance.js mark_withdraw_paid).
-- If this migration has not run yet, the API falls back to writing a note into companion_withdrawals.remark.

alter table public.companion_withdrawals add column if not exists receipt_url text;
alter table public.companion_withdrawals add column if not exists receipt_file_type text;

notify pgrst, 'reload schema';
