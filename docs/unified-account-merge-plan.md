# Duplicate email merge plan (safe, no hard deletes)

## Detection
- Normalize: `trim` + `lowercase`
- Admin API: `GET /api/admin/bosses?action=scan_duplicate_emails`
- SQL unique index (after merge): `profiles_email_normalized_uidx` on `lower(trim(email))`

## Merge rules (keep data)
1. Pick **canonical** `user_id` = earliest `profiles.created_at` (stable).
2. For each duplicate profile id `D`:
   - Re-point `orders.boss_id` / `orders.companion_id` from `D` → canonical when needed
   - Re-point `companion_profiles.user_id` (at most one row per user — merge draft/pending into canonical)
   - Re-point wallets / transactions / withdrawals / chats / reviews / favorites / payment proofs
   - Keep Auth user `D` disabled or delete Auth only after data re-point (never drop order rows)
3. Blank duplicate `profiles.email` after re-point so unique index can apply (Auth email still unique platform-side).
4. Persist `profiles.roles` / `app_metadata.roles` = union of boss + companion capabilities on canonical id.

## Forbidden
- Do not delete historical orders to “fix” uniqueness.
- Do not create a second Auth user for role upgrade.
