-- Optional order settlement snapshot columns (safe to re-run)
alter table public.orders add column if not exists settlement_note text not null default '';
alter table public.orders add column if not exists companion_income numeric(12,2);
alter table public.orders add column if not exists platform_fee numeric(12,2);
alter table public.orders add column if not exists settlement_status text not null default '';

notify pgrst, 'reload schema';
