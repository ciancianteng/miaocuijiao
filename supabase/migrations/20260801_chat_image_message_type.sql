-- Allow image messages in chat (idempotent).
DO $$ BEGIN
  ALTER TYPE public.mcj_message_type ADD VALUE 'image';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
