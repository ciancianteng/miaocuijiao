-- Boss wallet recharge: payment proof + review fields on payment_orders
alter table public.payment_orders add column if not exists proof_url text not null default '';
alter table public.payment_orders add column if not exists proof_bucket text not null default '';
alter table public.payment_orders add column if not exists proof_path text not null default '';
alter table public.payment_orders add column if not exists reject_reason text not null default '';
alter table public.payment_orders add column if not exists submitted_at timestamptz;

create index if not exists idx_payment_orders_status_submitted
  on public.payment_orders (status, submitted_at desc);
