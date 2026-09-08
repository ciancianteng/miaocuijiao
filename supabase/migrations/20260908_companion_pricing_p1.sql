-- =============================================================================
-- P1 companion pricing: base_price + companion_services pricing fields
-- Staging apply OK · Production: use pending-prod/11_*.sql after review ONLY
-- Idempotent. Does NOT drop columns. Does NOT modify gameplay_products (#198).
-- =============================================================================

-- 1) companion_levels.base_price = default selling price SoT
alter table public.companion_levels
  add column if not exists base_price numeric(10,2);

comment on column public.companion_levels.base_price is
  'P1: level default selling price SoT. min_price/max_price remain custom-price bounds only.';

update public.companion_levels
set base_price = min_price
where base_price is null;

alter table public.companion_levels
  alter column base_price set default 0;

-- Prefer NOT NULL after backfill; keep nullable-safe if empty table edge case
do $$
begin
  if exists (
    select 1 from public.companion_levels where base_price is null
  ) then
    update public.companion_levels set base_price = coalesce(min_price, 0) where base_price is null;
  end if;
  begin
    alter table public.companion_levels alter column base_price set not null;
  exception when others then
    raise notice 'companion_levels.base_price NOT NULL skipped: %', SQLERRM;
  end;
end $$;

do $$
begin
  alter table public.companion_levels
    add constraint companion_levels_base_price_check
    check (base_price is null or base_price >= 0);
exception when duplicate_object then null;
end $$;

-- 2) companion_services pricing workflow columns
alter table public.companion_services
  add column if not exists base_price_snapshot numeric(12,2),
  add column if not exists proposed_price numeric(12,2),
  add column if not exists proposed_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text not null default '',
  add column if not exists source text not null default 'legacy_import',
  add column if not exists level_id_at_price text not null default '';

comment on column public.companion_services.price is
  'Effective selling price. Never overwrite with pending proposed_price until approved.';
comment on column public.companion_services.proposed_price is
  'Pending custom price (P3). Must NOT affect hall/order/settlement until approved.';
comment on column public.companion_services.source is
  'level_default | admin_set | companion_custom | legacy_import';
comment on column public.companion_services.base_price_snapshot is
  'Level base_price at bind/seed time.';

create index if not exists idx_companion_services_review_pending
  on public.companion_services (review_status, proposed_at desc)
  where proposed_price is not null;

create index if not exists idx_companion_services_companion_enabled
  on public.companion_services (companion_id, enabled, review_status);

-- PostgREST schema cache (safe no-op if not PostgREST)
notify pgrst, 'reload schema';
