# Supabase recovery → Set New Password UI

## Problem
Dashboard “Send password recovery” redirected to production, but the site had **no recovery callback page**, so users saw the homepage/login with no password form.

## App audit (before fix)
| Check | Result |
| --- | --- |
| Route for recovery callback | **Missing** |
| `PASSWORD_RECOVERY` listener | **Missing** |
| Hash `access_token` / `type=recovery` handling | **Missing** |
| `supabase.auth.updateUser({ password })` | **Missing** (in-app forgot uses OTP + admin API instead) |

## Fix (this change)
1. **`/auth/reset-password/`** — dedicated Set New Password page  
2. **`src/supabase-recovery-reset.js`** — loads anon client, detects recovery session / hash, listens for `PASSWORD_RECOVERY`, form calls `updateUser({ password })`  
3. Early include on **`/`** and **`/admin/login/`** — if URL has `type=recovery`, redirect to `/auth/reset-password/` keeping the hash  

## Expected flow
Email link → production (Site URL) → detect `type=recovery` → `/auth/reset-password/` → set password → `updateUser` → redirect `/admin/login/`

## Production 404 note (fixed)
`/auth/reset-password/` returned Vercel `NOT_FOUND` when the HTML was missing from the Vite MPA `pages` build input / `vercel.json` rewrites.
Fix: include `auth/reset-password/index.html` in `vite.config.js` pages + rewrite `/auth/reset-password/` → that file.

