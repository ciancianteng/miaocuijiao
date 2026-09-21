# Production Auth password-recovery redirect (Site URL)

## Symptom

Supabase Dashboard → **Send password recovery** for `meowcuijiao@gmail.com` arrives,
but the link opens `localhost` and Safari cannot connect.

## Root cause (verified)

Production project `jqfaknpmcnqwqvatrwgo` Auth config:

| Setting | Current (broken) | Required |
| --- | --- | --- |
| **Site URL** | `http://localhost:3000` | `https://meow-cuijiao-homepage.vercel.app` |
| **Redirect URLs** | missing prod hosts (so custom `redirectTo` is ignored) | include prod + custom domain paths below |

Auth Admin `generate_link` with `type=recovery` always emitted:

`redirect_to=http://localhost:3000`

even when a production `redirect_to` was requested — because it was **not allow-listed**.

## Important distinction

| Flow | Uses Site URL? |
| --- | --- |
| Supabase Dashboard **Send password recovery** | **Yes** — broken until Site URL fixed |
| App **忘记密码** on `/admin/login/` (email OTP via `/api/auth`) | **No** — OTP only, no recovery link |

There is **no** app `resetPasswordForEmail({ redirectTo })` call in this repo.
Localhost is **not** hardcoded in the recovery email template code; it comes from Supabase Auth **Site URL**.

## Fix (Dashboard — preferred, immediate)

1. Open [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/jqfaknpmcnqwqvatrwgo/auth/url-configuration)
2. Set **Site URL** to:

   `https://meow-cuijiao-homepage.vercel.app`

3. Add **Redirect URLs** (one per line):

   ```text
   https://meow-cuijiao-homepage.vercel.app/**
   https://meow-cuijiao-homepage.vercel.app/admin/login/
   https://www.meowcuijiao.com/**
   https://www.meowcuijiao.com/admin/login/
   https://meowcuijiao.com/**
   https://meowcuijiao.com/admin/login/
   ```

4. Save.
5. Re-send password recovery for `meowcuijiao@gmail.com`.
6. Confirm the link’s `redirect_to` host is **not** `localhost`.

## Fix (Management API script)

If you have a Personal Access Token (`sbp_…`):

```bash
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/fix-prod-auth-redirects.mjs
```

Dry-run:

```bash
DRY_RUN=1 SUPABASE_ACCESS_TOKEN=sbp_... node scripts/fix-prod-auth-redirects.mjs
```

This PATCHes **only** Auth `site_url` + `uri_allow_list`. It does not change users or DB rows.

## Vercel production domain

Canonical production app host used by this fix:

`https://meow-cuijiao-homepage.vercel.app`

Custom domain (also allow-listed): `https://www.meowcuijiao.com`

## Workaround (works today without Site URL change)

Open production admin login → **忘记密码** → email OTP → set new password.
That path does not use Supabase recovery links.
