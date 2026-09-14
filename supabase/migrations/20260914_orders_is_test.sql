-- Optional order-level test flag. Default false.
-- Production APIs reject automated/smoke payloads instead of writing these rows.
-- Staging/Preview may persist is_test=true so stats can exclude them if a write slips through.
-- Do NOT backfill or delete Production orders in this migration.

alter table public.orders
  add column if not exists is_test boolean not null default false;

comment on column public.orders.is_test is
  'When true, order is a smoke/E2E fixture and must be excluded from business stats. Production write paths should refuse these payloads.';

create index if not exists idx_orders_is_test
  on public.orders (is_test)
  where is_test = true;
