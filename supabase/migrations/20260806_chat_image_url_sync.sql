-- Chat image sync: ensure message_type includes image + optional image_url column.
-- Idempotent. content remains the durable public URL; image_url mirrors it when present.

DO $$ BEGIN
  ALTER TYPE public.mcj_message_type ADD VALUE 'image';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.messages.image_url IS
  'Durable public Storage URL for image messages; mirrors content when message_type=image';
