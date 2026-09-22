-- =============================================================================
-- P0 GO-LIVE §8–15: gift money trail + withdrawal freeze SoT columns
-- Additive only. Idempotent. Safe to re-run.
-- Do NOT invent parallel gift/withdraw tables — extend existing ones.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) gift_transactions base (from companion-marketplace.sql) if missing
-- ---------------------------------------------------------------------------
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text not null default '',
  cat_food_price numeric(12,2) not null check (cat_food_price > 0),
  enabled boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  animation_level text not null default 'normal',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_transactions (
  id uuid primary key default gen_random_uuid(),
  tx_no text not null unique,
  sender_boss_id uuid not null references public.profiles(id),
  receiver_companion_id uuid not null references public.profiles(id),
  gift_id uuid references public.gifts(id),
  gift_name text not null default '',
  quantity integer not null default 1,
  gross_cat_food numeric(12,2) not null,
  platform_commission_rate numeric(8,4) not null default 0,
  platform_commission_amount numeric(12,2) not null default 0,
  companion_income numeric(12,2) not null default 0,
  message text not null default '',
  related_order_id uuid,
  kind text not null default 'gift' check (kind in ('gift', 'tip')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_gift_tx_receiver
  on public.gift_transactions (receiver_companion_id, created_at desc);
create index if not exists idx_gift_tx_sender
  on public.gift_transactions (sender_boss_id, created_at desc);

create table if not exists public.gift_settings (
  id integer primary key default 1 check (id = 1),
  commission_rate numeric(8,4) not null default 20,
  updated_at timestamptz not null default now()
);
insert into public.gift_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) gift_orders + wall (20260912) if missing
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3) Owner-required gift tracking columns (aliases + audit trail)
-- ---------------------------------------------------------------------------
alter table public.gift_transactions
  add column if not exists gift_order_id uuid;
alter table public.gift_transactions
  add column if not exists fulfillment_status text;
alter table public.gift_transactions
  add column if not exists gift_image_url text;
alter table public.gift_transactions
  add column if not exists unit_price numeric(12,2);
alter table public.gift_transactions
  add column if not exists gross_amount numeric(12,2);
alter table public.gift_transactions
  add column if not exists platform_commission numeric(12,2);
alter table public.gift_transactions
  add column if not exists net_companion_income numeric(12,2);
alter table public.gift_transactions
  add column if not exists payment_method text not null default '';
alter table public.gift_transactions
  add column if not exists payment_status text not null default '';
alter table public.gift_transactions
  add column if not exists approval_status text not null default '';
alter table public.gift_transactions
  add column if not exists approved_by uuid;
alter table public.gift_transactions
  add column if not exists wallet_transaction_id uuid;
alter table public.gift_transactions
  add column if not exists settlement_transaction_id uuid;
alter table public.gift_transactions
  add column if not exists delivered_at timestamptz;

-- Backfill alias columns from existing snapshots (one-shot safe)
update public.gift_transactions
set
  gross_amount = coalesce(gross_amount, gross_cat_food),
  platform_commission = coalesce(platform_commission, platform_commission_amount),
  net_companion_income = coalesce(net_companion_income, companion_income),
  unit_price = coalesce(
    unit_price,
    case when quantity > 0 then round(gross_cat_food / quantity, 2) else gross_cat_food end
  ),
  payment_status = case
    when coalesce(payment_status, '') <> '' then payment_status
    when coalesce(fulfillment_status, '') = 'completed' then 'paid'
    else 'paid'
  end,
  approval_status = case
    when coalesce(approval_status, '') <> '' then approval_status
    when gift_order_id is not null then 'approved'
    else 'auto'
  end,
  delivered_at = coalesce(delivered_at, created_at)
where true;

create unique index if not exists uq_gift_tx_order_fulfilled
  on public.gift_transactions (gift_order_id)
  where gift_order_id is not null;

create index if not exists idx_gift_tx_settlement
  on public.gift_transactions (settlement_transaction_id)
  where settlement_transaction_id is not null;

create index if not exists idx_gift_tx_wallet
  on public.gift_transactions (wallet_transaction_id)
  where wallet_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 4) companion_withdrawals SoT audit columns (freeze model)
-- ---------------------------------------------------------------------------
alter table public.companion_withdrawals
  add column if not exists rejected_by uuid references public.profiles(id);
alter table public.companion_withdrawals
  add column if not exists paid_by uuid references public.profiles(id);
alter table public.companion_withdrawals
  add column if not exists confirmed_by uuid references public.profiles(id);
alter table public.companion_withdrawals
  add column if not exists transaction_id uuid;
alter table public.companion_withdrawals
  add column if not exists freeze_tx_id uuid;
alter table public.companion_withdrawals
  add column if not exists cancelled_at timestamptz;
alter table public.companion_withdrawals
  add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.companion_withdrawals
  add column if not exists cancel_reason text not null default '';

-- Mirror freeze_tx_id ↔ transaction_id
update public.companion_withdrawals
set transaction_id = coalesce(transaction_id, freeze_tx_id)
where freeze_tx_id is not null and transaction_id is null;

update public.companion_withdrawals
set freeze_tx_id = coalesce(freeze_tx_id, transaction_id)
where transaction_id is not null and freeze_tx_id is null;

create index if not exists idx_companion_withdrawals_freeze_tx
  on public.companion_withdrawals (freeze_tx_id)
  where freeze_tx_id is not null;

-- ---------------------------------------------------------------------------
-- 5) Grants + RLS (service_role writes; authenticated read where needed)
-- ---------------------------------------------------------------------------
alter table public.gift_orders enable row level security;
alter table public.companion_gift_wall enable row level security;
alter table public.gift_transactions enable row level security;
alter table public.gifts enable row level security;

grant select, insert, update, delete on public.gift_orders to service_role;
grant select, insert, update, delete on public.companion_gift_wall to service_role;
grant select, insert, update, delete on public.gift_transactions to service_role;
grant select, insert, update, delete on public.gifts to service_role;
grant select, update on public.gift_settings to service_role;
grant select on public.gift_orders to authenticated;
grant select on public.companion_gift_wall to authenticated;
grant select on public.companion_gift_wall to anon;
grant select on public.gifts to authenticated;
grant select on public.gifts to anon;

notify pgrst, 'reload schema';
