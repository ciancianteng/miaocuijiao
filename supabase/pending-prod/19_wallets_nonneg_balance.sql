-- P0: wallets must never go negative (defense in depth for gift/order debits)
-- Apply on Staging first, then Production (pending-prod).

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'wallets'
  ) then
    -- Refuse apply if any row already negative
    if exists (
      select 1 from public.wallets
      where coalesce(total_balance, 0) < 0
         or coalesce(paid_balance, 0) < 0
         or coalesce(bonus_balance, 0) < 0
    ) then
      raise exception 'wallets has negative balances; fix data before adding CHECK';
    end if;

    begin
      alter table public.wallets
        add constraint wallets_total_balance_nonneg check (coalesce(total_balance, 0) >= 0);
    exception when duplicate_object then null;
    end;

    begin
      alter table public.wallets
        add constraint wallets_paid_balance_nonneg check (coalesce(paid_balance, 0) >= 0);
    exception when duplicate_object then null;
    end;

    begin
      alter table public.wallets
        add constraint wallets_bonus_balance_nonneg check (coalesce(bonus_balance, 0) >= 0);
    exception when duplicate_object then null;
    end;
  end if;
end $$;
