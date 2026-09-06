# FINAL REVIEW — Convert admin identity to `ciancianteng@gmail.com`

**Status:** REVIEW ONLY — **NOT EXECUTED**  
**G2:** **BLOCKED** until conversion verification succeeds (and separately approved).

---

## BLOCKER (must resolve before any apply)

Read-only Production check found:

| Identity | id | email | role | status |
|---|---|---|---|---|
| Current admin | `6f31b706-11e7-42df-8db1-d2caccd796de` | `admin@meow.test` | admin | active |
| **Existing account** | `458ce9ad-3425-42b1-ab66-24bca342f971` | **`ciancianteng@gmail.com`** | **boss** | active |

Also: Auth user for admin id still `admin@meow.test`.  
`is_test_account` column: **MISSING**.

**You cannot blindly set admin Auth/profile email to `ciancianteng@gmail.com`.**  
That email is already owned by boss profile `458ce9ad-…` (and its Auth user if present). Doing so would:

- Fail unique email constraints, or  
- Corrupt two identities (admin UUID vs boss UUID)

---

## Choose one SAFE path (you decide)

### Option 1 — Recommended: Promote existing Gmail user to admin

Keep UUID `458ce9ad-3425-42b1-ab66-24bca342f971` as the real admin.  
Leave `admin@meow.test` as test (later G2 / login block).

**Exact actions (not executed):**

#### B1 — Backup (read-only)

```sql
select id, email, role, display_name, status
from public.profiles
where id in (
  '6f31b706-11e7-42df-8db1-d2caccd796de',
  '458ce9ad-3425-42b1-ab66-24bca342f971'
);
```

#### C1 — Promote boss → admin (profiles only)

```sql
begin;

update public.profiles
set role = 'admin',
    status = 'active'
where id = '458ce9ad-3425-42b1-ab66-24bca342f971'
  and email = 'ciancianteng@gmail.com'
  and role = 'boss';

-- expect UPDATE 1
select id, email, role, status from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';

commit;
```

No Auth email change needed (already `ciancianteng@gmail.com`).

#### D — is_test_account=false (after G1 if column missing)

```sql
-- D0 only if column missing
alter table public.profiles
  add column if not exists is_test_account boolean not null default false;
alter table public.companion_profiles
  add column if not exists is_test_account boolean not null default false;

create index if not exists idx_profiles_is_test_account
  on public.profiles (is_test_account)
  where is_test_account = true;

update public.profiles
set is_test_account = false
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';
```

#### E — Verify

1. Login Production `/admin/login/` as `ciancianteng@gmail.com` → SUCCESS  
2. Confirm `admin@meow.test` still blocked / not used as real admin  
3. G2 later must **not** mark `458ce9ad-…`; may still mark `6f31b706-…` as test  

---

### Option 2 — Convert meow admin UUID, free the Gmail first

Only if you insist on keeping admin UUID `6f31b706-…`.

**Order (exact):**

1. **Rename/move boss email off Gmail** (Auth + profiles for `458ce9ad-…`) to a placeholder you control, e.g. `ciancianteng+boss@gmail.com`  
2. Then change Auth email on `6f31b706-…`: `admin@meow.test` → `ciancianteng@gmail.com` (confirm email)  
3. Then profiles on `6f31b706-…`:

```sql
begin;

update public.profiles
set email = 'ciancianteng@gmail.com',
    role = 'admin',
    status = 'active'
where id = '6f31b706-11e7-42df-8db1-d2caccd796de'
  and email = 'admin@meow.test';

-- expect UPDATE 1
commit;
```

4. G1 + `is_test_account=false` on `6f31b706-…`  
5. Login verify with Gmail  
6. G2 must **remove** `6f31b706-…` from smoke list  

**Auth steps for Option 2 (Dashboard, not SQL):**

| Step | User id | Action |
|---|---|---|
| 2a | `458ce9ad-…` | Change Auth email away from `ciancianteng@gmail.com` → e.g. `ciancianteng+boss@gmail.com`, confirm |
| 2b | `458ce9ad-…` | `update profiles set email = 'ciancianteng+boss@gmail.com' where id = '458ce9ad-…'` |
| 2c | `6f31b706-…` | Change Auth email `admin@meow.test` → `ciancianteng@gmail.com`, confirm |
| 2d | `6f31b706-…` | profiles SQL above |

---

### Option 3 — Use a different NEW_ADMIN_EMAIL

Pick an unused address (not in `profiles` / Auth). Then original convert plan applies to `6f31b706-…` without touching the boss account.

---

## What Agent will not do until you choose

- No Auth mutation  
- No profiles UPDATE  
- No G1/G2  
- No pending-prod 01–05  

---

## Reply to proceed (pick one)

```text
EXECUTE PATH: OPTION_1_PROMOTE_GMAIL_BOSS
- Approve C1 role admin on 458ce9ad-...: YES
- Approve D0/D1 is_test_account as needed: YES / NO
- G2 blocked until verify: YES
```

or

```text
EXECUTE PATH: OPTION_2_CONVERT_MEOW_UUID
- Boss parking email: ciancianteng+boss@gmail.com   # or your choice
- Approve 2a–2d in order: YES
- G2 blocked until verify: YES
```

or

```text
EXECUTE PATH: OPTION_3_NEW_EMAIL
- NEW_ADMIN_EMAIL: ___@___
- G2 blocked until verify: YES
```

**Recommended: Option 1** (simplest, no email swap race).
