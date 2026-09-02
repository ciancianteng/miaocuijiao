-- Companion referral rebate (inviter Companion ← invited Boss spend)
-- Independent from companion_income, boss_commission_earnings, wallets (猫粮), and user_points.
-- Staging-first. Safe to re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) referral_relations — who invited whom
-- ---------------------------------------------------------------------------
create table if not exists public.referral_relations (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.profiles (id) on delete restrict,
  invited_user_id uuid not null references public.profiles (id) on delete restrict,
  inviter_role text not null default 'companion'
    check (inviter_role in ('companion', 'boss', 'admin')),
  invited_role text not null default 'boss'
    check (invited_role in ('boss', 'companion')),
  relation_type text not null default 'companion_invites_boss'
    check (relation_type in ('companion_invites_boss', 'admin_bind', 'other')),
  referral_code text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'revoked')),
  bound_by_admin boolean not null default false,
  bind_remark text,
  invitation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_relations_not_self check (inviter_user_id <> invited_user_id)
);

create unique index if not exists uq_referral_relations_active_pair
  on public.referral_relations (inviter_user_id, invited_user_id)
  where (status = 'active');

create unique index if not exists uq_referral_relations_active_invited_boss
  on public.referral_relations (invited_user_id)
  where (status = 'active' and invited_role = 'boss' and relation_type = 'companion_invites_boss');

create index if not exists idx_referral_relations_inviter
  on public.referral_relations (inviter_user_id, status);

create index if not exists idx_referral_relations_invited
  on public.referral_relations (invited_user_id, status);

-- ---------------------------------------------------------------------------
-- 2) referral_commission_rules — rates (pair override or global)
-- ---------------------------------------------------------------------------
create table if not exists public.referral_commission_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null default 'default',
  inviter_user_id uuid references public.profiles (id) on delete cascade,
  invited_user_id uuid references public.profiles (id) on delete cascade,
  applicable_player_id uuid,
  applicable_club_id uuid,
  order_rebate_rate numeric(5,2) not null default 5
    check (order_rebate_rate >= 0 and order_rebate_rate <= 100),
  gift_rebate_rate numeric(5,2) not null default 0
    check (gift_rebate_rate >= 0 and gift_rebate_rate <= 100),
  rebate_source text not null default 'PLATFORM_PROFIT'
    check (rebate_source in ('PLATFORM_PROFIT', 'ORDER_AMOUNT', 'COMPANION_INCOME')),
  settlement_cycle text not null default 'on_order_complete',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_referral_rules_status
  on public.referral_commission_rules (status, effective_from desc);

create index if not exists idx_referral_rules_pair
  on public.referral_commission_rules (inviter_user_id, invited_user_id)
  where status = 'active';

-- Seed global default rule (5% of platform profit) if none exists
insert into public.referral_commission_rules (rule_name, order_rebate_rate, gift_rebate_rate, rebate_source, status)
select 'global_default_companion_invites_boss', 5, 0, 'PLATFORM_PROFIT', 'active'
where not exists (
  select 1 from public.referral_commission_rules
  where inviter_user_id is null and invited_user_id is null and status = 'active'
);

