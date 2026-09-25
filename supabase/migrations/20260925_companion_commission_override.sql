-- Per-companion order commission share override (nullable = inherit).
-- Semantics: companion share % of order/allocation amount (e.g. 80 = companion earns 80%).
-- Safe to re-run. Do NOT backfill existing rows — NULL means inherit system/club/level.

alter table public.companion_profiles
  add column if not exists commission_rate_override numeric(5,2);

comment on column public.companion_profiles.commission_rate_override is
  'Nullable companion SHARE % override (0-100). NULL = inherit club then system/level. Does not rewrite settled order snapshots.';

-- Optional order snapshot columns when missing (settlement already writes platform_fee_rate + companion_income).
alter table public.orders
  add column if not exists companion_commission_rate_snapshot numeric(5,2);

alter table public.orders
  add column if not exists companion_commission_amount_snapshot numeric(12,2);

comment on column public.orders.companion_commission_rate_snapshot is
  'Companion share % locked at settlement time.';
comment on column public.orders.companion_commission_amount_snapshot is
  'Companion income amount locked at settlement time.';
