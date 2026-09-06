# D0/D1 — Apply status

**Requested:** `EXECUTE D0/D1 ONLY` (2026-09-06)  
**Approvals:** Admin conversion verified YES · Boss unchanged YES · Approve D0/D1 YES · G2 remains blocked YES

## Agent result: **NOT APPLIED**

| Item | Status |
|---|---|
| Agent secrets | Only `PROD_SUPABASE_URL` + `PROD_SUPABASE_SERVICE_ROLE_KEY` |
| `DATABASE_URL` / Postgres URL | **Missing** — DDL cannot be run by agent |
| D0/D1 via Auth/REST | Impossible (`ALTER TABLE` not available) |
| G2 | Still **BLOCKED** (not run) |

**Live probe still:** `column profiles.is_test_account does not exist`

## Human apply (Production SQL Editor)

Paste and run:

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

After success, reply:

```text
D0/D1 APPLIED: YES
- admin is_test_account: false
- G2 still blocked: YES
```

Optional: add a read-only or apply-capable Production `DATABASE_URL` secret to the Cloud Agent environment so future DDL can be agent-run. **G2 still needs a separate `EXECUTE G2` even after D0/D1.**
