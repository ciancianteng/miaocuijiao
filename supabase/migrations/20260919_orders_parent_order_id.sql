-- Multi-companion order group: parent + child rows on public.orders.
-- Additive only. Does NOT use batch_id (settlement/payout batches stay separate).
-- Does NOT apply to Production automatically — repo migration only.
--
-- Semantics:
--   Legacy single-companion: parent_order_id IS NULL, companion_id set — unchanged.
--   Parent (multi_group):    parent_order_id IS NULL, companion_id IS NULL, order_type = 'multi_group'
--   Child:                   parent_order_id = parent.id, companion_id set
--
-- Payment owner = parent. Children hold line amount snapshots only (no second wallet debit).

alter table public.orders
  add column if not exists parent_order_id uuid references public.orders(id) on delete restrict;

create index if not exists idx_orders_parent_order_id
  on public.orders(parent_order_id)
  where parent_order_id is not null;

create index if not exists idx_orders_boss_parent_order
  on public.orders(boss_id, parent_order_id);

comment on column public.orders.parent_order_id is
  'Multi-companion child → parent order id. NULL for legacy singles and multi_group parents.';
