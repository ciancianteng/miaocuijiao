-- Dual-role identity repair (DESIGN ONLY — do not run on Production without dry-run review).
-- Goal: restore primary role=boss for users who clearly had Boss capability but were demoted to companion,
-- while keeping companion_profiles / companion capability intact.
-- NEVER promote based on boss_uid alone.

-- =============================================================================
-- DRY-RUN SELECT (run first; review rows before applying UPDATE)
-- =============================================================================

-- Candidates with companion primary + companion_profiles + strong Boss order evidence
SELECT
  p.id,
  p.email,
  p.role AS current_role,
  p.roles,
  p.boss_uid,
  p.status,
  cp.id AS companion_profile_id,
  cp.application_status,
  cp.verification_status,
  (SELECT count(*) FROM public.orders o WHERE o.boss_id = p.id) AS orders_as_boss,
  CASE
    WHEN exists (SELECT 1 FROM public.orders o WHERE o.boss_id = p.id) THEN 'orders.boss_id'
    WHEN p.roles IS NOT NULL AND 'boss' = ANY (p.roles) THEN 'profiles.roles'
    ELSE 'none'
  END AS boss_evidence
FROM public.profiles p
JOIN public.companion_profiles cp ON cp.user_id = p.id
WHERE lower(trim(p.role)) = 'companion'
  AND (
    exists (SELECT 1 FROM public.orders o WHERE o.boss_id = p.id)
    OR (p.roles IS NOT NULL AND 'boss' = ANY (p.roles))
  )
ORDER BY p.updated_at DESC NULLS LAST;

-- Counter-example: companion + boss_uid but NO Boss business evidence (must NOT auto-repair)
SELECT
  p.id,
  p.email,
  p.role,
  p.boss_uid,
  (SELECT count(*) FROM public.orders o WHERE o.boss_id = p.id) AS orders_as_boss
FROM public.profiles p
JOIN public.companion_profiles cp ON cp.user_id = p.id
WHERE lower(trim(p.role)) = 'companion'
  AND p.boss_uid IS NOT NULL
  AND btrim(p.boss_uid) <> ''
  AND NOT exists (SELECT 1 FROM public.orders o WHERE o.boss_id = p.id)
  AND (p.roles IS NULL OR NOT ('boss' = ANY (p.roles)))
ORDER BY p.updated_at DESC NULLS LAST
LIMIT 200;

-- =============================================================================
-- REPAIR (idempotent): promote primary to boss; merge roles[] to include boss+companion
-- Does not rewrite boss_uid. Does not touch users without strong evidence.
-- =============================================================================

UPDATE public.profiles p
SET
  role = 'boss',
  roles = (
    SELECT ARRAY(
      SELECT DISTINCT r
      FROM unnest(
        coalesce(p.roles, ARRAY[]::text[]) || ARRAY['boss', 'companion']::text[]
      ) AS r
      WHERE r IS NOT NULL AND btrim(r) <> ''
    )
  ),
  updated_at = now()
WHERE lower(trim(p.role)) = 'companion'
  AND exists (SELECT 1 FROM public.companion_profiles cp WHERE cp.user_id = p.id)
  AND (
    exists (SELECT 1 FROM public.orders o WHERE o.boss_id = p.id)
    OR (p.roles IS NOT NULL AND 'boss' = ANY (p.roles))
  );

-- Optional verify after repair
-- SELECT id, email, role, roles, boss_uid FROM public.profiles
-- WHERE id IN (/* ids from dry-run */);

COMMENT ON COLUMN public.profiles.role IS
  'Primary role for legacy filters. Dual Boss+Companion: keep role=boss; companion capability via companion_profiles + roles[].';
