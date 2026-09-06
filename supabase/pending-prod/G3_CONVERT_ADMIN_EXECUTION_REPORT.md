# CONVERT ADMIN — Execution Report

**Executed:** 2026-09-06  
**NEW_ADMIN_EMAIL:** `meowcuijiao@gmail.com`  
**Convert UUID:** `6f31b706-11e7-42df-8db1-d2caccd796de`  
**G2:** still **BLOCKED** (not run; list still includes this UUID until verify + separate approve)

## Live verify (re-checked after EXECUTE)

| Check | Result |
|---|---|
| Auth admin email | ✅ `meowcuijiao@gmail.com` (confirmed) |
| Auth `admin@meow.test` | ✅ gone (no Auth user with that email) |
| profiles admin | ✅ `meowcuijiao@gmail.com` / `admin` / `active` |
| profiles `admin@meow.test` | ✅ 0 rows |
| Boss Auth | ✅ `ciancianteng@gmail.com` / `458ce9ad-…` unchanged |
| Boss profiles | ✅ `ciancianteng@gmail.com` / `boss` / `active` / `MCJ00015` |
| `is_test_account` column | ❌ still **MISSING** on Production |

## Steps

| Step | Result |
|---|---|
| A Backup snapshot | ✅ `supabase/pending-prod/G3_CONVERT_ADMIN_BACKUP_SNAPSHOT.json` (T0 `2026-09-06T10:53:44Z`) |
| B Auth email | ✅ `admin@meow.test` → `meowcuijiao@gmail.com` |
| C profiles sync | ✅ same id: email/role/status synced |
| Boss untouched | ✅ no writes to boss Auth or profiles |
| D0 G1 DDL | ❌ **not executed** — agent env has no `DATABASE_URL` / Postgres URL (DDL blocked) |
| D1 `is_test_account=false` | ❌ blocked on D0 |
| E login verify | ⏳ **your action** — agent cannot complete browser password login for you |

---

## Human: paste D0 + D1 in Supabase SQL Editor (Production)

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

---

## E — Your verify (required before G2)

1. Login https://meow-cuijiao-homepage.vercel.app/admin/login/ as **`meowcuijiao@gmail.com`**  
   - Password: existing password for this Auth user (same UUID; was set when still `admin@meow.test`), or reset via Supabase Dashboard → Authentication → Users → that UUID  
2. `admin@meow.test` → expect FAIL  
3. Boss `ciancianteng@gmail.com` unchanged  
4. After D0/D1, confirm `is_test_account=false`

Reply:

```text
CONVERT VERIFY SUCCESS
- login: meowcuijiao@gmail.com OK
- D0/D1 applied: YES
- boss unchanged: YES
- G2 still blocked: YES
```

**G2 not executed.** After verify, G2 mark list must **remove** `6f31b706-…` before any future `EXECUTE G2` approve.
