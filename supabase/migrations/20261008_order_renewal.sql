-- Boss renewal orders. Additive. Does not rewrite existing order rows.
-- parent_order_id stays the multi-companion link. Renewal uses its own columns.
-- One in-flight renewal per source order. A later renewal is allowed after the previous one finishes.

alter table public.orders
  add column if not exists is_renewal boolean not null default false;

alter table public.orders
  add column if not exists renewal_of_order_id uuid references public.orders(id) on delete restrict;

alter table public.orders
  add column if not exists renewal_source_order_no text not null default '';

create index if not exists idx_orders_renewal_of
  on public.orders (renewal_of_order_id)
  where renewal_of_order_id is not null;

create unique index if not exists idx_orders_one_open_renewal
  on public.orders (renewal_of_order_id)
  where is_renewal = true
    and status in (
      'awaiting_payment',
      'claimed',
      'pending',
      'confirmed',
      'in_progress',
      'waiting_boss_confirm'
    );

comment on column public.orders.renewal_of_order_id is
  'Source order this renewal continues. NULL for ordinary orders. Never parent_order_id.';
comment on column public.orders.renewal_source_order_no is
  'Snapshot of the source order number at renewal create time. The source row is not updated.';

notify pgrst, 'reload schema';
