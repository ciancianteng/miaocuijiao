# Real Admin Verification Checklist (blocking — no apply)

**Status:** WAITING FOR HUMAN  
**Agent constraints:** Do **not** run Production SQL, DDL, DML, G1/G2, or migrations until you confirm successful Production admin login below.

---

## A. Account requirements (before you verify)

| # | Requirement | Pass? |
|---|---|---|
| A1 | Email is **not** `@meow.test` | ☐ |
| A2 | Email is **not** disposable (guerrilla / sharklasers / etc.) | ☐ |
| A3 | Email is **not** `@mcj-prod-smoke.invalid` | ☐ |
| A4 | `display_name` does **not** contain `Smoke` / `ProdSmoke` | ☐ |
| A5 | Auth user exists and is confirmed (can sign in with password) | ☐ |
| A6 | `profiles.id` = Auth user id | ☐ |
| A7 | `profiles.role` = `admin` (or `super_admin` if used) | ☐ |
| A8 | `profiles.status` = `active` (or equivalent enabled) | ☐ |
| A9 | If `is_test_account` column exists: value is **`false`** | ☐ / N/A |

---

## B. Data checks (you run in Dashboard / SQL Editor — Agent will not)

```sql
-- Read-only verification (human only)
select id, email, role, display_name, status
  -- , is_test_account  -- uncomment only after G1 column exists
from public.profiles
where role in ('admin', 'super_admin')
order by created_at;
```

| # | Expectation | Pass? |
|---|---|---|
| B1 | New real admin row is present | ☐ |
| B2 | Old `admin@meow.test` may still exist (OK to leave) | ☐ |
| B3 | New admin is **not** in the G2 11-id smoke list | ☐ |

---

## C. Production login checks (required)

| # | Step | Expected | Pass? |
|---|---|---|---|
| C1 | Open **Production** admin login page | Page loads | ☐ |
| C2 | Sign in with **new real admin** email + password | **Success** — enter admin dashboard | ☐ |
| C3 | Confirm session role is admin (UI / profile) | Admin portal usable | ☐ |
| C4 | (Recommended) Try `admin@meow.test` on Production | **Still blocked** (403 / test-account message) | ☐ / skipped |

**Gate:** C2 must be **Pass** before any G2 or migration approval.

---

## D. Negative / safety checks (recommended)

| # | Check | Expected | Pass? |
|---|---|---|---|
| D1 | New admin email would not match test heuristics | Not `@meow.test` / not disposable / name without Smoke | ☐ |
| D2 | Do **not** run G2 yet | Smoke ids unmarked; `admin@meow.test` still unmarked | ☐ |
| D3 | Do **not** enable settlement / points flags | Flags remain off | ☐ |

---

## E. Reply template (paste back after C2 succeeds)

```text
REAL ADMIN VERIFICATION
- Email domain: ___@___
- profiles.role / status: admin / active
- is_test_account: false | column_absent
- Production admin login (C2): SUCCESS
- admin@meow.test negative (C4): BLOCKED | skipped
- Approve G2 now: NO   ← keep NO until you explicitly change it
- Approve migrations (01–05 / G1): NO  ← keep NO until you explicitly change it
```

---

## F. Hard stop for Agent

Until your reply shows **C2 = SUCCESS** and you explicitly approve a batch:

- [x] No Production SQL  
- [x] No G2 UPDATE  
- [x] No pending-prod 01–05 apply  
- [x] No G1 `is_test_account` apply  
- [x] No settlement / points flag enable  

**Next Agent action after your SUCCESS reply:** re-read this checklist + your paste, then wait for a **separate** explicit approve of G2 and/or migrations.
