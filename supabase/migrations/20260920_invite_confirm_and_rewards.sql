-- =============================================================================
-- Invite confirm + attribution + rewards (Phase 1)
-- DRAFT / pending-prod — do NOT apply to Production without explicit approval.
-- =============================================================================
-- SoT for ACTIVE ops relation remains: public.boss_companion_relations (#185)
-- This migration adds:
--   1) invite_attributions (pending → confirmed) — NOT a parallel relation SoT
--   2) invite_reward_ledger (idempotent one-time invite rewards)
--   3) invite_cash_wallets (companion cash invite rewards; pattern from #134 referral_wallets)
--   4) owner_role on boss_invite_links (boss | companion) — same table, no dual link system
--   5) redemption outcomes: pending_confirm / confirmed / rejected
-- Destructive: NO (additive only)
-- Rollback: drop new tables/columns; restore prior redeem path in code; flags remain fail-closed
-- Depends on: boss_invite_links (#185 / 09), boss_companion_relations (01), wallets (mcj_wallet_credit)
-- =============================================================================

-- 1) Invite links: allow companion owners (boss_id column = owner user id)
alter table public.boss_invite_links
  add column if not exists owner_role text not null default 'boss';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'boss_invite_links_owner_role_check'
  ) then
    alter table public.boss_invite_links
      add constraint boss_invite_links_owner_role_check
      check (owner_role in ('boss', 'companion'));
  end if;
end $$;

comment on column public.boss_invite_links.boss_id is
  'Owner user id (legacy name). owner_role=boss|companion.';
comment on column public.boss_invite_links.owner_role is
  'Inviter role snapshot at link creation: boss or companion.';

-- 2) Redemption outcomes: support confirm flow
-- Drop old check by recreating constraint if present (additive outcomes).
alter table public.boss_invite_redemptions
  drop constraint if exists boss_invite_redemptions_outcome_check;

alter table public.boss_invite_redemptions
  add constraint boss_invite_redemptions_outcome_check
  check (outcome in (
    'bound',
    'pending_confirm',
    'confirmed',
    'rejected',
    'skipped_already_bound',
    'skipped_invalid',
    'skipped_not_companion',
    'error'
  ));

-- 3) Pending attribution (invitee must confirm before active relation)
create table if not exists public.invite_attributions (
  id uuid primary key default gen_random_uuid(),
  invite_link_id uuid null references public.boss_invite_links (id) on delete set null,
  invite_code text not null,
  inviter_user_id uuid not null references public.profiles (id) on delete restrict,
  inviter_role text not null check (inviter_role in ('boss', 'companion')),
  invitee_user_id uuid not null references public.profiles (id) on delete restrict,
  invitee_role_at_create text not null default 'unknown'
    check (invitee_role_at_create in ('boss', 'companion', 'user', 'unknown')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'expired', 'superseded')),
  relation_id uuid null references public.boss_companion_relations (id) on delete set null,
  confirmed_at timestamptz null,
  rejected_at timestamptz null,
  reward_granted boolean not null default false,
  reward_ledger_id uuid null,
  detail text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invite_attributions_not_self check (inviter_user_id <> invitee_user_id)
);

create unique index if not exists uq_invite_attributions_pending_invitee
  on public.invite_attributions (invitee_user_id)
  where (status = 'pending');

create unique index if not exists uq_invite_attributions_confirmed_invitee
  on public.invite_attributions (invitee_user_id)
  where (status = 'confirmed');

create index if not exists idx_invite_attributions_inviter
  on public.invite_attributions (inviter_user_id, status, created_at desc);

create index if not exists idx_invite_attributions_code
  on public.invite_attributions (invite_code, created_at desc);

drop trigger if exists trg_invite_attributions_updated_at on public.invite_attributions;
create trigger trg_invite_attributions_updated_at
before update on public.invite_attributions
for each row execute function public.set_updated_at();

