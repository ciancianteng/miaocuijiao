# G2 — Apply status

**Human reply:** `G2 APPLIED: YES` (2026-09-06)
- smoke IDs cleaned: **10**
- real admin untouched: **YES**
- boss unchanged: **YES**

**Scope:** mark 10 smoke/test profiles (+ companion mirror)  
**Not included:** settlement/points flags · deletions · pending-prod 01–05 · real admin · real boss

## Agent live verify (post-apply)

| Check | Result |
|---|---|
| `profiles` marked `is_test_account=true` | ✅ **exactly 10** |
| Marked IDs match planned smoke list | ✅ exact match (no extras / no missing) |
| Admin `6f31b706-…` / `meowcuijiao@gmail.com` | ✅ `admin` / **`false`** |
| Boss `458ce9ad-…` / `ciancianteng@gmail.com` | ✅ `boss` / **`false`** |
| Companion mirror (4 smoke companions) | ✅ `is_test_account=true` |
| Settlement / points | unchanged (not part of G2) |

### Marked IDs (10)

1. `b989960b-ddc2-4f1b-899f-12b2b0cac3b7`
2. `d397b7bb-826b-4e7a-8fdf-f14602dd92bb`
3. `5f20a7fe-3a48-4b42-82b9-82222bc81311`
4. `47178368-a3d4-44b3-97fe-8a648d951c66`
5. `ed5054bd-93d2-434a-b468-68f75423d830`
6. `779db97b-9a5d-4a97-8be8-5d7bc6d24109`
7. `b9347ea4-3b45-400d-bf8d-ae2fbe05d690`
8. `6d368f4b-7f33-4923-9441-c63cecef2070`
9. `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5`
10. `0664ef55-de58-48e3-8dbb-ca8111318e91`

## Still blocked unless separately approved

- pending-prod **01→05** apply
- Historical platform-fee backfill
- Smoke data deletion
- Enabling settlement / points award flags
