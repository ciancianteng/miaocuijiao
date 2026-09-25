-- P0: lock revenue SoT to one CS-approved parent payment per order.
-- Idempotent / safe to re-run.

-- 1) payment_transactions: exactly one ledger row per parent order
create unique index if not exists payment_transactions_order_id_uidx
  on public.payment_transactions (order_id);

-- 2) Reject child-order ledgers at DB level when parent_order_id is set on orders
--    (defense in depth; API already blocks CHILD_ORDER_NO_PAYMENT_TX)
create or replace function public.forbid_child_payment_transaction()
returns trigger
language plpgsql
as $$
declare
  parent_id uuid;
begin
  select o.parent_order_id into parent_id
  from public.orders o
  where o.id = new.order_id;
  if parent_id is not null then
    raise exception 'CHILD_ORDER_NO_PAYMENT_TX: child allocation rows cannot create payment_transactions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_forbid_child_payment_transaction on public.payment_transactions;
create trigger trg_forbid_child_payment_transaction
  before insert on public.payment_transactions
  for each row
  execute function public.forbid_child_payment_transaction();

-- 3) At most one *active approved* receipt ledger path is enforced via TX unique;
--    keep one-pending-per-order index (already in 20260804_payment_receipts.sql).

notify pgrst, 'reload schema';