-- ---------------------------------------------------------------------------
-- 3) referral_commission_records — immutable settle ledger
-- ---------------------------------------------------------------------------
create table if not exists public.referral_commission_records (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  relation_id uuid references public.referral_relations (id) on delete set null,
  inviter_user_id uuid not null references public.profiles (id) on delete restrict,
  invited_user_id uuid not null references public.profiles (id) on delete restrict,
  invited_player_id uuid,
  commission_type text not null default 'order_rebate'
    check (commission_type in ('order_rebate', 'gift_rebate', 'clawback')),
  base_amount numeric(12,2) not null default 0,
  rebate_rate numeric(5,2) not null default 0,
  rebate_amount numeric(12,2) not null default 0,
  rebate_source text not null default 'PLATFORM_PROFIT',
  status text not null default 'settled'
    check (status in ('pending', 'settled', 'clawed_back', 'void')),
  rule_id uuid references public.referral_commission_rules (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint referral_commission_records_amount_nonneg check (rebate_amount >= 0)
);

-- One settled/pending order rebate per order for a given inviter
create unique index if not exists uq_referral_commission_order_inviter_type
  on public.referral_commission_records (order_id, inviter_user_id, commission_type)
  where status in ('pending', 'settled');

create index if not exists idx_referral_commission_inviter_settled
  on public.referral_commission_records (inviter_user_id, settled_at desc);

create index if not exists idx_referral_commission_invited
  on public.referral_commission_records (invited_user_id, settled_at desc);

-- Forbid money rewrite after settle
create or replace function public.mcj_forbid_referral_commission_rewrite()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('settled', 'clawed_back') then
    if new.base_amount is distinct from old.base_amount
      or new.rebate_rate is distinct from old.rebate_rate
      or new.rebate_amount is distinct from old.rebate_amount
      or new.rebate_source is distinct from old.rebate_source
      or new.order_id is distinct from old.order_id
      or new.inviter_user_id is distinct from old.inviter_user_id
      or new.invited_user_id is distinct from old.invited_user_id
      or new.commission_type is distinct from old.commission_type
    then
      raise exception 'referral_commission_records money/snapshot fields are immutable after settle';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_referral_commission_forbid_rewrite on public.referral_commission_records;
create trigger trg_referral_commission_forbid_rewrite
before update on public.referral_commission_records
for each row execute function public.mcj_forbid_referral_commission_rewrite();

-- ---------------------------------------------------------------------------
-- 4) referral_wallets — Companion rebate balance (separate from companion_income)
-- ---------------------------------------------------------------------------
create table if not exists public.referral_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  pending_amount numeric(12,2) not null default 0 check (pending_amount >= 0),
  available_amount numeric(12,2) not null default 0 check (available_amount >= 0),
  frozen_amount numeric(12,2) not null default 0 check (frozen_amount >= 0),
  total_earned numeric(12,2) not null default 0 check (total_earned >= 0),
  total_withdrawn numeric(12,2) not null default 0 check (total_withdrawn >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.mcj_ensure_referral_wallet(p_user_id uuid)
returns public.referral_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.referral_wallets;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;
  select * into w from public.referral_wallets where user_id = p_user_id for update;
  if found then
    return w;
  end if;
  insert into public.referral_wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select * into w from public.referral_wallets where user_id = p_user_id for update;
  return w;
end;
$$;

create or replace function public.mcj_referral_wallet_credit(
  p_user_id uuid,
  p_amount numeric,
  p_idempotency_key text default null
)
returns public.referral_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.referral_wallets;
begin
  if p_amount is null or p_amount <= 0 then
    return public.mcj_ensure_referral_wallet(p_user_id);
  end if;
  w := public.mcj_ensure_referral_wallet(p_user_id);
  update public.referral_wallets
  set
    available_amount = available_amount + p_amount,
    total_earned = total_earned + p_amount,
    updated_at = now()
  where user_id = p_user_id
  returning * into w;
  return w;
end;
$$;

-- RLS: service role bypasses; authenticated read own wallet / own records
alter table public.referral_relations enable row level security;
alter table public.referral_commission_rules enable row level security;
alter table public.referral_commission_records enable row level security;
alter table public.referral_wallets enable row level security;

drop policy if exists referral_relations_select_own on public.referral_relations;
create policy referral_relations_select_own on public.referral_relations
  for select using (auth.uid() = inviter_user_id or auth.uid() = invited_user_id);

drop policy if exists referral_rules_select_active on public.referral_commission_rules;
create policy referral_rules_select_active on public.referral_commission_rules
  for select using (status = 'active');

drop policy if exists referral_records_select_own on public.referral_commission_records;
create policy referral_records_select_own on public.referral_commission_records
  for select using (auth.uid() = inviter_user_id or auth.uid() = invited_user_id);

drop policy if exists referral_wallets_select_own on public.referral_wallets;
create policy referral_wallets_select_own on public.referral_wallets
  for select using (auth.uid() = user_id);

comment on table public.referral_relations is
  'Companion→Boss referral graph. Independent of boss_companion_relations (直属) and Boss points/wallets.';
comment on table public.referral_commission_records is
  'Immutable Companion referral rebate ledger per paid/completed Boss order.';
comment on table public.referral_wallets is
  'Companion referral rebate balances. Never mixed with companion_income transactions or Boss 猫粮/积分.';

-- ---------------------------------------------------------------------------
-- 5) companion_withdrawals — structured dual-stream allocation (audit)
--    Do NOT rely on remark text for service vs referral amounts.
-- ---------------------------------------------------------------------------
alter table public.companion_withdrawals
  add column if not exists service_income_withdrawn_amount numeric(12,2);

alter table public.companion_withdrawals
  add column if not exists referral_rebate_withdrawn_amount numeric(12,2);

-- Backfill legacy rows: entire cat_food_amount is service income
update public.companion_withdrawals
set
  service_income_withdrawn_amount = coalesce(service_income_withdrawn_amount, cat_food_amount, amount, 0),
  referral_rebate_withdrawn_amount = coalesce(referral_rebate_withdrawn_amount, 0)
where service_income_withdrawn_amount is null
   or referral_rebate_withdrawn_amount is null;

alter table public.companion_withdrawals
  alter column service_income_withdrawn_amount set default 0;

alter table public.companion_withdrawals
  alter column referral_rebate_withdrawn_amount set default 0;

alter table public.companion_withdrawals
  alter column service_income_withdrawn_amount set not null;

alter table public.companion_withdrawals
  alter column referral_rebate_withdrawn_amount set not null;

alter table public.companion_withdrawals
  drop constraint if exists companion_withdrawals_stream_alloc_nonneg;

alter table public.companion_withdrawals
  add constraint companion_withdrawals_stream_alloc_nonneg
  check (
    service_income_withdrawn_amount >= 0
    and referral_rebate_withdrawn_amount >= 0
  );

alter table public.companion_withdrawals
  drop constraint if exists companion_withdrawals_stream_alloc_sum;

alter table public.companion_withdrawals
  add constraint companion_withdrawals_stream_alloc_sum
  check (
    abs(
      (service_income_withdrawn_amount + referral_rebate_withdrawn_amount)
      - coalesce(cat_food_amount, amount, 0)
    ) < 0.011
  );

comment on column public.companion_withdrawals.service_income_withdrawn_amount is
  'Structured allocation: companion_income (service) portion of this withdrawal.';
comment on column public.companion_withdrawals.referral_rebate_withdrawn_amount is
  'Structured allocation: referral rebate portion of this withdrawal (referral_wallets).';
