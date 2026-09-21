# Production companion_code backfill plan (PR #172 follow-up)

## Status (read-only audit 2026-09-21)

- Column `companion_profiles.companion_code` exists.
- RPC `mcj_allocate_companion_code` exists.
- Public listing (`/api/public/companions`) already calls `ensureCompanionPublicCodes` — live hall companions show `PW#####` (e.g. 小灰灰 = `PW00027`). Public sample: **13/13** listed companions have `publicId`.
- **7** offline/unpublished rows still have `companion_code IS NULL` (三斤, 失一段, sq, 771, Vocus豆豆, Yang, 小葱). They are not in the public hall list.

## Why some pages looked “no ID”

1. Unpublished / incomplete profiles never hit approve allocate.
2. UI shows「待生成」when `publicId` empty before ensure runs.
3. Lazy ensure on public list only covers hall-visible rows.

## Code already on main

- First approve allocates code (`admin/players.js` reviewApplication).
- Public list / orders enrich call `ensureCompanionPublicCode`.

## Safe backfill (WAIT for owner — do NOT run from agent)

```sql
-- Preview only
select user_id, nickname, companion_code, online_status, level_id
from companion_profiles
where companion_code is null or btrim(coalesce(companion_code,'')) = '';

-- Allocating one-by-one via RPC (preferred over manual sequences):
-- select public.mcj_allocate_companion_code();
-- then update companion_profiles set companion_code = '<PW…>' where user_id = '<uuid>';
```

Prefer calling app-level `ensureCompanionPublicCode` for each null row from a Staging-validated admin script before Production.

## Do not

- Reassign codes for companions that already have `PW#####`.
- Run bulk UPDATE with guessed sequences without locking / uniqueness check.
