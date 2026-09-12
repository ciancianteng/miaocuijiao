-- Manual customer-payment proof and immutable paid ledger. Safe to re-run.
create extension if not exists pgcrypto;

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  boss_id uuid not null references public.profiles(id),
  storage_bucket text not null,
  storage_path text not null,
  payment_method text not null default '',
  amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  version integer not null default 1,
  reject_reason text not null default '',
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_receipts_one_pending_per_order
  on public.payment_receipts(order_id) where status = 'pending';
create index if not exists payment_receipts_pending_uploaded
  on public.payment_receipts(status, uploaded_at desc);
create index if not exists payment_receipts_boss_uploaded
  on public.payment_receipts(boss_id, uploaded_at desc);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  receipt_id uuid references public.payment_receipts(id) on delete set null,
  boss_id uuid not null references public.profiles(id),
  gross_amount numeric(12,2) not null,
  refunded_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null,
  payment_status text not null default 'paid' check (payment_status = 'paid'),
  payment_method text not null default '',
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists payment_transactions_confirmed
  on public.payment_transactions(confirmed_at desc);

grant select, insert, update, delete on public.payment_receipts to service_role;
grant select, insert, update, delete on public.payment_transactions to service_role;
notify pgrst, 'reload schema';
