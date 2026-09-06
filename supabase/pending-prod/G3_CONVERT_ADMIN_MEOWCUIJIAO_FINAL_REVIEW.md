# FROZEN FINAL REVIEW — Convert admin → `meowcuijiao@gmail.com`

**Status:** **CONVERT VERIFY SUCCESS** (login OK; D0/D1 pending; G2 blocked)  
**Updated:** 2026-09-06 (post VERIFY)  
**G2:** **BLOCKED** until D0/D1 + separate `EXECUTE G2`  
**Report:** `G3_CONVERT_ADMIN_EXECUTION_REPORT.md`  
**G2 list:** docs updated — **10** smoke ids (admin UUID removed)

---

## Review conclusion

| Gate | Status |
|---|---|
| Admin Auth/profile convert | ✅ `meowcuijiao@gmail.com` / admin / active |
| Login verify | ✅ Human CONVERT VERIFY SUCCESS |
| Boss protected | ✅ `ciancianteng@gmail.com` unchanged |
| G1 `is_test_account` | ❌ D0/D1 still pending |
| G2 | ✅ remains blocked (mark list prepped, 10 ids) |

---

## Confirmed inputs

| Item | Value |
|---|---|
| NEW_ADMIN_EMAIL | `meowcuijiao@gmail.com` |
| Convert UUID | `6f31b706-11e7-42df-8db1-d2caccd796de` |
| Do not touch boss | `458ce9ad-3425-42b1-ab66-24bca342f971` / `ciancianteng@gmail.com` = **YES** |
| G2 blocked until verify | **YES** |

## Read-only preflight (re-checked)

| Check | Result |
|---|---|
| `profiles` for `meowcuijiao@gmail.com` | **0 rows** — free |
| Auth users with that email (page sample) | **0 hits** — free |
| Admin Auth/profile | still `admin@meow.test` / admin / active |
| Boss Auth/profile | still `ciancianteng@gmail.com` / boss / active — **leave alone** |
| `is_test_account` column | **MISSING** → include G1 DDL in Step D0 |

---

## Step A — Backup (human, before writes)

```sql
-- A1 READ ONLY — save output
select id, email, role, display_name, status, created_at, updated_at
from public.profiles
where id in (
  '6f31b706-11e7-42df-8db1-d2caccd796de',
  '458ce9ad-3425-42b1-ab66-24bca342f971'
);

-- A2 READ ONLY — expect 0
select id, email, role from public.profiles
where lower(email) = lower('meowcuijiao@gmail.com');
```

Also screenshot Auth user `6f31b706-…` (`admin@meow.test`).  
Record **T0 (UTC):** ________

---

## Step B — Auth email change (Dashboard only on admin UUID)

**Supabase Dashboard → Authentication → Users → `6f31b706-11e7-42df-8db1-d2caccd796de`**

1. Email: `admin@meow.test` → `meowcuijiao@gmail.com`  
2. Ensure **email confirmed** = true  
3. Set/reset password for `meowcuijiao@gmail.com`  
4. Save  

**Do not open/edit** Auth user `458ce9ad-…` (`ciancianteng@gmail.com`).

---

## Step C — profiles sync (admin UUID only)

```sql
-- C1 APPLY (only after EXECUTE approve)
begin;

update public.profiles
set
  email = 'meowcuijiao@gmail.com',
  role = 'admin',
  status = 'active'
where id = '6f31b706-11e7-42df-8db1-d2caccd796de'
  and email = 'admin@meow.test';

-- expect: UPDATE 1
select id, email, role, status, display_name
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- expect: meowcuijiao@gmail.com / admin / active

-- boss unchanged guard (expect gmail boss)
select id, email, role, status
from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';
-- expect: ciancianteng@gmail.com / boss / active

commit;
```

If `UPDATE 0` → **STOP** and re-check (do not force).

---

## Step D — `is_test_account = false`

### D0 — G1 DDL (required; column missing)

```sql
-- D0 APPLY
begin;

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

alter table public.companion_profiles
  add column if not exists is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'When true, exclude from production business dashboard stats. Set by ops; never auto-delete.';

comment on column public.companion_profiles.is_test_account is
  'When true, companion is a test/smoke fixture and must not appear in business metrics.';

create index if not exists idx_profiles_is_test_account
  on public.profiles (is_test_account)
  where is_test_account = true;

commit;
```

### D1 — Explicit false on converted admin only

```sql
-- D1 APPLY
begin;

update public.profiles
set is_test_account = false
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

update public.companion_profiles
set is_test_account = false
where user_id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- 0 rows OK

select id, email, role, is_test_account
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- expect: false

-- boss must not be required here; do not update boss
select id, email, role
from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';

commit;
```

---

## Step E — Verify (G2 stays blocked)

| # | Check | Expected |
|---|---|---|
| E1 | Login https://meow-cuijiao-homepage.vercel.app/admin/login/ as `meowcuijiao@gmail.com` | **SUCCESS** |
| E2 | Login as `admin@meow.test` | FAIL |
| E3 | Boss `ciancianteng@gmail.com` still boss / usable as before | **UNCHANGED** |
| E4 | Admin row `is_test_account` | `false` |

```sql
-- E4 READ ONLY
select id, email, role, status, is_test_account
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
```

After E1 SUCCESS, reply:

```text
CONVERT VERIFY SUCCESS
- login: meowcuijiao@gmail.com OK
- boss ciancianteng@gmail.com: unchanged
- G2: still blocked
```

Only then: edit G2 list to **remove** `6f31b706-…` from smoke marks (separate approve).

---

## Not included

- Any change to boss `ciancianteng@gmail.com`  
- G2 UPDATE  
- pending-prod 01–05 (except optional D0 G1 column above if you approve D0)  
- Settlement / points flags  

---

## Approve to execute (paste exactly)

```text
EXECUTE CONVERT ADMIN
- NEW_ADMIN_EMAIL: meowcuijiao@gmail.com
- Approve B Auth email change on 6f31b706-...: YES
- Approve C profiles SQL: YES
- Approve D0 G1 DDL: YES
- Approve D1 is_test_account=false: YES
- Do not touch boss 458ce9ad-...: YES
- G2 remains blocked: YES
```

**Until that message: no Production mutation by Agent.**
