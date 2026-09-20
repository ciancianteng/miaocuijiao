# Companion Pricing P1 — Staging apply notes

**Migration:** `supabase/migrations/20260908_companion_pricing_p1.sql`  
**Script:** `node scripts/backfill-companion-pricing-p1-staging.mjs`  
**Staging ref only:** `cfccwysniduwkjskiqgy`  
**Forbidden:** Production `jqfaknpmcnqwqvatrwgo` / PR #198 gameplay tables

## Credentials

```
STAGING_SUPABASE_URL
STAGING_SUPABASE_SERVICE_ROLE_KEY
STAGING_DATABASE_URL   # or STAGING_DB_PASSWORD
```

## Steps

1. `node scripts/verify-pricing-p1-offline.mjs`
2. Apply + backfill (Staging only):
   `node scripts/backfill-companion-pricing-p1-staging.mjs`
3. Confirm script prints `Staging verification PASS`
4. Production: review only `supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql` — **do not execute** until Staging PASS + human approval

## Rollback

1. Revert P1 code PR (read paths return to `priceForGame` / profile price)
2. Keep new columns (do not DROP)
3. Optional: soft-disable `source=legacy_import` rows with `enabled=false`
