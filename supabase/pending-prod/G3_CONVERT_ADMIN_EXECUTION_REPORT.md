# CONVERT ADMIN — Execution Report

**Executed:** 2026-09-06  
**NEW_ADMIN_EMAIL:** `meowcuijiao@gmail.com`  
**Convert UUID:** `6f31b706-11e7-42df-8db1-d2caccd796de`  
**G2:** still **BLOCKED** (SQL review updated to **10** smoke ids; Production UPDATE not run)

## Human verify (received)

```text
CONVERT VERIFY SUCCESS
Login: meowcuijiao@gmail.com OK
D0/D1 applied: NO (pending)
Boss unchanged: YES
G2 still blocked: YES
```

| Check | Result |
|---|---|
| E1 Login `meowcuijiao@gmail.com` | ✅ Human confirmed SUCCESS |
| E2/E3 Boss unchanged | ✅ Human confirmed |
| D0/D1 | ❌ still pending (agent probe: column missing) |
| G2 | ❌ blocked |

## Agent live re-check after verify message

| Check | Result |
|---|---|
| Auth admin | ✅ `meowcuijiao@gmail.com` |
| profiles admin | ✅ `meowcuijiao@gmail.com` / `admin` / `active` |
| Boss profiles | ✅ `ciancianteng@gmail.com` / `boss` / `active` |
| `is_test_account` | ❌ column still **MISSING** |

## Steps

| Step | Result |
|---|---|
| A Backup | ✅ `G3_CONVERT_ADMIN_BACKUP_SNAPSHOT.json` |
| B Auth email | ✅ |
| C profiles sync | ✅ |
| Boss untouched | ✅ |
| D0/D1 | ❌ pending — paste SQL below |
| E login | ✅ |
| G2 list edit (docs only) | ✅ removed `6f31b706-…` from mark list → 10 ids |
| G2 Production UPDATE | ❌ not executed |

---

## Next: paste D0 + D1 in Supabase SQL Editor (Production)

```sql
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

update public.profiles
set is_test_account = false
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';

update public.companion_profiles
set is_test_account = false
where user_id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- 0 rows OK

select id, email, role, status, is_test_account
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- expect: meowcuijiao@gmail.com / admin / active / false

select id, email, role, status
from public.profiles
where id = '458ce9ad-3425-42b1-ab66-24bca342f971';
-- expect: ciancianteng@gmail.com / boss / active

commit;
```

After D0/D1, reply:

```text
D0/D1 APPLIED: YES
- admin is_test_account: false
- G2 still blocked: YES
```

Only then can a separate `EXECUTE G2` approve mark the **10** remaining smoke ids.
