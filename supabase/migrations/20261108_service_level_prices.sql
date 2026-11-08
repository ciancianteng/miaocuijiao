-- Service × LV1–LV5 price matrix (Staging-first).
-- Does NOT delete companion_levels ladder. Paid order snapshots unchanged.
-- Rollback: DROP TABLE public.service_level_prices;

CREATE TABLE IF NOT EXISTS public.service_level_prices (
  service_id text NOT NULL,
  level_id text NOT NULL,
  base_price numeric(10,2) NOT NULL DEFAULT 0,
  min_price numeric(10,2) NOT NULL DEFAULT 0,
  max_price numeric(10,2) NOT NULL DEFAULT 0,
  markup_allowance numeric(10,2) NOT NULL DEFAULT 0,
  max_plus boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, level_id),
  CONSTRAINT service_level_prices_band_chk
    CHECK (min_price >= 0 AND max_price >= min_price AND base_price >= min_price AND base_price <= max_price),
  CONSTRAINT service_level_prices_markup_chk
    CHECK (markup_allowance >= 0 AND (max_plus OR (base_price + markup_allowance) <= max_price + 0.0001))
);

CREATE INDEX IF NOT EXISTS idx_service_level_prices_level
  ON public.service_level_prices (level_id);

COMMENT ON TABLE public.service_level_prices IS
  'Catalog service × companion level sell band. Fallback = companion_levels when row missing.';

ALTER TABLE public.service_level_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_level_prices_deny_anon ON public.service_level_prices;
CREATE POLICY service_level_prices_deny_anon
  ON public.service_level_prices
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
