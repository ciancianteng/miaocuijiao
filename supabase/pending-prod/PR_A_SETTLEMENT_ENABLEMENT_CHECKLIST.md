# PR-A — Settlement enablement checklist (Production)

**Do NOT set `SETTLEMENT_ENABLED=true` until every gate below is green.**  
Prod default (unset) remains **OFF** via `server/api/_feature-flags.js`.

## Gate 0 — PR-B production verification (blocker)

PR-A must wait until gift atomic accounting is verified on Production:

| Object | Required |
|--------|----------|
| `public.gifts` | present |
| `public.gift_transactions` | present |
| `public.companion_gift_wall` | present |
| `public.reward_events` | present |
| `public.mcj_send_gift_tip` | present |

Apply: `supabase/pending-prod/08_gift_tipping_system_v1.sql` (after merge of #179).  
Probe: REST OpenAPI / table select + RPC existence.

**Status snapshot (2026-09-07 probe):** Gate 0 **FAILED** — gift tables and `mcj_send_gift_tip` missing; #179 not merged.

---

## Checklist before `SETTLEMENT_ENABLED=true`

| # | Check | How | Pass? |
|---|--------|-----|-------|
| 1 | All settlement DDL applied | Apply `02_boss_commission_earnings_and_orders_platform_fee.sql` (depends on `01_boss_companion_relations.sql` if relations missing). Optional: `07_orders_paid_at_paid_cat_food.sql`. | |
| 2 | `orders.platform_fee` exists | `GET /rest/v1/orders?select=platform_fee&limit=1` → not PGRST204 | |
| 3 | `companion_income` write verified | Non-test complete with flag ON in controlled env → `transactions.transaction_type=companion_income` for that `order_id` | |
| 4 | `settlement_status` verified | Column exists; settled path stamps `settled` / skip stamps `skipped` when applicable | |
| 5 | Non-test account completed order | Boss + companion both `is_test_account=false`; full accept → complete → confirm | |
| 6 | No skipped income | Confirm response `settlement.skipped` is absent/false; no `[[SETTLEMENT_SKIPPED]]` for that order; income row amount matches net | |

Run helper (read-only schema probe for items 1–2 / 4 column presence):

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-settlement-prod-readiness.mjs
```

## Explicit non-goals for this PR

- Does **not** flip Vercel `SETTLEMENT_ENABLED`
- Does **not** backfill historical `platform_fee` / income
- Does **not** change order lifecycle status machine
- Does **not** apply SQL automatically

## After checklist green

1. Human sign-off (G9 packet)
2. Set Vercel Production `SETTLEMENT_ENABLED=true` (ops)
3. Smoke one non-test order end-to-end
4. Monitor `companion_income` + withdrawable balances
