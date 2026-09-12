# Companion list empty / load-fail — root cause (NOT i18n)

## Symptom
Hall/home may show empty companion list or load failure copy (bilingual).

## Root cause
`server/api/public/companions.js` only returns companions that pass the publish gate:

1. Supabase configured (`SUPABASE_URL` + service role); otherwise `{ companions: [], configured: false }`
2. `verification_status` **or** `application_status` approved
3. Profile active, not test account
4. `evaluatePublishGate(...).hallVisible` — approved + active + `allow_orders !== false` + not banned/archived/rejected/test

## Conclusion
Empty list / “共 0 位陪玩” is a **data / publish-gate** issue when no approved live companions exist in the environment DB. Do **not** mask with i18n. Fix by approving & enabling real companion profiles for the target environment.

## Client behavior
Hall already surfaces bilingual empty/error states via `hall.empty_*` / `hall.load_failed` without fabricating rows.
