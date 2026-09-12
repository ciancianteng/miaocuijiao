-- Allow companion profile cards in boss↔CS chat (idempotent).
DO $$ BEGIN
  ALTER TYPE public.mcj_message_type ADD VALUE 'companion_card';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.mcj_message_type ADD VALUE 'product_card';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
