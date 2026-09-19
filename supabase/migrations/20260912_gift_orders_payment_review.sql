-- Gift order payment + CS review + fulfillment (extends gifts / gift_transactions).
-- Approve is the only path that creates a completed gift_transaction for mall orders.

create table if not exists public.gift_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  sender_boss_id uuid not null,
  receiver_companion_id uuid not null,
  gift_id uuid,
  gift_name_snapshot text not null default '',
  gift_image_snapshot text not null default '',
  unit_price numeric(12,2) not null default 0,
  quantity integer not null default 1 check (quantity > 0),
  total_amount numeric(12,2) not null default 0,
  currency text not null default 'MYR',
  status text not null default 'pending_payment'
    check (status in (
      'pending_payment',
      'payment_submitted',
      'under_review',
      'approved',
      'rejected',
      'cancelled'
    )),
  payment_channel text not null default '',
  payment_instructions text not null default '',
  payment_qr_url text not null default '',
  payment_proof_path text not null default '',
  payment_proof_mime text not null default '',
  payment_proof_uploaded_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewed_by_name text not null default '',
  reject_reason text not null default '',
  fulfilled_transaction_id uuid,
  fulfilled_at timestamptz,
  idempotency_key text unique,
  client_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gift_orders_status_created
  on public.gift_orders (status, created_at desc);
create index if not exists idx_gift_orders_sender
  on public.gift_orders (sender_boss_id, created_at desc);
create index if not exists idx_gift_orders_receiver
  on public.gift_orders (receiver_companion_id, created_at desc);

alter table public.gift_transactions
  add column if not exists gift_order_id uuid;
alter table public.gift_transactions
  add column if not exists fulfillment_status text;
alter table public.gift_transactions
  add column if not exists gift_image_url text;

create unique index if not exists uq_gift_tx_order_fulfilled
  on public.gift_transactions (gift_order_id)
  where gift_order_id is not null;

create table if not exists public.companion_gift_wall (
  companion_id uuid not null,
  gift_id uuid,
  gift_name text not null default '',
  gift_image_url text not null default '',
  total_quantity integer not null default 0 check (total_quantity >= 0),
  last_received_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (companion_id, gift_name)
);

create index if not exists idx_companion_gift_wall_qty
  on public.companion_gift_wall (companion_id, total_quantity desc);

alter table public.gift_orders enable row level security;
alter table public.companion_gift_wall enable row level security;

grant select, insert, update, delete on public.gift_orders to service_role;
grant select, insert, update, delete on public.companion_gift_wall to service_role;
grant select on public.gift_orders to authenticated;
grant select on public.companion_gift_wall to authenticated;
grant select on public.companion_gift_wall to anon;
