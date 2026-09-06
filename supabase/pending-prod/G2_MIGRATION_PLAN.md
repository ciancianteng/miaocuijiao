# G2 Migration Plan

**Date:** 2026-09-06  
**Status:** **APPLIED** (human SQL Editor) — agent verified post-apply  
**Mark list:** **10** smoke IDs (converted admin `6f31b706-…` **excluded**)  
**Report:** `G2_APPLY_STATUS.md`

---

## 0. Gates

| Gate | Status | Notes |
|---|---|---|
| Real admin login | ✅ `meowcuijiao@gmail.com` CONVERT VERIFY SUCCESS | Human confirmed |
| Boss unchanged | ✅ `ciancianteng@gmail.com` / `is_test_account=false` | Post-G2 re-check |
| G1 / D0+D1 `is_test_account` | ✅ Applied | Column exists; admin `false` |
| G2 UPDATE | ✅ Applied | Exactly 10 smoke IDs marked |
| pending-prod 01–05 | Out of G2 scope unless separately approved | Not part of G2 |
| Settlement / points flags | Remain **OFF** | Not part of G2 |

### Live Production (agent re-check after G2 APPLIED)

- Marked profiles: **10** (exact planned smoke ID set)
- Admin: `6f31b706-…` / `meowcuijiao@gmail.com` / `admin` / `is_test_account=false`
- Boss: `458ce9ad-…` / `ciancianteng@gmail.com` / `boss` / `is_test_account=false`
- Companion mirror: 4 smoke companions `true`

---

## 1. What G2 is

**Purpose:** Mark exactly **10** known smoke/test profile IDs as `is_test_account = true` (plus companion mirror), so Dashboard GMV / commission / points exclude smoke (including RM 6000 order) without deleting data. Real admin stays unmarked.

**Not included in G2:**

- Creating tables (01–05)
- Enabling settlement / points
- Backfilling `platform_fee`
- Deleting smoke rows
- Dropping anything

---

## 2. Required order (strict)

```text
Step 0  Confirm target DB = Production you logged into as meowcuijiao@gmail.com
Step 1  Confirm backup / PITR (human)
Step 2  Apply D0/D1 (G1 DDL + admin false)  ← DONE
Step 3  Verify G1             ← DONE (column exists; real admin false)
Step 4  Apply G2 DML          ← BLOCKED until EXECUTE G2 (10 smoke ids)
Step 5  Verify G2             ← marked=10; real admin still false; login still OK
```

G2 **ready for approve** but **not executed**.

---

## 3. Step 2 — G1 SQL (prerequisite DDL)

**Source:** `supabase/migrations/20260903_profiles_is_test_account.sql`

```sql
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
```

**Effect:** Existing rows become `false`. **No account is marked test yet.** Real admin stays login-capable.

---

## 4. Step 4 — G2 SQL (the migration)

**Source:** `supabase/pending-prod/G2_MARK_TEST_ACCOUNTS_SQL_REVIEW.sql`

### 4.1 Exact IDs (10 smoke — admin excluded)

| # | id | email | role |
|---|---|---|---|
| — | `6f31b706-11e7-42df-8db1-d2caccd796de` | meowcuijiao@gmail.com | admin — **DO NOT MARK** |
| 1 | `b989960b-ddc2-4f1b-899f-12b2b0cac3b7` | boss@meow.test | boss |
| 2 | `d397b7bb-826b-4e7a-8fdf-f14602dd92bb` | boss.final.1785714993009@meow.test | boss |
| 3 | `5f20a7fe-3a48-4b42-82b9-82222bc81311` | cs.smoke.1788374622374@meow.test | customer_service |
| 4 | `47178368-a3d4-44b3-97fe-8a648d951c66` | brnwxnfv@guerrillamailblock.com | companion |
| 5 | `ed5054bd-93d2-434a-b468-68f75423d830` | swrfscrd@guerrillamailblock.com | companion |
| 6 | `779db97b-9a5d-4a97-8be8-5d7bc6d24109` | qemvmuma@guerrillamailblock.com | boss |
| 7 | `b9347ea4-3b45-400d-bf8d-ae2fbe05d690` | cs.smoke.1788374831089@meow.test | customer_service |
| 8 | `6d368f4b-7f33-4923-9441-c63cecef2070` | shjqelap@guerrillamailblock.com | companion |
| 9 | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` | uuzkxxgk@guerrillamailblock.com | companion |
| 10 | `0664ef55-de58-48e3-8dbb-ca8111318e91` | ijogepcg@guerrillamailblock.com | boss |

### 4.2 Statements (apply form — COMMIT only after verify)

```sql
begin;

update public.profiles
set is_test_account = true
where id in ( /* 10 smoke ids above */ );

update public.companion_profiles
set is_test_account = true
where user_id in ( /* same 10 ids */ );

-- verify, then:
commit;
```

Review file currently ends with `rollback` on purpose so it cannot be pasted blindly.

### 4.3 Impact

| Area | Effect |
|---|---|
| Rows deleted | **None** |
| Orders mutated | **None** |
| Real admin `meowcuijiao@gmail.com` | **Not in mark list** — stays `false` |
| Smoke GMV (e.g. RM 6000) | Excluded once app filters use the flag |
| Settlement flags | Unchanged / stay off |

---

## 5. Post-apply verification

```sql
-- G1 / D0
select count(*) filter (where is_test_account) as marked,
       count(*) filter (where not is_test_account) as unmarked
from public.profiles;

-- G2
select id, email, role, is_test_account
from public.profiles
where is_test_account = true
order by role, email;
-- expect exactly 10 rows

-- Real admin must remain false
select id, email, role, is_test_account
from public.profiles
where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- expect: meowcuijiao@gmail.com / admin / false
```

Manual: log in again as `meowcuijiao@gmail.com` → must still succeed.

---

## 6. Explicit non-goals (still blocked unless separately approved)

- pending-prod **01→05** apply  
- Historical `platform_fee` backfill  
- Smoke data deletion  
- Enabling `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED`

---

## 7. Approval needed to proceed

**D0/D1 done.** For G2 — reply with all of:

```text
EXECUTE G2
- D0/D1 APPLIED: YES
- admin is_test_account: false
- mark count: 10 smoke ids (admin excluded)
- Backup/PITR confirmed: YES — T0 ___
- Approve G2 UPDATE apply: YES
- Approve pending-prod 01-05 in this same window: NO
- G2 still requires commit after verify: YES
```

**Until that reply: Agent will not execute G2 Production SQL.**
Note: Agent still has no `DATABASE_URL`; G2 UPDATE may need human SQL Editor even after approve (same as D0/D1).
