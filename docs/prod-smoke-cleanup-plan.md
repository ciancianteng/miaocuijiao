# Production smoke inventory — preliminary (credentials pending)

Live DB inventory is blocked until Production Supabase credentials are available.

Production ref: `jqfaknpmcnqwqvatrwgo`

## Known contamination (2026-09-02 incident)

| Name | Role | User ID |
|------|------|---------|
| ProdSmokeInviter2 | companion | `6d368f4b-7f33-4923-9441-c63cecef2070` |
| ProdSmokeService2 | companion | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` |
| ProdSmokeBoss2 | boss | `0664ef55-de58-48e3-8dbb-ca8111318e91` |
| Order UUID | — | `8821329f-32c3-48c3-a24f-dde2b3e4d332` |
| Withdrawal | — | `21e042c8-461e-4e82-a491-b5a390b96674` |
| Public orders | — | `MCJO000342` / `MCJO000343` / `MCJO000344` |

Default retain: `admin@meow.test` (bootstrap).

See `scripts/prod-smoke-data-inventory.mjs` and `scripts/prod-smoke-data-purge.mjs`.
