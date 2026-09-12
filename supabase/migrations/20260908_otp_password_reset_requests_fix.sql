-- OTP Fix: durable password_reset_requests (no platform_settings single-slot).
-- Staging-first. Idempotent. Does NOT touch orders / Supabase Auth schemas.

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id text PRIMARY KEY,
  account text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.password_reset_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'otp',
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verify_fails integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public.password_reset_requests IS
  'Durable OTP / password-reset rows (login, forgot, register). Multi-user isolated; never use platform_settings.';
COMMENT ON COLUMN public.password_reset_requests.kind IS
  'otp | login_otp | register_otp | …';
COMMENT ON COLUMN public.password_reset_requests.status IS
  'active | send_failed | superseded | used | verified:… | register_verified:… | legacy kind:code:exp:…';
COMMENT ON COLUMN public.password_reset_requests.delivery_status IS
  'pending | sent | failed | delivered | bounced | complained';
COMMENT ON COLUMN public.password_reset_requests.provider_message_id IS
  'Resend (or SMTP) message id after successful send';

CREATE INDEX IF NOT EXISTS password_reset_requests_account_role_created_idx
  ON public.password_reset_requests (account, role, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_requests_lookup_idx
  ON public.password_reset_requests (account, role, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_requests_active_idx
  ON public.password_reset_requests (account, role, kind, expires_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS password_reset_requests_sent_cooldown_idx
  ON public.password_reset_requests (account, role, kind, sent_at DESC)
  WHERE sent_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
