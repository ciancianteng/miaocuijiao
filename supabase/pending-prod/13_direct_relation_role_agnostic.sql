-- Direct relation role-agnostic extension (single SoT: boss_companion_relations).
-- Staging / pending-prod only. Do NOT apply to Production from this PR without explicit ops.
--
-- Semantics (unchanged physical columns):
--   boss_id       = beneficiary (earner / direct referrer)
--   companion_id  = target (invitee)
-- One active relation per target (existing partial unique).
--
-- Earnings:
--   beneficiary_user_id (backfill = boss_id)
--   unique (order_id, beneficiary_user_id) for pending/settled
--   clawback_amount for refund reversal (money fields stay immutable)

-- 1) Document synonym semantics on relations (no structural rename — zero dual-write)
comment on table public.boss_companion_relations is
  'Direct relation SoT (role-agnostic). boss_id=beneficiary, companion_id=target. One active per target.';
comment on column public.boss_companion_relations.boss_id is
  'Direct beneficiary / earner (legacy name boss_id; synonym beneficiary_user_id in app).';
comment on column public.boss_companion_relations.companion_id is
  'Target / invitee account (legacy name companion_id; synonym target_user_id in app).';

-- 2) Earnings: beneficiary column + clawback
alter table public.boss_commission_earnings
  add column if not exists beneficiary_user_id uuid;

alter table public.boss_commission_earnings
  add column if not exists clawback_amount numeric(12,2) not null default 0;

-- Backfill synonym from legacy boss_id
update public.boss_commission_earnings
set beneficiary_user_id = boss_id
where beneficiary_user_id is null
  and boss_id is not null;

comment on column public.boss_commission_earnings.beneficiary_user_id is
  'Channel commission recipient (synonym of boss_id; required for multi-side dedupe).';
comment on column public.boss_commission_earnings.clawback_amount is
  'Cumulative clawed amount after refund; boss_commission_amount stays immutable.';

-- 3) Replace order-only unique with (order_id, beneficiary)
drop index if exists public.uq_boss_commission_earnings_order;
drop index if exists public.uq_boss_commission_earnings_order_id;

create unique index if not exists uq_boss_commission_earnings_order_beneficiary
  on public.boss_commission_earnings (order_id, beneficiary_user_id)
  where (status in ('pending', 'settled') and beneficiary_user_id is not null);

create index if not exists idx_boss_commission_earnings_beneficiary_settled
  on public.boss_commission_earnings (beneficiary_user_id, settled_at desc);
