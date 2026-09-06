# D0/D1 — Apply status

**Requested:** `EXECUTE D0/D1 ONLY` (2026-09-06)  
**Human reply:** `D0/D1 APPLIED: YES`  
**G2:** ✅ **APPLIED** (see `G2_APPLY_STATUS.md`)

## Result: **APPLIED** (human SQL Editor) + agent verified

| Check | Result |
|---|---|
| Column `profiles.is_test_account` | ✅ exists |
| Column `companion_profiles.is_test_account` | ✅ exists |
| Admin `6f31b706-…` / `meowcuijiao@gmail.com` | ✅ `admin` / `active` / `is_test_account=false` |
| Boss `458ce9ad-…` / `ciancianteng@gmail.com` | ✅ `boss` / `active` / `is_test_account=false` |
| Profiles marked test (pre-G2 snapshot) | was **0** marked / unmarked rest |
| G2 Production UPDATE | ✅ applied (10 smoke; admin/boss false) |

## Next

G2 is done. Later items still need separate approve:

- pending-prod 01→05
- Settlement / points flags (remain OFF)
- Smoke data deletion (do not)
