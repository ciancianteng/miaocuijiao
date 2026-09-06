# PLAN ONLY — Convert `admin@meow.test` → different real admin email

**Status:** PLAN ONLY — **do not execute**  
**G2:** Remains **BLOCKED** until conversion login verification succeeds and you separately approve G2.

---

## Locked decisions

| Item | Decision |
|---|---|
| Boss Gmail account | **UNCHANGED** — do not touch |
| Boss id | `458ce9ad-3425-42b1-ab66-24bca342f971` |
| Boss email | `ciancianteng@gmail.com` |
| Convert target | Existing admin UUID only |
| Admin id | `6f31b706-11e7-42df-8db1-d2caccd796de` |
| Current admin email | `admin@meow.test` |
| New admin email | **`NEW_ADMIN_EMAIL`** — you must supply (unused) |

---

## Forbidden

- Any UPDATE/DELETE on boss `458ce9ad-…` / `ciancianteng@gmail.com`  
- Converting or promoting the boss account to admin  
- Merging boss + admin identities  
- G2 apply  
- pending-prod 01–05 (unless separately approved)  
- Agent execution until you send `EXECUTE` with a concrete unused email  

---

## Email requirements for `NEW_ADMIN_EMAIL`

Must be **all** of:

1. Not `ciancianteng@gmail.com`  
2. Not `@meow.test`  
3. Not disposable / guerrilla / smoke domains  
4. **Not already present** in Production `auth.users` or `public.profiles`  
5. Display name must not contain `Smoke` / `ProdSmoke`  

**Reply with the exact address** before final SQL freeze, e.g.:

```text
NEW_ADMIN_EMAIL: you@yourdomain.com
```

---

## Preflight (read-only — run when email is known)

```sql
-- Expect 0 rows for NEW_ADMIN_EMAIL
select id, email, role, status
from public.profiles
where lower(email) = lower('NEW_ADMIN_EMAIL');

-- Admin row to convert (expect 1)
select id, email, role, status, display_name
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

-- Boss must remain untouched (expect unchanged gmail boss)
select id, email, role, status
from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';
```

Dashboard: Authentication → confirm no user already owns `NEW_ADMIN_EMAIL`.

---

## Conversion steps (admin UUID only)

### Step 1 — Backup

- Screenshot/export Auth user `6f31b706-…` (`admin@meow.test`)  
- Save profiles snapshot for that id  
- Record `T0` (UTC)  
- Confirm boss row still `ciancianteng@gmail.com` / `boss`

### Step 2 — Auth email (Dashboard preferred)

On user **`6f31b706-11e7-42df-8db1-d2caccd796de` only**:

1. Change email: `admin@meow.test` → `NEW_ADMIN_EMAIL`  
2. Mark email **confirmed**  
3. Set/reset password for `NEW_ADMIN_EMAIL`  

Do **not** open or edit the boss Auth user.

### Step 3 — profiles sync (admin id only)

```sql
begin;

update public.profiles
set
  email = lower('NEW_ADMIN_EMAIL'),
  role = 'admin',
  status = 'active'
where id = '6f31b706-11e7-42df-8db1-d2caccd796de'
  and email = 'admin@meow.test';

-- expect UPDATE 1
select id, email, role, status
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

-- boss unchanged check
select id, email, role, status
from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';
-- expect: ciancianteng@gmail.com / boss / active

commit;
```

### Step 4 — `is_test_account = false`

If column missing, G1 DDL first (profiles + companion_profiles), then:

```sql
update public.profiles
set is_test_account = false
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

update public.companion_profiles
set is_test_account = false
where user_id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- 0 companion rows is OK
```

### Step 5 — Verify (then keep G2 blocked)

| Check | Expected |
|---|---|
| Login Production `/admin/login/` as `NEW_ADMIN_EMAIL` | SUCCESS |
| Login as `admin@meow.test` | FAIL |
| Login/use boss `ciancianteng@gmail.com` | Still boss; **unchanged** |
| Admin profile flag | `is_test_account = false` (after G1) |

After SUCCESS:

```text
CONVERT VERIFY SUCCESS
- NEW_ADMIN_EMAIL: ___
- boss ciancianteng@gmail.com: unchanged
- G2: still blocked
```

Then update G2 plan to **remove** `6f31b706-…` from the smoke mark list (10 accounts left) — only when you later approve G2.

---

## Rollback sketch

1. Auth: set `6f31b706-…` email back to `admin@meow.test` (confirm)  
2. profiles: email back to `admin@meow.test`  
3. Never modify boss `458ce9ad-…` during rollback  

Note: `@meow.test` remains Production-login-blocked by code after rollback.

---

## Waiting on you

```text
NEW_ADMIN_EMAIL: ___@___
CONFIRM: do not touch boss 458ce9ad-... / ciancianteng@gmail.com: YES
G2 blocked until convert verify: YES
```

After that, Agent will show **frozen exact SQL/actions** for final review again — still no apply until `EXECUTE CONVERT ADMIN`.
