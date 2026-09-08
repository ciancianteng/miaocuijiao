-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY TO PRODUCTION IN THIS PR
-- P1 companion pricing: companion_levels.base_price + companion_services fields
-- Staging must PASS first. Never silent-strip missing columns in app code.
-- Related: docs/pricing-p1-migration-plan.md · PR pricing-p1
-- Does NOT touch gameplay_products / PR #198.
-- =============================================================================

alter table public.companion_levels
  add column if not exists base_price numeric(10,2);

comment on column public.companion_levels.base_price is
  'Level default selling price SoT. min_price/max_price are custom bounds only.';

update public.companion_levels
set base_price = min_price
where base_price is null;

alter table public.companion_levels
  alter column base_price set default 0;

do $$
begin
  update public.companion_levels set base_price = coalesce(min_price, 0) where base_price is null;
  begin
    alter table public.companion_levels alter column base_price set not null;
  exception when others then
    raise notice 'base_price NOT NULL skipped: %', SQLERRM;
  end;
end $$;

do $$
begin
  alter table public.companion_levels
    add constraint companion_levels_base_price_check
    check (base_price is null or base_price >= 0);
exception when duplicate_object then null;
end $$;

alter table public.companion_services
  add column if not exists base_price_snapshot numeric(12,2),
  add column if not exists proposed_price numeric(12,2),
  add column if not exists proposed_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text not null default '',
  add column if not exists source text not null default 'legacy_import',
  add column if not exists level_id_at_price text not null default '';

create index if not exists idx_companion_services_review_pending
  on public.companion_services (review_status, proposed_at desc)
  where proposed_price is not null;

notify pgrst, 'reload schema';
