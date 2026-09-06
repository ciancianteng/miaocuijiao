# D0/D1 — Apply status

**Requested:** `EXECUTE D0/D1 ONLY` (2026-09-06)  
**Human reply:** `D0/D1 APPLIED: YES`  
**G2:** still **BLOCKED** (not run; needs separate `EXECUTE G2`)

## Result: **APPLIED** (human SQL Editor) + agent verified

| Check | Result |
|---|---|
| Column `profiles.is_test_account` | ✅ exists |
| Column `companion_profiles.is_test_account` | ✅ exists |
| Admin `6f31b706-…` / `meowcuijiao@gmail.com` | ✅ `admin` / `active` / `is_test_account=false` |
| Boss `458ce9ad-…` / `ciancianteng@gmail.com` | ✅ `boss` / `active` / `is_test_account=false` |
| All profiles marked test | ✅ **0** marked / 24 unmarked (expected pre-G2) |
| G2 Production UPDATE | ❌ not executed |

## Next

G2 stays blocked until explicit:

```text
EXECUTE G2
- D0/D1 APPLIED: YES
- admin is_test_account: false
- mark count: 10 smoke ids (admin excluded)
- Backup/PITR confirmed: YES — T0 ___
- Approve G2 UPDATE apply: YES
- Approve pending-prod 01-05 in this same window: NO
```

SQL review (10 ids): `G2_MARK_TEST_ACCOUNTS_SQL_REVIEW.sql`
