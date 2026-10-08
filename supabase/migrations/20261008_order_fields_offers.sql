-- Backward-compatible optional columns.
-- Runtime already stores order-requirement config in platform_settings.data.serviceOrderFields
-- and companion offers inside companion_profiles.service_standards.__catalogOffers.
-- Apply on Staging only. Do not run against production from automation.

alter table if exists public.services
  add column if not exists order_fields jsonb not null default '[]'::jsonb;

comment on column public.services.order_fields is
  'Optional copy of boss order-requirement fields. Live config is platform_settings.data.serviceOrderFields until this column is backfilled.';
