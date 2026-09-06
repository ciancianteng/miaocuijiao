# SAFE PLAN: Convert `admin@meow.test` → real Production admin

**Status:** PLAN ONLY — **do not execute** until you explicitly approve.  
**Goal:** Reuse existing admin Auth user + `profiles` row; change identity to your real email.  
**No new admin account.**

**Fixed identity (current Production):**

| Field | Value |
|---|---|
| `profiles.id` / Auth `user.id` | `6f31b706-11e7-42df-8db1-d2caccd796de` |
| Current email | `admin@meow.test` |
| Role | `admin` |
| Status | `active` |

**Placeholder you must fill before apply:** `NEW_ADMIN_EMAIL` = your real Production admin email  
(must **not** be `@meow.test`, disposable, or `@mcj-prod-smoke.invalid`)

---

## Why this is safer than creating a second admin

- Same UUID → no orphan Auth/profile split  
- Role/status already correct  
- After email change, Production hard-block of `admin@meow.test` **no longer applies** to this user  
- Avoids “two admins” confusion during G2

---

## Preconditions (human)

| # | Check | Required |
|---|---|---|
| P1 | `NEW_ADMIN_EMAIL` is not already used by another Auth user / `profiles` row | YES |
| P2 | You can receive mail at `NEW_ADMIN_EMAIL` (for recovery / confirm if needed) | YES |
| P3 | You know or will reset the password for this Auth user | YES |
| P4 | Backup / PITR acknowledged; record `T0` (UTC) before any change | YES |
| P5 | Apply window: Agent/ops will **not** run G2 marking this UUID as test | YES |

---

## Step 1 — Backup current admin identity (read-only export)

**Do this first. Keep the dump until login is verified.**

### 1A. Supabase Dashboard (recommended)

1. **Authentication → Users** → open `admin@meow.test`  
2. Screenshot / copy: `id`, email, created_at, last_sign_in, confirmed  
3. **Table Editor → profiles** → row `6f31b706-11e7-42df-8db1-d2caccd796de`  
4. Export or copy full row (JSON/CSV)

### 1B. Read-only SQL snapshot (human runs in SQL Editor; Agent will not)

```sql
-- READ ONLY snapshot — save results externally
select id, email, role, display_name, status, created_at, updated_at
  -- , is_test_account   -- include only if column already exists
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

-- Optional: confirm no other profile already owns NEW_ADMIN_EMAIL
-- select id, email, role from public.profiles
-- where lower(email) = lower('NEW_ADMIN_EMAIL');
```

### 1C. Backup record template

```text
T0 (UTC): ___
Auth user id: 6f31b706-11e7-42df-8db1-d2caccd796de
Old email: admin@meow.test
Old display_name: ___
Old status/role: active / admin
NEW_ADMIN_EMAIL: ___
Password plan: keep existing / reset after email change
```

---

## Step 2 — Update Auth email → `NEW_ADMIN_EMAIL`

**Preferred: Dashboard (no SQL on `auth.users`)**

1. Authentication → Users → `6f31b706-11e7-42df-8db1-d2caccd796de`  
2. Edit email → `NEW_ADMIN_EMAIL`  
3. Ensure email is **confirmed** (Auto-confirm / mark confirmed) so login is not stuck  
4. If prompted, send password reset to `NEW_ADMIN_EMAIL` and set a strong password  

**Alternative (service role Admin API — still not run by Agent unless approved):**

```http
PUT /auth/v1/admin/users/6f31b706-11e7-42df-8db1-d2caccd796de
{ "email": "NEW_ADMIN_EMAIL", "email_confirm": true }
```

**Do not** change the user `id`.

---

## Step 3 — Update `profiles` to match Auth

**Human SQL Editor only after Auth email succeeds:**

```sql
-- APPLY ONLY AFTER APPROVAL (template)
begin;

update public.profiles
set
  email = lower('NEW_ADMIN_EMAIL'),
  display_name = coalesce(nullif(trim(display_name), ''), 'Admin'),
  role = 'admin',
  status = 'active'
  -- is_test_account = false   -- see Step 4
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

-- Expect rowcount = 1
select id, email, role, status, display_name
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

commit;
```

