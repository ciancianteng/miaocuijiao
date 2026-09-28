ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS review_remark text;

ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS reviewed_by_staff_id uuid
  REFERENCES public.profiles(id);

ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS reviewed_by_staff_name text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