alter table public.invite_attributions enable row level security;

-- 4) Append-only attribution events
create table if not exists public.invite_attribution_events (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references public.invite_attributions (id) on delete cascade,
  event_type text not null
    check (event_type in (
      'recognized', 'confirm', 'reject', 'expire', 'supersede',
      'reward_granted', 'reward_skipped', 'blocked_already_bound', 'error'
    )),
  actor_user_id uuid null references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invite_attribution_events_attr
  on public.invite_attribution_events (attribution_id, created_at desc);

alter table public.invite_attribution_events enable row level security;

create or replace function public.forbid_invite_attribution_events_mutate()
returns trigger language plpgsql as $$
begin
  raise exception 'invite_attribution_events is append-only';
end;
$$;

drop trigger if exists trg_iae_no_update on public.invite_attribution_events;
create trigger trg_iae_no_update
before update on public.invite_attribution_events
for each row execute function public.forbid_invite_attribution_events_mutate();

drop trigger if exists trg_iae_no_delete on public.invite_attribution_events;
create trigger trg_iae_no_delete
before delete on public.invite_attribution_events
for each row execute function public.forbid_invite_attribution_events_mutate();

-- 5) Invite reward ledger (one reward per confirmed attribution)
create table if not exists public.invite_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references public.invite_attributions (id) on delete restrict,
  inviter_user_id uuid not null references public.profiles (id) on delete restrict,
  invitee_user_id uuid not null references public.profiles (id) on delete restrict,
  inviter_role text not null check (inviter_role in ('boss', 'companion')),
  reward_type text not null check (reward_type in ('meow_coin', 'cash')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'CATFOOD',
  withdrawable boolean not null default false,
  idempotency_key text not null,
  status text not null default 'granted'
    check (status in ('granted', 'void', 'reversed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_invite_reward_ledger_attribution
  on public.invite_reward_ledger (attribution_id)
  where (status = 'granted');

create unique index if not exists uq_invite_reward_ledger_idempotency
  on public.invite_reward_ledger (idempotency_key);

create index if not exists idx_invite_reward_ledger_inviter
  on public.invite_reward_ledger (inviter_user_id, created_at desc);

alter table public.invite_reward_ledger enable row level security;

create or replace function public.forbid_invite_reward_ledger_mutate()
returns trigger language plpgsql as $$
begin
  raise exception 'invite_reward_ledger is append-only (use status=void/reversed via insert policy in app)';
end;
$$;

-- Allow status transitions only via app inserting reversal rows; block UPDATE/DELETE.
drop trigger if exists trg_irl_no_update on public.invite_reward_ledger;
create trigger trg_irl_no_update
before update on public.invite_reward_ledger
for each row execute function public.forbid_invite_reward_ledger_mutate();

drop trigger if exists trg_irl_no_delete on public.invite_reward_ledger;
create trigger trg_irl_no_delete
before delete on public.invite_reward_ledger
for each row execute function public.forbid_invite_reward_ledger_mutate();

-- 6) Companion cash invite wallet (port pattern from #134 referral_wallets; independent product)
create table if not exists public.invite_cash_wallets (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  available_amount numeric(12,2) not null default 0 check (available_amount >= 0),
  pending_amount numeric(12,2) not null default 0 check (pending_amount >= 0),
  frozen_amount numeric(12,2) not null default 0 check (frozen_amount >= 0),
  total_earned numeric(12,2) not null default 0 check (total_earned >= 0),
  total_withdrawn numeric(12,2) not null default 0 check (total_withdrawn >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.invite_cash_wallets enable row level security;

drop trigger if exists trg_invite_cash_wallets_updated_at on public.invite_cash_wallets;
create trigger trg_invite_cash_wallets_updated_at
before update on public.invite_cash_wallets
for each row execute function public.set_updated_at();

-- 7) Platform settings keys (optional; app also has code defaults)
-- No destructive writes. App reads via platform_settings if present.
