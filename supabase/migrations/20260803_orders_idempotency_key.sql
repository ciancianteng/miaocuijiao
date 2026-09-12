-- Ensure orders.idempotency_key for double-submit guards (P0).
alter table public.orders add column if not exists idempotency_key text;

create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null and btrim(idempotency_key) <> '';

notify pgrst, 'reload schema';
