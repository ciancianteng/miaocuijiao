-- CS order commission settlements (idempotent per order_id + service_id).
-- Safe to re-run: create if not exists only.

create extension if not exists pgcrypto;

create table if not exists public.cs_commission_settlements (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.profiles(id),
  boss_id uuid references public.profiles(id),
  conversation_id uuid,
  order_id uuid not null,
  order_no text not null default '',
  order_amount numeric(12,2) not null default 0,
  reward_type text not null default 'percent',
  fixed_reward_rm numeric(12,2) not null default 0,
  percent_commission_rm numeric(12,2) not null default 0,
  night_shift_rm numeric(12,2) not null default 0,
  attendance_bonus_rm numeric(12,2) not null default 0,
  clawback_rm numeric(12,2) not null default 0,
  final_amount_rm numeric(12,2) not null default 0,
  commission_percent numeric(8,4) not null default 0,
  config_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'settled', 'clawed_back', 'cancelled', 'consultation_zero')),
  settle_node text not null default '',
  settled_at timestamptz,
  clawed_back_at timestamptz,
  source text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cs_commission_settlements_service
  on public.cs_commission_settlements(service_id, status, settled_at desc);
create index if not exists idx_cs_commission_settlements_order
  on public.cs_commission_settlements(order_id);

create unique index if not exists cs_commission_settlements_order_service_uidx
  on public.cs_commission_settlements (order_id, service_id);

grant select, insert, update, delete on public.cs_commission_settlements to service_role;
grant select on public.cs_commission_settlements to authenticated;

notify pgrst, 'reload schema';
