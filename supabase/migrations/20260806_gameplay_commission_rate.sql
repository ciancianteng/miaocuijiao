-- Gameplay product platform commission % (idempotent).
ALTER TABLE public.gameplay_products
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) not null default 0;

COMMENT ON COLUMN public.gameplay_products.commission_rate IS
  'Platform commission percent for this gameplay product (0-100)';
