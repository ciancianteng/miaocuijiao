# G2 Migration Plan (show-only — not executed)

**Date:** 2026-09-06  
**Trigger:** Human reported **C2 SUCCESS** (Production admin login verified).  
**This document:** Plan only. **No Production SQL has been executed.**

---

## 0. Gates

| Gate | Status | Notes |
|---|---|---|
| C2 real admin login | ✅ Human confirmed SUCCESS | Agent did **not** re-login as that user |
| G1 `is_test_account` column | ❌ **MISSING** on current `PROD_SUPABASE_URL` | Read-only probe: `42703 column profiles.is_test_account does not exist` |
| G2 UPDATE | ❌ Blocked until G1 + explicit apply approve | Cannot set flag before column exists |
| pending-prod 01–05 | Out of G2 scope unless separately approved | Not part of G2 |
| Settlement / points flags | Remain **OFF** | Not part of G2 |

### Important read-only discrepancy

Against the DB pointed to by **`PROD_SUPABASE_URL`** (service_role, read-only):

- `profiles.is_test_account` → **does not exist**
- `role=admin` rows currently returned → **only** `admin@meow.test` (`6f31b706-11e7-42df-8db1-d2caccd796de`)

If your C2 login used a **different** project/domain than this `PROD_SUPABASE_URL`, **stop** and align targets before any apply.  
If the new admin is on this same DB but not visible as `role=admin` in this probe, confirm `profiles.role` / project ref before G2.

**Do not run G2 until the same Production DB shows a non-`@meow.test` admin with `role=admin` (or `super_admin`) and `status=active`.**

---

## 1. What G2 is

**Purpose:** Mark exactly **11** known smoke/test profile IDs as `is_test_account = true` (plus companion mirror), so Dashboard GMV / commission / points exclude smoke (including RM 6000 order) without deleting data.

**Not included in G2:**

- Creating tables (01–05)
- Enabling settlement / points
- Backfilling `platform_fee`
- Deleting smoke rows
- Dropping anything

---

## 2. Required order (strict)

```text
Step 0  Confirm target DB = Production you logged into for C2
Step 1  Confirm backup / PITR (human)
Step 2  Apply G1 DDL          ← ADD is_test_account default false
Step 3  Verify G1             ← column exists; all rows false; real admin false
Step 4  Apply G2 DML          ← UPDATE 11 ids (+ companion_profiles mirror)
Step 5  Verify G2             ← marked=11; real admin still false; login still OK
```

G2 **cannot** run before G1.

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

### 4.1 Exact IDs (11)

| # | id | email | role |
|---|---|---|---|
| 1 | `6f31b706-11e7-42df-8db1-d2caccd796de` | admin@meow.test | admin |
| 2 | `b989960b-ddc2-4f1b-899f-12b2b0cac3b7` | boss@meow.test | boss |
| 3 | `d397b7bb-826b-4e7a-8fdf-f14602dd92bb` | boss.final.1785714993009@meow.test | boss |
| 4 | `5f20a7fe-3a48-4b42-82b9-82222bc81311` | cs.smoke.1788374622374@meow.test | customer_service |
| 5 | `47178368-a3d4-44b3-97fe-8a648d951c66` | brnwxnfv@guerrillamailblock.com | companion |
| 6 | `ed5054bd-93d2-434a-b468-68f75423d830` | swrfscrd@guerrillamailblock.com | companion |
| 7 | `779db97b-9a5d-4a97-8be8-5d7bc6d24109` | qemvmuma@guerrillamailblock.com | boss |
| 8 | `b9347ea4-3b45-400d-bf8d-ae2fbe05d690` | cs.smoke.1788374831089@meow.test | customer_service |
| 9 | `6d368f4b-7f33-4923-9441-c63cecef2070` | shjqelap@guerrillamailblock.com | companion |
| 10 | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` | uuzkxxgk@guerrillamailblock.com | companion |
| 11 | `0664ef55-de58-48e3-8dbb-ca8111318e91` | ijogepcg@guerrillamailblock.com | boss |

### 4.2 Statements (apply form — COMMIT only after verify)

```sql
begin;

update public.profiles
set is_test_account = true
where id in ( /* 11 ids above */ );

update public.companion_profiles
set is_test_account = true
where user_id in ( /* same 11 ids */ );

-- verify, then:
commit;
```

Review file currently ends with `rollback` on purpose so it cannot be pasted blindly.

### 4.3 Impact

| Area | Effect |
|---|---|
| Rows deleted | **None** |
| Orders mutated | **None** |
| `admin@meow.test` | Marked test (already login-blocked on Prod) |
| Real admin (new UUID) | **Unchanged** (`false`) if not in the 11-id list |
| Smoke GMV (e.g. RM 6000) | Excluded once app filters use the flag |
| Settlement flags | Unchanged / stay off |

---

## 5. Post-apply verification

```sql
-- G1
select count(*) filter (where is_test_account) as marked,
       count(*) filter (where not is_test_account) as unmarked
from public.profiles;

-- G2
select id, email, role, is_test_account
from public.profiles
where is_test_account = true
order by role, email;
-- expect exactly 11 rows

-- Real admin must remain false
select id, email, role, is_test_account
from public.profiles
where role in ('admin', 'super_admin')
  and email not ilike '%@meow.test';
```

Manual: log in again with the **real** admin (C2 repeat) → must still succeed.

---

## 6. Explicit non-goals (still blocked unless separately approved)

- pending-prod **01→05** apply  
- Historical `platform_fee` backfill  
- Smoke data deletion  
- Enabling `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED`

---

## 7. Approval needed to proceed

Reply with **all** of the following before any apply:

```text
G2 PLAN ACK
- C2 SUCCESS: confirmed
- PROD_SUPABASE_URL project matches the site I logged into: YES / NO
- Read-only discrepancy (only admin@meow.test visible to agent): explained / fixed — ___
- Backup/PITR confirmed: YES — T0 ___
- Approve G1 DDL apply: YES / NO
- Approve G2 UPDATE apply (after G1): YES / NO
- Approve pending-prod 01-05 in this same window: YES / NO (default NO)
```

**Until that reply: Agent will not execute Production SQL.**
