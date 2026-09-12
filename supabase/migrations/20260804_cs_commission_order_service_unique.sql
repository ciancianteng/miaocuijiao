-- Harden CS commission uniqueness: one settlement per (order_id, service_id).
-- Keep existing order_id unique as primary anti-dupe; add composite for explicit requirement.

create unique index if not exists cs_commission_settlements_order_service_uidx
  on public.cs_commission_settlements (order_id, service_id);

notify pgrst, 'reload schema';
