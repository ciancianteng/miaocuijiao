-- Pre-launch security hardening (resilient)

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_orders'
  ) then
    create unique index if not exists payment_orders_provider_trade_no_uidx
      on public.payment_orders (provider_trade_no)
      where provider_trade_no is not null and btrim(provider_trade_no) <> '';
  end if;
end $$;

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

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'idempotency_key'
  ) then
    create unique index if not exists orders_idempotency_key_uidx
      on public.orders (idempotency_key)
      where idempotency_key is not null and btrim(idempotency_key) <> '';
  end if;
end $$;

notify pgrst, 'reload schema';
