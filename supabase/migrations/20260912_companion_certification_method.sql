-- Pricing V2 P2 / apply flow: durable certification_method SoT.
-- Staging-first. Idempotent. Does NOT rewrite existing companion prices/levels/services.

ALTER TABLE public.companion_profiles
  ADD COLUMN IF NOT EXISTS certification_method text;

ALTER TABLE public.companion_profiles
  ADD COLUMN IF NOT EXISTS credential_mode text;

COMMENT ON COLUMN public.companion_profiles.certification_method IS
  'Apply STEP1 choice: id_card | deposit. Admin review SoT (also mirrored in credential_mode / application_note tag).';

COMMENT ON COLUMN public.companion_profiles.credential_mode IS
  'Legacy alias of certification_method (id_card | deposit). Kept for older readers.';

-- Backfill from note marker or credential_mode only — never touch price/level/service rows.
UPDATE public.companion_profiles
SET certification_method = CASE
  WHEN lower(coalesce(certification_method, '')) IN ('id_card', 'deposit') THEN lower(certification_method)
  WHEN lower(coalesce(credential_mode, '')) IN ('id_card', 'deposit') THEN lower(credential_mode)
  WHEN application_note ~* '\[AUTH_MODE:id_card\]' THEN 'id_card'
  WHEN application_note ~* '\[AUTH_MODE:deposit\]' THEN 'deposit'
  ELSE certification_method
END
WHERE certification_method IS NULL
   OR lower(coalesce(certification_method, '')) NOT IN ('id_card', 'deposit');

UPDATE public.companion_profiles
SET credential_mode = certification_method
WHERE certification_method IN ('id_card', 'deposit')
  AND (credential_mode IS NULL OR lower(coalesce(credential_mode, '')) <> certification_method);

CREATE INDEX IF NOT EXISTS idx_companion_profiles_certification_method
  ON public.companion_profiles (certification_method);

NOTIFY pgrst, 'reload schema';
