# OTP Fix — Staging apply notes

**Migration:** `supabase/migrations/20260908_otp_password_reset_requests_fix.sql`  
**Script:** `node scripts/apply-otp-fix-staging.mjs`  
**Staging ref only:** `cfccwysniduwkjskiqgy`  
**Forbidden:** Production apply in this PR; orders; Supabase Auth OTP templates

## Steps

1. `node scripts/verify-otp-fix-offline.mjs`
2. `node scripts/apply-otp-fix-staging.mjs` (requires STAGING_* secrets)
3. Manual: send login OTP twice within 60s → second returns 429 + `retryAfterSec`
4. Manual: force mail failure path → previous active OTP still verifies
5. Confirm Vercel Production does **not** set `MCJ_OTP_DEBUG` / `ALLOW_STAGING_OTP` (code also hard-blocks debug on `VERCEL_ENV=production`)

## Rollback

1. Revert Fix PR code
2. Keep `password_reset_requests` columns (do not DROP)
3. Optional: mark stray `active` rows `superseded`
