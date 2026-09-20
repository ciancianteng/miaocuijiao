-- Gameplay product platform commission % (idempotent).
-- Canonical field: public.gameplay_products.commission_rate (numeric 0–100).
ALTER TABLE public.gameplay_products
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) not null default 0;

DO $$ BEGIN
  ALTER TABLE public.gameplay_products
    DROP CONSTRAINT IF EXISTS gameplay_products_commission_rate_check;
  ALTER TABLE public.gameplay_products
    ADD CONSTRAINT gameplay_products_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 100);
EXCEPTION WHEN others THEN NULL;
END $$;

COMMENT ON COLUMN public.gameplay_products.commission_rate IS
  'Platform commission percent for this gameplay product (0-100). Canonical field used by admin save/list and order settlement snapshot.';

NOTIFY pgrst, 'reload schema';
