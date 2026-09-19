-- P0 companion settlement — orders snapshot columns ONLY (additive).
-- Derived from:
--   supabase/companion-order-settlement.sql
--   supabase/migrations/20260902_boss_commission_from_platform_fee.sql (§2 orders columns)
--   supabase/pending-prod/02_boss_commission_earnings_and_orders_platform_fee.sql (§2)
--
-- ALLOWED: ADD COLUMN IF NOT EXISTS
-- FORBIDDEN in this file: DROP, DELETE, TRUNCATE, UPDATE/INSERT business data,
--   boss_commission_earnings table, platform_settings seed, relation alters.

alter table public.orders add column if not exists platform_fee numeric(12,2);
alter table public.orders add column if not exists companion_income numeric(12,2);
alter table public.orders add column if not exists settlement_status text;
alter table public.orders add column if not exists settlement_note text;
alter table public.orders add column if not exists platform_fee_rate numeric(5,2);

comment on column public.orders.platform_fee is
  'Snapshot: platform fee amount at settlement';
comment on column public.orders.companion_income is
  'Snapshot: companion net income at settlement';
comment on column public.orders.settlement_status is
  'settling | settled | skipped | …';
comment on column public.orders.settlement_note is
  'MCJ_SETTLEMENT JSON snapshot note';
comment on column public.orders.platform_fee_rate is
  'Snapshot: platform fee % of order gross at settlement';

notify pgrst, 'reload schema';