**Rules:**

- `profiles.email` must equal Auth email (case-normalized)  
- Keep `role = 'admin'`, `status = 'active'`  
- Do **not** change `id`

---

## Step 4 — Ensure `is_test_account = false`

### If column **does not exist** yet (current Production state)

1. Either defer Step 4 until **G1** DDL is applied, then run 4B  
2. Or apply **G1 first** (separate approve), then 4B  

G1 (reference only):

```sql
alter table public.profiles
  add column if not exists is_test_account boolean not null default false;
alter table public.companion_profiles
  add column if not exists is_test_account boolean not null default false;
```

Default `false` already protects this admin after G1; still set explicitly:

### 4B — Explicit clear (after column exists)

```sql
update public.profiles
set is_test_account = false
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

-- companion mirror if a row exists (usually none for admin)
update public.companion_profiles
set is_test_account = false
where user_id = '6f31b706-11e7-42df-8db1-d2caccd796de';
```

### Critical follow-up for G2

Current G2 draft **includes** this UUID in the “mark as test” list.  
**Before any G2 apply**, remove `6f31b706-11e7-42df-8db1-d2caccd796de` from G2 so this real admin is **never** marked test.

After conversion, G2 smoke list = **10** accounts (not 11).

---

## Step 5 — Verify login works (C2 for converted admin)

| # | Check | Expected |
|---|---|---|
| V1 | Auth user email is `NEW_ADMIN_EMAIL`, confirmed | YES |
| V2 | `profiles` email/role/status match | `NEW_ADMIN_EMAIL` / admin / active |
| V3 | `is_test_account` is false or column absent-then-false after G1 | false |
| V4 | Production login: https://meow-cuijiao-homepage.vercel.app/admin/login/ with **NEW_ADMIN_EMAIL** | **SUCCESS** |
| V5 | Login as `admin@meow.test` | **FAIL** (user no longer exists under that email) |
| V6 | Code heuristics: not `@meow.test`, not disposable, display_name without `Smoke` | Not blocked |

### Why login should succeed after conversion

From `server/api/_test-accounts.js`:

- Hard block is **exact** email `admin@meow.test` only  
- Production block also rejects `@meow.test` / disposable / Smoke names  
- Real email + normal display name → **not** blocked  
- `is_test_account = false` → not treated as test for stats/guards that use the flag  

---

## Recommended execution order (when you approve later)

```text
1) Backup dump (Step 1) + T0
2) Auth email change (Step 2)
3) profiles email/role/status sync (Step 3)
4) G1 if needed, then is_test_account=false (Step 4)
5) Login verify V4 SUCCESS (Step 5)
6) Edit G2 list: remove this UUID (doc/SQL review update)
7) Only then consider G2 for the remaining 10 smoke accounts
```

---

## Rollback sketch (if login fails)

1. Auth Admin API / Dashboard: set email back to `admin@meow.test` (confirm again)  
2. `profiles.email` back to `admin@meow.test`  
3. Note: Production will again **block** login for `@meow.test` — rollback restores identity consistency, not necessarily “usable Prod login” without break-glass  

Prefer fixing forward (password reset / confirm email) over rollback when possible.

---

## Out of scope (still blocked)

- Agent executing any Production SQL / Auth Admin mutation  
- G2 apply  
- pending-prod 01–05  
- Enabling settlement / points flags  

---

## Your reply to unlock apply (later)

```text
CONVERT ADMIN PLAN ACK
- NEW_ADMIN_EMAIL domain: ___@___
- Backup/T0 done: YES / NO
- Approve Step 2 Auth email change: YES / NO
- Approve Step 3 profiles update: YES / NO
- Approve Step 4 is_test_account=false (and G1 if needed): YES / NO
- After V4 SUCCESS, remove this UUID from G2 list: YES
```

**Until that ACK: no execution.**
