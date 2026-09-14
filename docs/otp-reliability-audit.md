# OTP reliability audit — boss home vs companion (2026-09-13)

## Product fact (important)

MVP **login / register / forgot OTP is email-channel** (Resend → SMTP fallback).
SMS `sendSmsOtp` is a **stub** and is not used for delivery.
Malaysia phone normalize is unified for **profile/register phone fields**, not as a second OTP transport.

User reports that mention “手机号收不到验证码” on home/boss login are usually:
1. Email OTP anti-enumeration (wrong portal / role), or
2. Provider/inbox issues,
not a separate SMS pipeline.

## Entry → API map (after this PR)

| Entry | Frontend | Endpoint | Action | `role` / `source` |
|---|---|---|---|---|
| Home / Boss login modal | `index.html` + `src/role-gates.js` | `POST /api/auth` | `send_login_otp` / `login_with_otp` | `boss` / `boss_home` |
| Companion workbench login | `src/companion-workbench.js` + `role-gates.js` | same | same | `companion` / `companion_portal` |
| Companion apply login | `src/companion-application.js` | same | same | `companion` / `companion_apply_login` |
| Register (boss/companion) | role-gates / application / mine | same | `send_register_otp` | role + source |
| Forgot password | `src/forgot-password.js` | same | `forgot_send_otp` | portal role |
| CS / Admin login | password only | — | no login OTP | — |

**No legacy second OTP API** for boss/companion login. CS still has a separate reset-code path under customer-service (password-reset), not login OTP.

## Root cause: “companion receives, home does not”

Both portals call the **same** `handleLoginSendOtp` in `server/api/auth.js`.

Diff that matters:

1. **Payload `role`**
   - Home → `role: "boss"`
   - Companion → `role: "companion"`
2. **Account resolution is portal-scoped** (`resolveForgotAccount(email, role)`).
   - Companion-only account on boss home → **no mail**, HTTP **200** anti-enumeration (`delivery: "suppressed"`).
   - Same email on companion portal → real Resend send (`delivery: "sent"`).
3. Frontend previously treated any `ok !== false` as success and started cooldown — looks like “已发送但收不到”.

Secondary risks (still guarded):
- `EMAIL_NOT_VERIFIED` → 403 (visible error)
- Provider failure → **503** `ok:false` (no cooldown)
- Spam filtering by subject label (`老板端` vs `陪玩端`)

## Fixes in this PR

1. Shared `server/api/_otp-identity.js` — email + MY phone normalize, masking, structured `logOtpEvent`.
2. Auth OTP paths emit: `otp_request`, `otp_suppressed`, `otp_provider_request`, `otp_provider_success/failed` (via mail bridge), `otp_rate_limited`, `otp_verify_*`.
3. Response `delivery`: `sent` | `failed` | `suppressed` — UI must not claim “已发送” on suppressed.
4. Frontend: scoped email field (`otpEmailNear`), strict `j.ok === true`, pass `source`, cooldown only when server returns `retryAfterSec` on success.
5. Offline smoke: `node scripts/otp-reliability-smoke.mjs`.

## Production readiness probe (no secrets printed)

- `POST https://www.meowcuijiao.com/api/auth` `send_register_otp` to a fresh gmail → **200** with `mail.configured: true`, `otpFromDomain: meowcuijiao.com`.
- Unknown login email (boss/companion) → **200** anti-enum message (expected).
- Required env (names only): `RESEND_API_KEY`, `RESEND_FROM`, preferred `RESEND_OTP_FROM`, Supabase service role for OTP store.

## PASS bar

Code path: boss home and companion login OTP **share one service**.  
Live mailbox acceptance for a specific boss account still depends on that account existing on the boss portal and inbox delivery — check logs for `otp_suppressed` vs `otp_provider_success`.
