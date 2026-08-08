-- Order status change audit log (P0 status machine).
create table if not exists public.order_status_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  operator_role text not null default 'system',
  operator_id uuid,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_order_status_logs_order_created
  on public.order_status_logs(order_id, created_at desc);

alter table public.order_status_logs enable row level security;
