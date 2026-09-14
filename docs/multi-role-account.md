# Multi-role account (boss + companion) — P0

## 1. Current role / account data structure

| Layer | Binding | Notes |
|---|---|---|
| `auth.users` | email unique (platform) | One email → one Auth user. **Never** create a second Auth user for role upgrade. |
| `profiles.id` | = `auth.users.id` | Single account hub. |
| `profiles.role` | primary role enum | Legacy single-role field (`boss` / `companion` / …). |
| `profiles.roles` | `text[]` optional | Multi-role SoT e.g. `{boss,companion}`. |
| `profiles.boss_uid` | public boss code | Boss identity is **not** a separate table. |
| `companion_profiles.user_id` | unique → `profiles.id` | Companion capability row on the **same** user_id. |
| Auth `app_metadata.roles` | mirrored | Written by `persistRoles`. |

**Invariant:** dual-role account = one `user_id`, `roles` includes both, preferably `profiles.role = boss` + `companion_profiles` row.

Helpers: `server/api/_account-roles.js` (`resolveRoles`, `enrichProfileRoles`, `addRoleToUser`).

## 2. Why companion-only could not enter boss portal OTP

Path: boss home → `send_login_otp` + `role=boss` → `resolveForgotAccount` / `classifyLoginPortalAccount`.

Companion-only profile: `role=companion`, no boss in `roles`, may have `companion_profiles`.

`enrichProfileRoles` → `hasBoss=false` → portal classify fails.

**Before this PR:** anti-enumeration returned HTTP 200 + soft “如已注册将收到验证码” **without sending mail** → looked like Resend / OTP provider failure.

**Root cause class:** multi-identity / portal role gate — **not** Resend provider outage.

## 3. Is registration also blocked?

| Flow | Before | After |
|---|---|---|
| Boss register OTP when email already companion | 409 “请直接登录” (dead-end) | 409 `COMPANION_EXISTS_OPEN_BOSS` → login companion → `open_boss_role` |
| Companion register when email already boss | 409 `EMAIL_EXISTS_LOGIN_THEN_APPLY` | Unchanged (correct) |
| Logged-in boss → apply companion | `apply_companion_role` on same user_id | Unchanged |
| Logged-in companion → open boss | **Missing** | **`open_boss_role` / `apply_boss_role`** |

Email uniqueness still blocks a **second Auth user** — that is correct. Adding a role must not require a second email.

## 4. Fix plan (implemented)

1. `classifyLoginPortalAccount` — distinguish `ACCOUNT_NOT_FOUND` vs `ROLE_NOT_OPENED`.
2. Boss/companion login OTP:
   - unknown email → anti-enum suppressed (no fake cooldown requirement on client when `delivery!==sent`)
   - known email, missing portal role → **403** `BOSS_ROLE_NOT_OPENED` / `COMPANION_ROLE_NOT_OPENED` (no fake OTP_SENT)
3. `open_boss_role` — session required; `addRoleToUser(..., "boss")` + `ensureBossUid`; `createdNewAuthUser: false`
4. Companion workbench account page CTA「开通老板身份」
5. Dual-role: both portals send real OTP when capability exists; wallet/order stay on same `user_id`

## 5. Acceptance matrix

| Case | Expected |
|---|---|
| A. companion-only → `open_boss_role` | PASS — same user_id gains boss |
| B. boss-only → apply companion | PASS — existing path |
| C. dual-role → boss portal OTP | PASS — `delivery=sent` |
| D. dual-role → companion portal OTP | PASS — `delivery=sent` |
| E. no cross-account code | PASS — OTP keyed by account+role |
| F. wallet/order/notification | PASS — still `profiles.id` |

## Actions

- `POST /api/auth` `{ action: "open_boss_role" }` (aliases: `apply_boss_role`, `upgrade_to_boss`, `companion_open_boss`)
- `POST /api/auth` `{ action: "send_login_otp", role: "boss"|"companion", email }`
