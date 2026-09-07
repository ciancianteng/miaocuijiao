-- PR180: ensure wallet-pay stamps are persistable on Production orders.
-- Safe to re-run.

alter table public.orders
  add column if not exists paid_at timestamptz;

alter table public.orders
  add column if not exists paid_cat_food numeric(12,2) not null default 0;

comment on column public.orders.paid_at is 'When wallet/CS payment succeeded (not a status enum value)';
comment on column public.orders.paid_cat_food is 'Cat-food amount captured at payment time; links financial audit to order';

create index if not exists idx_orders_paid_at on public.orders (paid_at desc nulls last);

notify pgrst, 'reload schema';
