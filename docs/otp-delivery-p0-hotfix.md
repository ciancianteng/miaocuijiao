# Production OTP email delivery — ops checklist (P0)

## Architecture (do not confuse with Supabase Auth OTP)

User clicks「发送验证码」→ `POST /api/auth` (`send_login_otp` / `send_register_otp` / `forgot_send_otp`)
→ server generates OTP → **Resend** (`RESEND_API_KEY`) with optional SMTP fallback
→ OTP committed to `password_reset_requests` **only after** provider accept
→ user verifies via matching auth action

Supabase Auth is used for session after verify — **not** for sending the OTP email.

## Required Production env

| Var | Purpose |
|-----|---------|
| `RESEND_API_KEY` | Resend API key (Production) |
| `RESEND_FROM` | General / orders From |
| `RESEND_OTP_FROM` | **OTP From** — must be on verified domain; prefer `noreply@meowcuijiao.com`, **not** `orders@` |

If `RESEND_OTP_FROM` is unset, code derives `noreply@<domain-of-RESEND_FROM>`.

## DNS (meowcuijiao.com)

Publish / verify with Resend dashboard:

- `resend._domainkey` TXT — prefer full `v=DKIM1; k=rsa; p=...` (not bare `p=`)
- `send` MX → Resend/SES feedback host
- `send` TXT SPF `v=spf1 include:amazonses.com ~all`
- `_dmarc` TXT `v=DMARC1; p=none; ...`

Then click **Verify** in Resend for the domain.

## Fake-success rules

| Case | HTTP | Client cooldown |
|------|------|-----------------|
| Provider accepted + OTP stored | 200 `ok:true` + `retryAfterSec` | Start cooldown |
| Anti-enumeration (unknown / wrong portal) | 200 `ok:true` generic copy | Start cooldown (intentional) |
| Provider / store failure | **503** `ok:false`, **no** `retryAfterSec` | **Do not** cooldown |
| Rate limit | **429** + `retryAfterSec` | Cooldown |

## Observability

Server logs `[otp/send]` / `[mail/resend]` with:

- `requestId`
- masked email
- provider / `providerMessageId`
- purpose / role
- latency / error (no plaintext OTP)

DB: `password_reset_requests.provider_message_id`, `delivery_status` (`sent` / `failed`).

## Manual verification matrix

1. Register OTP → real mailbox (Gmail / Outlook / other) — arrives < 2 min
2. Login OTP on **correct** portal role
3. Login OTP on **wrong** portal — generic success, **no** mail (expected)
4. Forgot OTP
5. Resend after success — 60s cooldown
6. Force provider failure — UI shows error, **no** fake 60s lock
7. Password login still works
