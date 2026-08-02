-- CS dock success rewards (对接成功猫粮结算)
-- Unique on order_id prevents duplicate settlement for the same order.

create table if not exists public.cs_dock_rewards (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.profiles(id),
  boss_id uuid references public.profiles(id),
  conversation_id uuid references public.conversations(id) on delete set null,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_no text,
  order_amount numeric(12,2) default 0,
  amount_cat_food numeric(12,2) not null check (amount_cat_food >= 0),
  status text not null default 'pending'
    check (status in ('pending','settled','cancelled','clawed_back')),
  settle_node text,
  settled_at timestamptz,
  clawback_at timestamptz,
  clawback_reason text,
  cancel_reason text,
  source text not null default 'auto',
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cs_dock_rewards_order_unique unique (order_id)
);

create index if not exists cs_dock_rewards_service_status_idx
  on public.cs_dock_rewards (service_id, status, settled_at desc);

create index if not exists cs_dock_rewards_status_created_idx
  on public.cs_dock_rewards (status, created_at desc);

create index if not exists cs_dock_rewards_conversation_idx
  on public.cs_dock_rewards (conversation_id);

alter table public.cs_dock_rewards enable row level security;
