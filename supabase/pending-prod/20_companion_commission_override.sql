-- Mirror of supabase/migrations/20260925_companion_commission_override.sql
-- Owner: run on production when ready.

alter table public.companion_profiles
  add column if not exists commission_rate_override numeric(5,2);

alter table public.orders
  add column if not exists companion_commission_rate_snapshot numeric(5,2);

alter table public.orders
  add column if not exists companion_commission_amount_snapshot numeric(12,2);
