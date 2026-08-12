-- Ensure orders.updated_at exists so list APIs can sort:
-- updated_at DESC, created_at DESC (latest operated / created first).
alter table public.orders
  add column if not exists updated_at timestamptz;

update public.orders
set updated_at = coalesce(updated_at, paid_at, accepted_at, started_at, completed_at, cancelled_at, created_at, now())
where updated_at is null;

alter table public.orders
  alter column updated_at set default now();

create or replace function public.tg_orders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.tg_orders_set_updated_at();

create index if not exists idx_orders_updated_at_desc
  on public.orders (updated_at desc nulls last, created_at desc);
