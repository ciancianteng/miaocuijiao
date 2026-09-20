-- P0 companion settlement — companion_income idempotency unique index ONLY.
-- Derived from:
--   supabase/migrations/20260802_security_hardening.sql (transactions block only)
--
-- ALLOWED: CREATE UNIQUE INDEX IF NOT EXISTS (inside existence guard)
-- FORBIDDEN: DROP, DELETE, TRUNCATE, UPDATE/INSERT, unrelated indexes

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) then
    create unique index if not exists transactions_companion_income_order_uidx
      on public.transactions (order_id, user_id)
      where transaction_type = 'companion_income'
        and order_id is not null
        and coalesce(status, '') <> 'cancelled';
  end if;
end $$;

notify pgrst, 'reload schema';
