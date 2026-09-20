-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY TO PRODUCTION IN THIS PR / AGENT RUN
-- =============================================================================
-- Title: Companion pricing P1 — base_price + companion_services columns
-- Staging migration: supabase/migrations/20260908_companion_pricing_p1.sql
-- Staging project: cfccwysniduwkjskiqgy
-- Production project: jqfaknpmcnqwqvatrwgo
--
-- Gate: Staging verification PASS + human approval required before any Prod apply.
-- Merge of the P1 code PR ≠ Production migration.
-- Does NOT touch gameplay_products (PR #198 isolation).
-- =============================================================================

-- A) companion_levels.base_price
ALTER TABLE public.companion_levels
  ADD COLUMN IF NOT EXISTS base_price numeric(10,2);

COMMENT ON COLUMN public.companion_levels.base_price IS
  'P1 SoT: level default sell price. min_price/max_price remain custom-price rule limits only.';

UPDATE public.companion_levels
SET base_price = min_price
WHERE base_price IS NULL;

-- B) companion_services pricing / review audit columns
ALTER TABLE public.companion_services
  ADD COLUMN IF NOT EXISTS base_price_snapshot numeric(12,2),
  ADD COLUMN IF NOT EXISTS proposed_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS level_id_at_price text;

COMMENT ON COLUMN public.companion_services.price IS
  'Effective sell price (approved / level_default). Never use proposed_price as effective.';
COMMENT ON COLUMN public.companion_services.proposed_price IS
  'Pending custom price; ignored by resolveEffectiveServicePrice until approved.';
COMMENT ON COLUMN public.companion_services.source IS
  'level_default | admin_set | companion_custom | legacy_import';
COMMENT ON COLUMN public.companion_services.base_price_snapshot IS
  'Level base_price at bind/seed time.';
COMMENT ON COLUMN public.companion_services.level_id_at_price IS
  'Level id when price was set.';

CREATE INDEX IF NOT EXISTS idx_companion_services_companion_service
  ON public.companion_services (companion_id, service_id);

CREATE INDEX IF NOT EXISTS idx_companion_services_companion_name
  ON public.companion_services (companion_id, service_name);

NOTIFY pgrst, 'reload schema';

-- NOTE: companion_services row backfill (legacy_import / level_default) and
-- allow_orders=false quarantine for no-level companions must be run via the
-- Staging script first (scripts/backfill-companion-pricing-p1-staging.mjs),
-- then a Production-specific backfill plan after Staging PASS — not in this DDL.
