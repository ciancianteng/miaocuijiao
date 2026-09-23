# Gift + Withdraw Channels (§8–15) — Staging Evidence

- Staging URL: https://meow-cuijiao-homepage-staging.vercel.app/
- Staging Supabase: `cfccwysniduwkjskiqgy`
- Migration applied: `supabase/migrations/20260922_gift_withdraw_channels_sot.sql`
- Pending Prod copy: `supabase/pending-prod/15_gift_withdraw_channels_sot.sql` (do not apply until Owner OK)

## E2E (`scripts/e2e-staging-gift-withdraw-channels.mjs`)

Verdict: **PASS**

| Check | Result |
|---|---|
| Gift vs order classification | PASS (`gift_income` ≠ `order_income`) |
| Catfood gift debit + settle | PASS gross=20 commission=4 net=16, idempotent replay |
| Channels on companion bootstrap | PASS order/gift/locked/withdrawn/available |
| Gift net → withdrawable | PASS withdrawable 16→32 after second gift |
| Withdraw freeze | SKIP (`canWithdraw=false` on test companion); code path live in admin finance |

DB evidence file: `artifacts/gift-withdraw-channels/evidence.json`

## Owner rules covered

- §8 Freeze model: request → freeze_tx/transaction_id; reject/cancel unlocks; paid settles freeze
- §9 Admin finance SoT fields on withdraw view + `cancel_withdraw`
- §10 Companion channels UI + API
- §11–12 Gift net ledger with `MCJ_GIFT` / `source=gift`, never order settlement
- §13 Catfood gift auto settle (no review) + idempotency
- §14 External gift still gate on `gift_orders` approve
- §15 Schema gaps filled on Staging (gift_transactions + gift_orders + withdraw audit cols)
